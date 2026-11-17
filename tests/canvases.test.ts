import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, tmpDir } from './helpers';
import { openDatabase, migrate } from '../src/main/db/connection';
import { MIGRATIONS } from '../src/main/db/migrations';
import { sceneText, CANVAS_AUTO_VERSION_MS } from '../src/main/services/canvases';
import { searchAll } from '../src/main/services/search';

const el = (id: string, type: string, x: number, y: number, extra: object = {}) => ({ id, type, x, y, width: 100, height: 60, angle: 0, version: 1, isDeleted: false, ...extra });

describe('Teste 3 — Quadro infinito restaura disposição, zoom e câmera', () => {
  it('preserva elementos, posições, grupos, conexões, imagens e câmera após reabrir', async () => {
    const file = path.join(tmpDir(), 'q.sqlite');
    let app = await openApp(file);
    const task = app.tasks.create({ title: 'Tarefa no quadro' });
    const note = app.notes.create({ title: 'Nota no quadro' });
    const img = app.media.save(new Uint8Array([137, 80, 78, 71, 9]), 'image/png');
    const b = app.canvases.create({ kind: 'board', title: 'Planejamento' });
    const scene = {
      elements: [
        el('t1', 'rectangle', 10, 20, { customData: { kind: 'task', taskId: task.id }, groupIds: ['g1'] }),
        el('n1', 'rectangle', 300, 20, { customData: { kind: 'note', noteId: note.id }, groupIds: ['g1'], locked: true }),
        el('a1', 'arrow', 110, 50, { startBinding: { elementId: 't1' }, endBinding: { elementId: 'n1' } }),
        el('d1', 'freedraw', -500, 900, { points: [[0, 0], [5, 8]] }),
        el('i1', 'image', 1200, -300, { fileId: 'f1' }),
        el('x1', 'text', 0, 200, { text: 'Fase 1' }),
      ],
      appState: { scrollX: -4321, scrollY: 1234, zoom: { value: 0.35 }, gridModeEnabled: true },
      files: { f1: { mimeType: 'image/png', hash: img.slice('ws-media://'.length) } },
    };
    app.canvases.update(b.id, { scene_json: JSON.stringify(scene) });
    app.canvases.link(b.id, 'task', task.id);
    app.db.close();

    app = await openApp(file);
    const back = app.canvases.get(b.id);
    expect(JSON.parse(back.scene_json)).toEqual(scene);
    expect(back.links.map((l) => l.title)).toEqual(['Tarefa no quadro']);
    expect(app.media.get(scene.files.f1.hash)).not.toBeNull();
  });
});

describe('Teste 4 — tarefa no quadro é o mesmo registro', () => {
  it('status alterado pelo quadro aparece na lista e no Kanban', async () => {
    const { tasks, canvases } = await openApp(':memory:');
    const t = tasks.create({ title: 'Sincronizada' });
    // o quadro guarda só a referência (taskId); o título/status vêm sempre do registro
    tasks.update(t.id, { status: 'done' }); // ação disparada pelo painel do quadro
    expect(canvases.taskBriefs([t.id])[0]).toMatchObject({ status: 'done', title: 'Sincronizada', deleted: false });
    expect(tasks.list({ statuses: ['done'] })).toHaveLength(1);
    tasks.remove(t.id);
    expect(canvases.taskBriefs([t.id])[0].deleted).toBe(true);
  });
});

