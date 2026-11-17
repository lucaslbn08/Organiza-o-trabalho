import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import { openApp, tmpDir } from './helpers';
import { exportBackup, verifyBackup, prepareRestore, applyPendingRestore, cancelPendingRestore, isSafeEntry, PENDING_MARKER, RESULT_MARKER } from '../src/main/backup/backup';
import { LATEST_DB_VERSION } from '../src/main/db/migrations';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** Ambiente igual ao do app: <dataDir>/data/workspace.sqlite e <dataDir>/files */
async function env(dataDir = tmpDir()) {
  const app = await openApp(path.join(dataDir, 'data', 'workspace.sqlite'), path.join(dataDir, 'files'));
  return { dataDir, ...app };
}

async function populate(a: Awaited<ReturnType<typeof env>>) {
  const p = a.org.createProject({ name: 'Cliente X', color: '#22c55e' });
  const t = a.tasks.create({ title: 'Entregar proposta', project_id: p.id, priority: 'urgent', due_date: '2026-12-01', due_time: '10:00', tags: ['vendas', 'urgente'] });
  a.tasks.addChecklist(t.id, 'subtask', 'Rascunho'); const s2 = a.tasks.addChecklist(t.id, 'subtask', 'Revisão'); a.tasks.updateChecklist(s2.id, { done: true });
  a.tasks.update(t.id, { status: 'in_progress' });
  const done = a.tasks.create({ title: 'Concluída' }); a.tasks.update(done.id, { status: 'done' });
  const n = a.notes.create({ title: 'Ata', project_id: p.id, task_id: t.id });
  const img = a.media.save(PNG, 'image/png');
  a.notes.update(n.id, { content_json: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'versão 1' }] }] }) });
  a.notes.snapshot(n.id);
  a.notes.update(n.id, { content_json: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'versão 2' }] }, { type: 'image', attrs: { src: img } }] }) });
  const b = a.canvases.create({ kind: 'board', title: 'Mapa', task_id: t.id });
  a.canvases.update(b.id, { scene_json: JSON.stringify({ elements: [{ id: 'c1', type: 'rectangle', x: 5, y: 9, width: 10, height: 10, customData: { kind: 'task', taskId: t.id } }], appState: { zoom: { value: 0.4 }, scrollX: -99, scrollY: 12 }, files: {} }) });
  const ext = path.join(tmpDir(), 'orcamento.xlsx'); fs.writeFileSync(ext, 'planilha externa');
  const pdf = path.join(tmpDir(), 'contrato.pdf'); fs.writeFileSync(pdf, '%PDF-1.4 interno');
  const [internal] = (await a.attachments.importPaths([pdf], 'internal', { type: 'task', id: t.id })).imported;
  const [linked] = (await a.attachments.importPaths([ext], 'link', { type: 'project', id: p.id })).imported;
  a.settings.set({ theme: 'light', accent: '#ec4899', tabs: [{ id: 'a', view: 'kanban' }, { id: 'b', view: 'notes' }], activeTab: 'b', split: { tabId: 'a', dir: 'vertical' } });
  a.floating.create({ content: 'adesiva', color: '#ffc9c9' });
  a.planning.createReminder({ task_id: t.id, title: 'Ligar', remind_at: '2026-11-30T12:00:00.000Z' });
  return { t, n, b, p, internal, linked, ext };
}

