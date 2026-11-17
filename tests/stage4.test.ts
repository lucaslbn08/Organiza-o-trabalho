import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, tmpDir } from './helpers';
import { openDatabase, migrate } from '../src/main/db/connection';
import { MIGRATIONS, LATEST_DB_VERSION } from '../src/main/db/migrations';
import { isExecutable } from '../src/main/services/attachments';
import { appendImageToNote, insertImageIntoCanvas, pngSize } from '../src/main/services/capture';
import { extractText } from '../src/main/services/notes';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('Arquivos e anexos', () => {
  it('copia para a biblioteca interna (dedup) ou apenas vincula; identifica ausentes', async () => {
    const dir = tmpDir(); const { attachments, tasks, filesDir } = await openApp(path.join(dir, 'a.sqlite'));
    const ext = path.join(tmpDir(), 'contrato.pdf'); fs.writeFileSync(ext, '%PDF-1.4 conteúdo');
    const t = tasks.create({ title: 'Com anexo' });
    const a = await attachments.importPaths([ext], 'internal', { type: 'task', id: t.id });
    const b = await attachments.importPaths([ext], 'link');
    const c = await attachments.importPaths([ext], 'internal'); // mesmo conteúdo: reaproveita o arquivo
    expect(a.errors).toEqual([]);
    expect(a.imported[0]).toMatchObject({ mode: 'internal', mime: 'application/pdf', missing: false, link_count: 1 });
    expect(a.imported[0].stored_path).toBe(c.imported[0].stored_path);
    expect(fs.readdirSync(filesDir).filter((f) => !f.startsWith('.'))).toHaveLength(1);
    expect(b.imported[0]).toMatchObject({ mode: 'link', stored_path: ext });
    expect(attachments.list({ target: { type: 'task', id: t.id } })).toHaveLength(1);
    // original movido: o vínculo aparece como ausente, a cópia interna continua íntegra
    fs.renameSync(ext, ext + '.movido');
    const byId = Object.fromEntries(attachments.list().map((x) => [x.id, x]));
    expect(byId[b.imported[0].id].missing).toBe(true);
    expect(byId[a.imported[0].id].missing).toBe(false);
    expect(attachments.list({ missingOnly: true })).toHaveLength(1);
    attachments.relink(b.imported[0].id, ext + '.movido');
    expect(attachments.list({ missingOnly: true })).toHaveLength(0);
    expect(Buffer.from((await attachments.read(a.imported[0].id)).bytes).toString()).toBe('%PDF-1.4 conteúdo');
  });

  it('excluir definitivamente apaga só cópias internas, nunca o original vinculado', async () => {
    const { attachments, filesDir } = await openApp(path.join(tmpDir(), 'b.sqlite'));
    const ext = path.join(tmpDir(), 'planilha.xlsx'); fs.writeFileSync(ext, 'dados');
    const [linked] = (await attachments.importPaths([ext], 'link')).imported;
    const [copied] = (await attachments.importPaths([ext], 'internal')).imported;
    const internalFile = path.join(filesDir, copied.stored_path);
    expect(() => attachments.purge(copied.id)).toThrow(/lixeira/);
    attachments.remove(linked.id); attachments.remove(copied.id);
    attachments.purgeAllDeleted();
    expect(fs.existsSync(ext)).toBe(true);            // original externo intacto
    expect(fs.existsSync(internalFile)).toBe(false);  // cópia interna removida
    expect(attachments.list()).toHaveLength(0);
  });

  it('incorporar vínculo à biblioteca, pastas, renomear, bytes e arquivos inválidos', async () => {
    const { attachments, notes } = await openApp(path.join(tmpDir(), 'c.sqlite'));
    const ext = path.join(tmpDir(), 'notas.txt'); fs.writeFileSync(ext, 'abc');
    const [l] = (await attachments.importPaths([ext], 'link')).imported;
    await attachments.embed(l.id);
    expect(attachments.get(l.id).mode).toBe('internal');
    attachments.setFolder(l.id, ' Clientes / 2026 /'); attachments.rename(l.id, 'Notas da reunião');
    expect(attachments.list({ folder: 'Clientes' })[0]).toMatchObject({ folder: 'Clientes/2026', name: 'Notas da reunião' });
    const n = notes.create({ title: 'N' });
    const img = await attachments.importBytes('../../captura.png', PNG, { type: 'note', id: n.id });
    expect(img.name).toBe('captura.png');
    expect(attachments.get(img.id).links[0]).toMatchObject({ type: 'note', title: 'N' });
    const r = await attachments.importPaths(['relativo.txt', tmpDir()], 'internal');
    expect(r.errors).toHaveLength(2);
    expect(isExecutable('C:\\x\\setup.EXE')).toBe(true);
    expect(isExecutable('relatorio.pdf')).toBe(false);
  });
});