describe('Desenhos e quadros', () => {
  it('rejeita cena inválida sem alterar dados', async () => {
    const { canvases } = await openApp(':memory:');
    const c = canvases.create({ kind: 'drawing', title: 'Esboço' });
    expect(() => canvases.update(c.id, { scene_json: '{"elements":"x"}' })).toThrow();
    expect(() => canvases.update(c.id, { scene_json: 'quebrado' })).toThrow();
    expect(canvases.get(c.id).revision).toBe(0);
  });

  it('versões automáticas por intervalo e restauração', async () => {
    const { canvases } = await openApp(':memory:');
    const c = canvases.create({ kind: 'drawing' });
    const s = (n: number) => JSON.stringify({ elements: Array.from({ length: n }, (_, i) => el('e' + i, 'rectangle', i, i)), appState: {}, files: {} });
    const t0 = Date.now();
    canvases.update(c.id, { scene_json: s(1) }, t0);      // cena vazia: sem versão
    canvases.update(c.id, { scene_json: s(2) }, t0);      // versão com 1 elemento
    canvases.update(c.id, { scene_json: s(3) }, t0 + 10); // dentro do intervalo
    expect(canvases.versions(c.id)).toHaveLength(1);
    canvases.update(c.id, { scene_json: s(4) }, Date.parse(canvases.versions(c.id)[0].created_at) + CANVAS_AUTO_VERSION_MS);
    expect(canvases.versions(c.id)).toHaveLength(2);
    canvases.restoreVersion(canvases.versions(c.id).at(-1)!.id);
    expect(JSON.parse(canvases.get(c.id).scene_json).elements).toHaveLength(1);
    expect(canvases.versions(c.id)[0].reason).toBe('antes de restaurar');
  });

  it('lista por tipo, pesquisa texto dos elementos, duplica, lixeira e vínculos', async () => {
    const { canvases, tasks, notes, org, svc, db } = await openApp(':memory:');
    const t = tasks.create({ title: 'T' }); const n = notes.create({ title: 'N' });
    const d = canvases.create({ kind: 'drawing', title: 'Fluxo', task_id: t.id, note_id: n.id });
    canvases.update(d.id, { scene_json: JSON.stringify({ elements: [el('x', 'text', 0, 0, { text: 'Arquitetura do servidor' })], appState: {}, files: {} }) });
    canvases.create({ kind: 'board', title: 'Quadro' });
    expect(canvases.list('drawing')).toHaveLength(1);
    expect(canvases.list('board')).toHaveLength(1);
    expect(canvases.list('drawing', { search: 'servidor' })).toHaveLength(1);
    expect(canvases.list('drawing', { task_id: t.id })).toHaveLength(1);
    expect(canvases.list('drawing', { note_id: n.id })).toHaveLength(1);
    expect(searchAll(db, 1, 'servidor').map((h) => h.type)).toEqual(['drawing']);
    expect(sceneText(canvases.get(d.id).scene_json)).toBe('Arquitetura do servidor');
    const copy = canvases.duplicate(d.id);
    expect(copy.links).toHaveLength(2);
    canvases.remove(d.id);
    expect(org.trash().find((x) => x.entity_type === 'canvas')?.title).toBe('Desenho: Fluxo');
    org.restore('canvas', d.id, svc);
    expect(canvases.list('drawing')).toHaveLength(2);
    canvases.remove(d.id); org.emptyTrash();
    tasks.remove(t.id); tasks.purge(t.id);
    expect(canvases.get(copy.id).links.map((l) => l.type)).toEqual(['note']); // vínculo removido com a tarefa
    expect(org.dashboard(svc).recentDrawings).toHaveLength(1);
  });
});

describe('Atualização v2 → v3', () => {
  it('migra banco da Etapa 2 com backup e mantém notas', async () => {
    const dir = tmpDir(); const file = path.join(dir, 'v2.sqlite');
    const db = openDatabase(file);
    for (const m of MIGRATIONS.slice(0, 2)) db.transaction(() => { db.exec(m.up); db.pragma(`user_version = ${m.version}`); })();
    db.prepare("INSERT INTO notes (workspace_id, title) VALUES (1, 'da etapa 2')").run();
    const rep = await migrate(db, path.join(dir, 'backups'));
    expect(rep).toMatchObject({ from: 2, to: 3 });
    expect(fs.existsSync(rep.backupPath!)).toBe(true);
    expect((db.prepare('SELECT title FROM notes').get() as { title: string }).title).toBe('da etapa 2');
  });
});
