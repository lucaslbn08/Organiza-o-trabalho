import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, tmpDir } from './helpers';
import { openDatabase, migrate } from '../src/main/db/connection';
import { MIGRATIONS, LATEST_DB_VERSION } from '../src/main/db/migrations';
import { extractText, ftsQuery, AUTO_VERSION_INTERVAL_MS } from '../src/main/services/notes';
import { searchAll } from '../src/main/services/search';

const doc = (...blocks: object[]) => JSON.stringify({ type: 'doc', content: blocks });
const p = (text: string, marks?: object[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
const RICH = doc(
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Reunião' }] },
  p('Texto em negrito', [{ type: 'bold' }]),
  { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('Revisar orçamento')] }, { type: 'taskItem', attrs: { checked: false }, content: [p('Enviar ata')] }] },
  { type: 'image', attrs: { src: 'ws-media://' + 'a'.repeat(64) } },
  { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('A1')] }, { type: 'tableCell', content: [p('B1')] }] }] },
);

describe('Teste 2 — Notas persistem com formatação, imagem e checklist', () => {
  it('reabre o banco e recupera o documento idêntico', async () => {
    const file = path.join(tmpDir(), 'n.sqlite');
    let app = await openApp(file);
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const src = app.media.save(png, 'image/png');
    const content = RICH.replace('ws-media://' + 'a'.repeat(64), src);
    const n = app.notes.create({ title: 'Ata' });
    app.notes.update(n.id, { content_json: content, tags: ['reunião'] });
    app.db.close();

    app = await openApp(file);
    const back = app.notes.get(n.id);
    expect(back.content_json).toBe(content);
    expect(JSON.parse(back.content_json).content[2].content[0].attrs.checked).toBe(true);
    expect(back.tags.map((t) => t.name)).toEqual(['reunião']);
    expect(Buffer.from(app.media.get(src.slice('ws-media://'.length))!.data)).toEqual(Buffer.from(png));
  });
});