describe('Agenda e lembretes', () => {
  it('lembrete dispara uma única vez; adiar e dispensar', async () => {
    const { planning, tasks } = await openApp(':memory:');
    const t = tasks.create({ title: 'Ligar para cliente' });
    const now = Date.now();
    const r = planning.createReminder({ task_id: t.id, title: 'Ligar', remind_at: new Date(now - 1000).toISOString() });
    planning.createReminder({ title: 'Futuro', remind_at: new Date(now + 3600e3).toISOString() });
    expect(planning.takeDue(now).map((x) => x.id)).toEqual([r.id]);
    expect(planning.takeDue(now)).toHaveLength(0);
    planning.snooze(r.id, 10, now);
    expect(planning.takeDue(now + 11 * 6e4).map((x) => x.id)).toEqual([r.id]);
    planning.dismiss(r.id);
    expect(planning.listReminders().map((x) => x.title)).toEqual(['Futuro']);
    tasks.update(t.id, { status: 'done' });
    const r2 = planning.createReminder({ task_id: t.id, title: 'Concluída', remind_at: new Date(now - 1).toISOString() });
    expect(planning.takeDue(now).map((x) => x.id)).not.toContain(r2.id); // tarefa concluída não notifica
  });

  it('aviso de prazo no horário configurado, uma vez por dia', async () => {
    const { planning, tasks } = await openApp(':memory:');
    const d = new Date(2026, 10, 17, 9, 30);
    tasks.create({ title: 'Vence hoje', due_date: '2026-11-17' });
    tasks.create({ title: 'Vence às 15h', due_date: '2026-11-17', due_time: '15:00' });
    tasks.create({ title: 'Amanhã', due_date: '2026-11-18' });
    expect(planning.takeDueTasks('09:00', d).map((t) => t.title)).toEqual(['Vence hoje']);
    expect(planning.takeDueTasks('09:00', d)).toHaveLength(0);
    expect(planning.takeDueTasks('09:00', new Date(2026, 10, 17, 15, 1)).map((t) => t.title)).toEqual(['Vence às 15h']);
    expect(planning.takeDueTasks(null, d)).toHaveLength(0);
  });

  it('central de notificações e intervalo da agenda', async () => {
    const { planning, tasks } = await openApp(':memory:');
    const d = new Date(2026, 10, 17, 12);
    tasks.create({ title: 'Atrasada', due_date: '2026-11-10' });
    tasks.create({ title: 'Hoje', due_date: '2026-11-17', due_time: '14:30' });
    tasks.create({ title: 'Em 2 dias', due_date: '2026-11-19' });
    tasks.create({ title: 'Concluída', due_date: '2026-11-17', status: 'done' });
    const c = planning.center(d);
    expect([c.overdue, c.today, c.upcoming].map((x) => x.map((t) => t.title))).toEqual([['Atrasada'], ['Hoje'], ['Em 2 dias']]);
    expect(c.today[0].due_time).toBe('14:30');
    const ag = planning.agenda('2026-11-16', '2026-11-22');
    expect(ag.tasks.map((t) => t.title).sort()).toEqual(['Concluída', 'Em 2 dias', 'Hoje']);
    expect(() => tasks.update(c.today[0].id, { due_time: '25:99' })).toThrow();
  });
});

describe('Notas flutuantes', () => {
  it('persistem conteúdo, cor, posição, tamanho, fixação e reabertura', async () => {
    const file = path.join(tmpDir(), 'f.sqlite');
    let app = await openApp(file);
    const t = app.tasks.create({ title: 'Relacionada' });
    const f = app.floating.create({ content: 'Lembrar do código 4471', task_id: t.id });
    app.floating.update(f.id, { color: '#c3fae8', bounds: { x: 1500, y: 40, width: 300, height: 200 }, always_on_top: true });
    const g = app.floating.create(); app.floating.update(g.id, { is_open: false });
    app.db.close();
    app = await openApp(file);
    expect(app.floating.openOnes().map((x) => x.id)).toEqual([f.id]);
    expect(app.floating.get(f.id)).toMatchObject({ content: 'Lembrar do código 4471', color: '#c3fae8', x: 1500, y: 40, width: 300, height: 200, always_on_top: 1, task_title: 'Relacionada' });
  });
});

describe('Captura de tela → destinos', () => {
  it('anexa a nota sem perder conteúdo e insere no quadro como imagem editável', async () => {
    const { notes, media, canvases } = await openApp(':memory:');
    const n = notes.create({ title: 'Bugs' });
    notes.update(n.id, { content_json: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'texto anterior' }] }] }) });
    appendImageToNote(notes, media, n.id, PNG);
    const doc = JSON.parse(notes.get(n.id).content_json);
    expect(extractText(notes.get(n.id).content_json)).toBe('texto anterior');
    expect(doc.content[1]).toMatchObject({ type: 'image', attrs: { src: expect.stringMatching(/^ws-media:\/\/[0-9a-f]{64}$/) } });
    const b = canvases.create({ kind: 'board' });
    expect(pngSize(PNG)).toEqual({ width: 1, height: 1 });
    insertImageIntoCanvas(canvases, media, b.id, PNG, 1920, 1080);
    const scene = JSON.parse(canvases.get(b.id).scene_json);
    expect(scene.elements[0]).toMatchObject({ type: 'image', width: 800, height: 450 });
    expect(scene.files[scene.elements[0].fileId].hash).toHaveLength(64);
  });
});

describe('Atualização v3 → v4', () => {
  it('adiciona horário às tarefas existentes sem perdê-las', async () => {
    const dir = tmpDir(); const file = path.join(dir, 'v3.sqlite');
    const db = openDatabase(file);
    for (const m of MIGRATIONS.slice(0, 3)) db.transaction(() => { db.exec(m.up); db.pragma(`user_version = ${m.version}`); })();
    db.prepare("INSERT INTO tasks (workspace_id, title, due_date) VALUES (1, 'antiga', '2026-01-01')").run();
    const rep = await migrate(db, path.join(dir, 'backups'));
    expect(rep).toMatchObject({ from: 3, to: LATEST_DB_VERSION });
    expect(db.prepare('SELECT title, due_date, due_time FROM tasks').get()).toEqual({ title: 'antiga', due_date: '2026-01-01', due_time: null });
  });
});