describe('Teste 5 — backup completo e restauração em ambiente limpo', () => {
  it('exporta, verifica e restaura tudo, inclusive arquivos e relacionamentos', async () => {
    const A = await env();
    const ids = await populate(A);
    const out = path.join(tmpDir(), 'backup completo.zip');
    const phases = new Set<string>();
    const r = await exportBackup({ db: A.db, filesDir: A.filesDir, tmpDir: path.join(A.dataDir, 'tmp'), dest: out, appVersion: '0.5.0', includeLinked: true, onProgress: (p) => phases.add(p.phase) });
    expect(r.report.ok).toBe(true);
    expect([...phases]).toEqual(expect.arrayContaining(['banco', 'arquivos', 'verificando', 'concluído']));
    expect(fs.existsSync(out + '.parcial')).toBe(false);
    expect(r.manifest).toMatchObject({ appVersion: '0.5.0', dbVersion: LATEST_DB_VERSION, includeLinked: true, linkedNotIncluded: [] });
    expect(r.manifest.counts).toMatchObject({ tarefas: 2, projetos: 1, anotacoes: 1, quadros: 1, arquivos: 2, imagens: 1 });
    expect(r.manifest.files.map((f) => f.path)).toEqual(expect.arrayContaining(['db/workspace.sqlite', expect.stringMatching(/^files\//), expect.stringMatching(/^linked\/\d+\/orcamento\.xlsx$/)]));
    // dados originais não foram alterados pela exportação
    expect(A.tasks.list()).toHaveLength(2);

    // ambiente limpo, sem o arquivo externo original
    fs.rmSync(ids.ext);
    const B = tmpDir();
    const prep = await prepareRestore({ zip: out, dataDir: B, safetyBackup: null });
    expect(prep.report.ok).toBe(true);
    expect(fs.existsSync(path.join(B, PENDING_MARKER))).toBe(true);
    const res = applyPendingRestore(B)!;
    expect(res.ok).toBe(true);
    const R = await env(B);
    const t = R.tasks.detail(ids.t.id);
    expect(t).toMatchObject({ title: 'Entregar proposta', status: 'in_progress', priority: 'urgent', due_date: '2026-12-01', due_time: '10:00', project_id: ids.p.id });
    expect(t.tags.map((x) => x.name)).toEqual(['urgente', 'vendas']);
    expect(t.progress).toEqual({ done: 1, total: 2 });
    expect(R.tasks.list({ statuses: ['done'] })).toHaveLength(1);
    const n = R.notes.get(ids.n.id);
    expect(n.tasks.map((x) => x.id)).toEqual([ids.t.id]);
    expect(n.content_json).toContain('versão 2');
    expect(R.notes.versions(ids.n.id).length).toBeGreaterThanOrEqual(1);
    const src = JSON.parse(n.content_json).content[1].attrs.src as string;
    expect(Buffer.from(R.media.get(src.slice('ws-media://'.length))!.data)).toEqual(PNG);
    const b = R.canvases.get(ids.b.id);
    expect(JSON.parse(b.scene_json).appState).toMatchObject({ zoom: { value: 0.4 }, scrollX: -99 });
    expect(b.links.map((l) => l.id)).toEqual([ids.t.id]);
    // anexo interno com conteúdo íntegro; vínculo externo incorporado porque o original não existe aqui
    expect(Buffer.from((await R.attachments.read(ids.internal.id)).bytes).toString()).toBe('%PDF-1.4 interno');
    const linked = R.attachments.get(ids.linked.id);
    expect(linked).toMatchObject({ mode: 'internal', missing: false });
    expect(linked.links[0]).toMatchObject({ type: 'project', id: ids.p.id });
    expect(Buffer.from((await R.attachments.read(ids.linked.id)).bytes).toString()).toBe('planilha externa');
    expect(R.settings.get()).toMatchObject({ theme: 'light', accent: '#ec4899', activeTab: 'b', split: { tabId: 'a', dir: 'vertical' } });
    expect(R.floating.list()[0]).toMatchObject({ content: 'adesiva', color: '#ffc9c9' });
    expect(R.planning.listReminders()[0].title).toBe('Ligar');
  });

  it('sem incluir vínculos: informa quais ficaram de fora', async () => {
    const A = await env(); await populate(A);
    const out = path.join(tmpDir(), 'b.zip');
    const r = await exportBackup({ db: A.db, filesDir: A.filesDir, tmpDir: path.join(A.dataDir, 'tmp'), dest: out, appVersion: 'x', includeLinked: false });
    expect(r.manifest.linkedNotIncluded.map((l) => l.name)).toEqual(['orcamento.xlsx']);
    expect(r.report.warnings.join()).toMatch(/1 arquivo\(s\) apenas vinculado/);
  });

  it('restauração substitui dados existentes, guardando os anteriores', async () => {
    const A = await env(); await populate(A);
    const out = path.join(tmpDir(), 'c.zip');
    await exportBackup({ db: A.db, filesDir: A.filesDir, tmpDir: path.join(A.dataDir, 'tmp'), dest: out, appVersion: 'x', includeLinked: false });
    const B = await env(); B.tasks.create({ title: 'Só no destino' }); B.db.close();
    await prepareRestore({ zip: out, dataDir: B.dataDir, safetyBackup: null });
    const res = applyPendingRestore(B.dataDir)!;
    expect(res.ok).toBe(true);
    const R = await env(B.dataDir);
    expect(R.tasks.list().map((t) => t.title)).not.toContain('Só no destino');
    const prev = await openApp(path.join(res.previousDir!, 'data', 'workspace.sqlite'));
    expect(prev.tasks.list().map((t) => t.title)).toEqual(['Só no destino']);
    expect(JSON.parse(fs.readFileSync(path.join(B.dataDir, RESULT_MARKER), 'utf8')).ok).toBe(true);
  });
});

describe('Verificação e segurança da restauração', () => {
  it('detecta arquivo adulterado', async () => {
    const A = await env(); await populate(A);
    const out = path.join(tmpDir(), 'd.zip');
    await exportBackup({ db: A.db, filesDir: A.filesDir, tmpDir: path.join(A.dataDir, 'tmp'), dest: out, appVersion: 'x', includeLinked: false });
    const buf = fs.readFileSync(out);
    const i = buf.indexOf(Buffer.from('db/workspace.sqlite')) + 200; // dentro dos dados do banco
    buf[i] ^= 0xff; buf[i + 1] ^= 0xff; const bad = path.join(tmpDir(), 'adulterado.zip'); fs.writeFileSync(bad, buf);
    const r = await verifyBackup(bad, tmpDir());
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/corrompido|hash|crc|ilegível|integridade/i);
    const B = tmpDir();
    await expect(prepareRestore({ zip: bad, dataDir: B, safetyBackup: null })).rejects.toThrow(/inválido/);
    expect(fs.existsSync(path.join(B, PENDING_MARKER))).toBe(false);
  });

  it('recusa zip slip, arquivos que não são backup e versões mais novas', async () => {
    expect(isSafeEntry('../../Windows/evil.dll')).toBe(false);
    expect(isSafeEntry('files/../../x')).toBe(false);
    expect(isSafeEntry('C:/x')).toBe(false);
    expect(isSafeEntry('files/ab/abc.pdf')).toBe(true);
    const mk = async (entries: Record<string, string>) => {
      const z = new yazl.ZipFile(); for (const [k, v] of Object.entries(entries)) z.addBuffer(Buffer.from(v), k); z.end();
      const f = path.join(tmpDir(), 'x.zip'); await new Promise((r) => z.outputStream.pipe(fs.createWriteStream(f)).on('close', r)); return f;
    };
    const okZip = await mk({ 'manifest.json': JSON.stringify({ app: 'Workspace', format: 1, dbVersion: 1, files: [] }), 'xx/evil.txt': 'x' });
    const raw = fs.readFileSync(okZip); let k = -1;
    while ((k = raw.indexOf('xx/evil.txt', k + 1)) >= 0) raw.write('../', k); // mesmo tamanho: cabeçalhos local e central
    const slip = path.join(tmpDir(), 'slip.zip'); fs.writeFileSync(slip, raw);
    expect((await verifyBackup(slip, tmpDir())).errors.join()).toMatch(/inseguras|ilegível/);
    expect((await verifyBackup(await mk({ 'leia.txt': 'oi' }), tmpDir())).errors.join()).toMatch(/não é um backup/);
    const newer = await mk({ 'manifest.json': JSON.stringify({ app: 'Workspace', format: 1, dbVersion: 999, files: [] }) });
    const r = await verifyBackup(newer, tmpDir());
    expect(r.compatible).toBe(false);
    expect(r.errors.join()).toMatch(/versão mais nova/);
    const notZip = path.join(tmpDir(), 'n.zip'); fs.writeFileSync(notZip, 'isto não é zip');
    expect((await verifyBackup(notZip, tmpDir())).errors.join()).toMatch(/ilegível/);
  });

  it('troca interrompida (queda de energia) é desfeita na próxima inicialização', async () => {
    const A = await env(); await populate(A);
    const out = path.join(tmpDir(), 'e.zip');
    await exportBackup({ db: A.db, filesDir: A.filesDir, tmpDir: path.join(A.dataDir, 'tmp'), dest: out, appVersion: 'x', includeLinked: false });
    const B = await env(); B.tasks.create({ title: 'Original do destino' }); B.db.close();
    await prepareRestore({ zip: out, dataDir: B.dataDir, safetyBackup: null });
    // simula: a pasta "data" já foi movida para dados-anteriores e o processo morreu antes do resto
    const marker = path.join(B.dataDir, PENDING_MARKER);
    const pending = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const prevDir = path.join(B.dataDir, 'dados-anteriores-teste'); fs.mkdirSync(prevDir);
    fs.renameSync(path.join(B.dataDir, 'data'), path.join(prevDir, 'data'));
    fs.writeFileSync(marker, JSON.stringify({ ...pending, swapping: { previousDir: prevDir, moved: ['data'] } }));
    const res = applyPendingRestore(B.dataDir)!;
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/interrompida/);
    const R = await env(B.dataDir);
    expect(R.tasks.list().map((t) => t.title)).toEqual(['Original do destino']);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('falha na troca desfaz tudo; restauração pendente pode ser cancelada', async () => {
    const A = await env(); await populate(A);
    const out = path.join(tmpDir(), 'f.zip');
    await exportBackup({ db: A.db, filesDir: A.filesDir, tmpDir: path.join(A.dataDir, 'tmp'), dest: out, appVersion: 'x', includeLinked: false });
    const B = await env(); B.tasks.create({ title: 'Mantida' }); B.db.close();
    const { staging } = await prepareRestore({ zip: out, dataDir: B.dataDir, safetyBackup: null });
    fs.writeFileSync(path.join(staging, 'data', 'workspace.sqlite'), 'corrompido depois da preparação');
    const res = applyPendingRestore(B.dataDir)!;
    expect(res.ok).toBe(false);
    expect((await env(B.dataDir)).tasks.list().map((t) => t.title)).toEqual(['Mantida']);
    const C = await env(); C.db.close();
    const p2 = await prepareRestore({ zip: out, dataDir: C.dataDir, safetyBackup: null });
    cancelPendingRestore(C.dataDir);
    expect(fs.existsSync(p2.staging)).toBe(false);
    expect(applyPendingRestore(C.dataDir)).toBeNull();
  });
});

describe('Desempenho', () => {
  it('lista, filtra e pesquisa milhares de tarefas e notas rapidamente', async () => {
    const { tasks, notes, db } = await openApp(':memory:');
    db.transaction(() => { for (let i = 0; i < 3000; i++) tasks.create({ title: `Tarefa ${i}`, priority: i % 7 ? 'normal' : 'high', tags: [`t${i % 20}`] }); })();
    db.transaction(() => { for (let i = 0; i < 1000; i++) { const n = notes.create({ title: `Nota ${i}` }); notes.update(n.id, { content_json: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `conteúdo número ${i} sobre orçamento` }] }] }) }); } })();
    let t0 = performance.now(); const all = tasks.list({ sort: 'priority' }); const tList = performance.now() - t0;
    t0 = performance.now(); const found = tasks.list({ search: 't7' }); const tSearch = performance.now() - t0;
    t0 = performance.now(); const ns = notes.list({ search: 'orcamento 99' }); const tFts = performance.now() - t0;
    expect(all).toHaveLength(3000); expect(found.length).toBeGreaterThan(0); expect(ns.length).toBeGreaterThan(0);
    expect(tList).toBeLessThan(500); expect(tSearch).toBeLessThan(300); expect(tFts).toBeLessThan(100);
  });
});