describe('Anotações', () => {
  it('extrai texto de blocos, listas e tabelas', () => {
    const t = extractText(RICH);
    expect(t).toContain('Reunião');
    expect(t).toContain('Revisar orçamento');
    expect(t).toContain('A1');
    expect(extractText('lixo')).toBe('');
  });

  it('pesquisa texto completo ignorando acentos e com prefixo', async () => {
    const { notes, db } = await openApp(':memory:');
    const a = notes.create({ title: 'Planejamento' }); notes.update(a.id, { content_json: RICH });
    notes.create({ title: 'Outra' });
    expect(notes.list({ search: 'orcamento' }).map((x) => x.id)).toEqual([a.id]);
    expect(notes.list({ search: 'reuni' })).toHaveLength(1);
    expect(notes.list({ search: 'plan' })[0].title).toBe('Planejamento');
    expect(notes.list({ search: '"; DROP' })).toHaveLength(0);
    expect(ftsQuery('  ')).toBeNull();
    const hits = searchAll(db, 1, 'orçamento');
    expect(hits.find((h) => h.type === 'note')?.snippet).toContain('«orçamento»');
  });

  it('pastas e subpastas; remover pasta preserva as notas', async () => {
    const { notes } = await openApp(':memory:');
    const f1 = notes.createFolder('Trabalho', null);
    const f2 = notes.createFolder('Clientes', f1.id);
    const n = notes.create({ title: 'X', folder_id: f2.id });
    expect(() => notes.moveFolder(f1.id, f2.id)).toThrow(/dentro dela mesma/);
    notes.removeFolder(f2.id);
    expect(notes.get(n.id).folder_id).toBe(f1.id);
    expect(notes.folders()).toHaveLength(1);
  });

  it('fixadas aparecem primeiro; favoritas filtram', async () => {
    const { notes } = await openApp(':memory:');
    const a = notes.create({ title: 'A' }); const b = notes.create({ title: 'B' });
    notes.update(a.id, { pinned: true }); notes.update(b.id, { favorite: true });
    expect(notes.list()[0].id).toBe(a.id);
    expect(notes.list({ favorites: true }).map((x) => x.id)).toEqual([b.id]);
  });

  it('histórico de versões: automática por intervalo, manual e restauração', async () => {
    const { notes } = await openApp(':memory:');
    const n = notes.create({ title: 'V' });
    const t0 = Date.now();
    notes.update(n.id, { content_json: doc(p('um')) }, t0);           // nota vazia: sem versão
    notes.update(n.id, { content_json: doc(p('dois')) }, t0);         // primeira versão ("um")
    notes.update(n.id, { content_json: doc(p('três')) }, t0 + 1000);  // dentro do intervalo: não versiona
    expect(notes.versions(n.id)).toHaveLength(1);
    notes.update(n.id, { content_json: doc(p('quatro')) }, t0 + AUTO_VERSION_INTERVAL_MS + Date.parse(notes.versions(n.id)[0].created_at) - t0);
    expect(notes.versions(n.id)).toHaveLength(2);
    notes.snapshot(n.id);
    const first = notes.versions(n.id).at(-1)!;
    expect(extractText(notes.versionContent(first.id).content_json)).toBe('um');
    notes.restoreVersion(first.id);
    expect(extractText(notes.get(n.id).content_json)).toBe('um');
    expect(notes.versions(n.id)[0].reason).toBe('antes de restaurar');
  });

  it('vincula a tarefas e projetos, duplica e usa a lixeira', async () => {
    const { notes, tasks, org, svc } = await openApp(':memory:');
    const pr = org.createProject({ name: 'P' });
    const t = tasks.create({ title: 'Tarefa', project_id: pr.id });
    const n = notes.create({ title: 'Nota', project_id: pr.id, task_id: t.id });
    expect(notes.get(n.id).tasks.map((x) => x.id)).toEqual([t.id]);
    expect(notes.list({ task_id: t.id })).toHaveLength(1);
    expect(notes.list({ project_id: pr.id })).toHaveLength(1);
    const c = notes.duplicate(n.id);
    expect(notes.get(c.id).tasks).toHaveLength(1);
    notes.remove(n.id);
    expect(notes.list()).toHaveLength(1);
    expect(org.trash().find((x) => x.entity_type === 'note')?.title).toBe('Nota');
    org.restore('note', n.id, svc);
    expect(notes.list()).toHaveLength(2);
    notes.remove(n.id); org.emptyTrash();
    expect(notes.list({ search: 'Nota' }).map((x) => x.id)).toEqual([c.id]); // índice FTS limpo
  });

  it('rejeita JSON inválido sem alterar a nota', async () => {
    const { notes } = await openApp(':memory:');
    const n = notes.create({ title: 'ok' });
    expect(() => notes.update(n.id, { content_json: '{quebrado' })).toThrow();
    expect(notes.get(n.id).title).toBe('ok');
  });

  it('mídia: deduplica e recusa formatos não suportados', async () => {
    const { media, db } = await openApp(':memory:');
    const a = media.save(new Uint8Array([1, 2]), 'image/png');
    expect(media.save(new Uint8Array([1, 2]), 'image/png')).toBe(a);
    expect((db.prepare('SELECT COUNT(*) n FROM media').get() as { n: number }).n).toBe(1);
    expect(() => media.save(new Uint8Array([1]), 'application/x-msdownload')).toThrow();
    expect(media.get('../../etc')).toBeNull();
  });
});

describe('Atualização v1 → v2', () => {
  it('migra banco da Etapa 1 com backup e sem perder tarefas', async () => {
    const dir = tmpDir(); const file = path.join(dir, 'old.sqlite');
    const db = openDatabase(file);
    db.transaction(() => { db.exec(MIGRATIONS[0].up); db.pragma('user_version = 1'); })();
    db.prepare("INSERT INTO tasks (workspace_id, title) VALUES (1, 'da etapa 1')").run();
    const rep = await migrate(db, path.join(dir, 'backups'));
    expect(rep).toMatchObject({ from: 1, to: LATEST_DB_VERSION });
    expect(fs.existsSync(rep.backupPath!)).toBe(true);
    expect((db.prepare('SELECT title FROM tasks').get() as { title: string }).title).toBe('da etapa 1');
    const bk = openDatabase(rep.backupPath!);
    expect(bk.pragma('user_version', { simple: true })).toBe(1);
  });
});
