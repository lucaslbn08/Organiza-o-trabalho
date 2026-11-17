import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openApp, tmpDir } from './helpers';
import { advance } from '../src/main/services/tasks';

describe('Teste 1 — Tarefas persistem após fechar e reabrir', () => {
  it('preserva 10 tarefas e seus status', async () => {
    const file = path.join(tmpDir(), 'workspace.sqlite');
    let app = await openApp(file);
    const ids = Array.from({ length: 10 }, (_, i) => app.tasks.create({ title: `Tarefa ${i + 1}` }).id);
    ids.slice(0, 3).forEach((id) => app.tasks.update(id, { status: 'done' }));
    ids.slice(3, 7).forEach((id) => app.tasks.update(id, { status: 'in_progress' }));
    app.db.close();

    app = await openApp(file);
    const all = app.tasks.list();
    expect(all).toHaveLength(10);
    expect(all.filter((t) => t.status === 'done')).toHaveLength(3);
    expect(all.filter((t) => t.status === 'in_progress')).toHaveLength(4);
    expect(all.filter((t) => t.status === 'pending')).toHaveLength(3);
    expect(all.filter((t) => t.status === 'done').every((t) => t.completed_at)).toBe(true);
    app.db.close();
  });
});

describe('Gerenciador de tarefas', () => {
  it('filtra, pesquisa por etiqueta e ordena por prioridade', async () => {
    const { tasks } = await openApp(':memory:');
    tasks.create({ title: 'Relatório', priority: 'low', tags: ['trabalho'] });
    tasks.create({ title: 'Comprar café', priority: 'urgent', description: 'grãos' });
    tasks.create({ title: 'Ler livro', priority: 'high', status: 'done' });
    expect(tasks.list({ search: 'trab' }).map((t) => t.title)).toEqual(['Relatório']);
    expect(tasks.list({ search: 'grãos' })).toHaveLength(1);
    expect(tasks.list({ search: '100%' })).toHaveLength(0);
    expect(tasks.list({ sort: 'priority' }).map((t) => t.priority)).toEqual(['urgent', 'high', 'low']);
    expect(tasks.list({ showCompleted: false })).toHaveLength(2);
    expect(tasks.list({ priorities: ['urgent', 'high'], statuses: ['pending'] })).toHaveLength(1);
  });

  it('duplica com checklist, envia para lixeira e restaura', async () => {
    const { tasks, org, notes } = await openApp(':memory:');
    const t = tasks.create({ title: 'Original', tags: ['a', 'b'] });
    tasks.addChecklist(t.id, 'subtask', 'passo 1');
    const s2 = tasks.addChecklist(t.id, 'subtask', 'passo 2');
    tasks.updateChecklist(s2.id, { done: true });
    expect(tasks.get(t.id).progress).toEqual({ done: 1, total: 2 });

    const copy = tasks.duplicate(t.id);
    expect(copy.title).toBe('Original (cópia)');
    expect(copy.tags.map((x) => x.name)).toEqual(['a', 'b']);
    expect(copy.progress).toEqual({ done: 0, total: 2 });

    tasks.remove(t.id);
    expect(tasks.list()).toHaveLength(1);
    expect(org.trash()).toHaveLength(1);
    org.restore('task', t.id, tasks, notes);
    expect(tasks.list()).toHaveLength(2);
    expect(() => tasks.purge(t.id)).toThrow();
    tasks.remove(t.id);
    org.emptyTrash();
    expect(org.trash()).toHaveLength(0);
    expect(tasks.list()).toHaveLength(1);
  });

  it('registra histórico de mudança de status', async () => {
    const { tasks } = await openApp(':memory:');
    const t = tasks.create({ title: 'X' });
    tasks.update(t.id, { status: 'paused' });
    const h = tasks.detail(t.id).history.map((x) => x.details);
    expect(h).toContain('Pendente → Pausada');
  });

  it('tarefa recorrente gera a próxima ocorrência ao ser concluída', async () => {
    const { tasks } = await openApp(':memory:');
    const t = tasks.create({ title: 'Revisar semana', recurrence: 'weekly', due_date: '2026-11-16' });
    tasks.addChecklist(t.id, 'checklist', 'item');
    tasks.update(t.id, { status: 'done' });
    const open = tasks.list({ showCompleted: false });
    expect(open).toHaveLength(1);
    expect(open[0].due_date).toBe('2026-11-23');
    expect(open[0].recurrence).toBe('weekly');
    expect(open[0].progress).toEqual({ done: 0, total: 1 });
    expect(tasks.get(t.id).recurrence).toBe('none');
  });

  it('advance mensal respeita fim do mês', () => {
    expect(advance(new Date(2026, 0, 31, 12), 'monthly').getDate()).toBe(28);
  });
});

describe('Teste 4 — Sincronização Lista ↔ Kanban (mesmo registro)', () => {
  it('mover no Kanban altera o status visto pela lista', async () => {
    const { tasks, org, notes } = await openApp(':memory:');
    const a = tasks.create({ title: 'A' });
    const b = tasks.create({ title: 'B' });
    tasks.reorder([b.id, a.id], 'in_progress');
    const list = tasks.list({ statuses: ['in_progress'] });
    expect(list.map((t) => t.title)).toEqual(['B', 'A']);
    expect(tasks.list()).toHaveLength(2); // sem duplicação
    expect(org.dashboard(tasks, notes).in_progress).toBe(2);
  });
});

describe('Reordenação com filtros', () => {
  it('reordenar subconjunto não altera a posição das tarefas ocultas', async () => {
    const { tasks } = await openApp(':memory:');
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((t) => tasks.create({ title: t }));
    tasks.update(b.id, { priority: 'high' }); tasks.update(d.id, { priority: 'high' });
    tasks.reorder([d.id, b.id]); // lista filtrada só com prioridade alta
    expect(tasks.list().map((t) => t.title)).toEqual(['A', 'D', 'C', 'B']);
    expect(a && c).toBeTruthy();
  });
});
