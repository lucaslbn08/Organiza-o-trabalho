import type { DB } from '../db/connection';
import type {
  Task, TaskDetail, TaskInput, TaskPatch, TaskQuery, TaskStatus, Tag, ChecklistItem, TaskComment, TaskLink, Recurrence,
} from '../../shared/types';
import { STATUS_LABEL, PRIORITY_LABEL } from '../../shared/types';
import { logHistory } from './history';

type Row = Omit<Task, 'tags' | 'progress'>;
const now = () => new Date().toISOString();

export class TaskService {
  constructor(private db: DB, private ws: () => number) {}

  private hydrate(rows: Row[]): Task[] {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const tagRows = this.db.prepare(
      `SELECT tt.task_id, t.id, t.workspace_id, t.name, t.color FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.task_id IN (${ph}) ORDER BY t.name`,
    ).all(...ids) as (Tag & { task_id: number })[];
    const prog = this.db.prepare(
      `SELECT task_id, SUM(done) AS done, COUNT(*) AS total FROM checklist_items WHERE task_id IN (${ph}) GROUP BY task_id`,
    ).all(...ids) as { task_id: number; done: number; total: number }[];
    const tagMap = new Map<number, Tag[]>();
    for (const t of tagRows) {
      const { task_id, ...tag } = t;
      (tagMap.get(task_id) ?? tagMap.set(task_id, []).get(task_id)!).push(tag);
    }
    const progMap = new Map(prog.map((p) => [p.task_id, { done: p.done ?? 0, total: p.total }]));
    return rows.map((r) => ({ ...r, tags: tagMap.get(r.id) ?? [], progress: progMap.get(r.id) ?? { done: 0, total: 0 } }));
  }

  private row(id: number, includeDeleted = false): Row {
    const r = this.db.prepare(`SELECT * FROM tasks WHERE id = ? AND workspace_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`)
      .get(id, this.ws()) as Row | undefined;
    if (!r) throw new Error('Tarefa não encontrada.');
    return r;
  }

  get(id: number): Task { return this.hydrate([this.row(id)])[0]; }

  detail(id: number): TaskDetail {
    const t = this.get(id);
    return {
      ...t,
      checklist: this.db.prepare('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY kind, position, id').all(id) as ChecklistItem[],
      comments: this.db.prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY id').all(id) as TaskComment[],
      links: this.db.prepare('SELECT * FROM task_links WHERE task_id = ? ORDER BY id').all(id) as TaskLink[],
      history: this.db.prepare("SELECT * FROM history WHERE entity_type = 'task' AND entity_id = ? ORDER BY id DESC LIMIT 100").all(id) as TaskDetail['history'],
    };
  }

  list(q: TaskQuery = {}): Task[] {
    const where = ['t.workspace_id = ?', 't.deleted_at IS NULL', 't.parent_id IS NULL'];
    const args: unknown[] = [this.ws()];
    if (q.statuses?.length) { where.push(`t.status IN (${q.statuses.map(() => '?').join(',')})`); args.push(...q.statuses); }
    if (q.priorities?.length) { where.push(`t.priority IN (${q.priorities.map(() => '?').join(',')})`); args.push(...q.priorities); }
    if (q.project_id !== undefined) { where.push(q.project_id === null ? 't.project_id IS NULL' : 't.project_id = ?'); if (q.project_id !== null) args.push(q.project_id); }
    if (q.category_id !== undefined) { where.push(q.category_id === null ? 't.category_id IS NULL' : 't.category_id = ?'); if (q.category_id !== null) args.push(q.category_id); }
    if (q.showCompleted === false) where.push("t.status NOT IN ('done','cancelled')");
    if (q.search?.trim()) {
      const s = `%${q.search.trim().replace(/[%_\\]/g, (c) => '\\' + c)}%`;
      where.push(`(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM task_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.task_id = t.id AND g.name LIKE ? ESCAPE '\\'))`);
      args.push(s, s, s);
    }
    const order: Record<string, string> = {
      manual: 't.position, t.id',
      title: 't.title COLLATE NOCASE, t.id',
      created: 't.created_at DESC, t.id DESC',
      due: 't.due_date IS NULL, t.due_date, t.position',
      priority: "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.position",
    };
    const rows = this.db.prepare(`SELECT t.* FROM tasks t WHERE ${where.join(' AND ')} ORDER BY ${order[q.sort ?? 'manual'] ?? order.manual}`).all(...args) as Row[];
    return this.hydrate(rows);
  }

  private setTags(taskId: number, names: string[]): void {
    const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    this.db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);
    const ins = this.db.prepare('INSERT INTO tags (workspace_id, name) VALUES (?, ?) ON CONFLICT(workspace_id, name) DO NOTHING');
    const find = this.db.prepare('SELECT id FROM tags WHERE workspace_id = ? AND name = ?');
    const link = this.db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)');
    for (const n of clean) {
      ins.run(this.ws(), n);
      link.run(taskId, (find.get(this.ws(), n) as { id: number }).id);
    }
  }

  private nextPosition(): number {
    const r = this.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE workspace_id = ?').get(this.ws()) as { p: number };
    return r.p;
  }

  create(input: TaskInput): Task {
    return this.db.transaction(() => {
      const status = input.status ?? 'pending';
      const info = this.db.prepare(`INSERT INTO tasks (workspace_id, project_id, category_id, title, description, status, priority, due_date, recurrence, position, completed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        this.ws(), input.project_id ?? null, input.category_id ?? null, input.title.trim(), input.description ?? '',
        status, input.priority ?? 'normal', input.due_date ?? null, input.recurrence ?? 'none', this.nextPosition(),
        status === 'done' ? now() : null,
      );
      const id = Number(info.lastInsertRowid);
      if (input.tags) this.setTags(id, input.tags);
      logHistory(this.db, this.ws(), 'task', id, 'criada', input.title.trim());
      return this.get(id);
    })();
  }

  update(id: number, patch: TaskPatch): Task {
    return this.db.transaction(() => {
      const before = this.row(id);
      const fields: string[] = []; const args: unknown[] = [];
      const simple = ['title', 'description', 'priority', 'project_id', 'category_id', 'due_date', 'recurrence'] as const;
      for (const k of simple) {
        if (patch[k] !== undefined) { fields.push(`${k} = ?`); args.push(k === 'title' ? String(patch[k]).trim() : patch[k]); }
      }
      if (fields.length) {
        this.db.prepare(`UPDATE tasks SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, now(), id);
      }
      if (patch.priority && patch.priority !== before.priority) {
        logHistory(this.db, this.ws(), 'task', id, 'prioridade alterada', `${PRIORITY_LABEL[before.priority]} → ${PRIORITY_LABEL[patch.priority]}`);
      }
      if (patch.title && patch.title.trim() !== before.title) logHistory(this.db, this.ws(), 'task', id, 'renomeada', `${before.title} → ${patch.title.trim()}`);
      if (patch.due_date !== undefined && patch.due_date !== before.due_date) logHistory(this.db, this.ws(), 'task', id, 'prazo alterado', patch.due_date ?? 'sem prazo');
      if (patch.tags) this.setTags(id, patch.tags);
      if (patch.status && patch.status !== before.status) this.applyStatus(before, patch.status);
      return this.get(id);
    })();
  }

  /** Mudança de status com histórico, data de conclusão e recorrência. Deve rodar dentro de transação. */
  private applyStatus(before: Row, status: TaskStatus): void {
    this.db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(status, status === 'done' ? now() : null, now(), before.id);
    logHistory(this.db, this.ws(), 'task', before.id, 'status alterado', `${STATUS_LABEL[before.status]} → ${STATUS_LABEL[status]}`);
    if (status === 'done' && before.recurrence !== 'none') this.spawnRecurrence(before);
  }

  private spawnRecurrence(t: Row): void {
    const base = t.due_date ? new Date(t.due_date + 'T12:00:00') : new Date();
    const next = advance(base, t.recurrence);
    const tags = (this.db.prepare('SELECT g.name FROM task_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.task_id = ?').all(t.id) as { name: string }[]).map((x) => x.name);
    const created = this.create({
      title: t.title, description: t.description, priority: t.priority, project_id: t.project_id,
      category_id: t.category_id, due_date: next.toISOString().slice(0, 10), recurrence: t.recurrence, tags,
    });
    this.db.prepare(`INSERT INTO checklist_items (task_id, kind, text, done, position) SELECT ?, kind, text, 0, position FROM checklist_items WHERE task_id = ?`).run(created.id, t.id);
    // a recorrência passa a ser responsabilidade da nova ocorrência
    this.db.prepare("UPDATE tasks SET recurrence = 'none' WHERE id = ?").run(t.id);
    logHistory(this.db, this.ws(), 'task', created.id, 'recorrência gerada', `a partir da tarefa #${t.id}`);
  }

  duplicate(id: number): Task {
    return this.db.transaction(() => {
      const src = this.detail(id);
      const copy = this.create({
        title: `${src.title} (cópia)`, description: src.description, status: 'pending', priority: src.priority,
        project_id: src.project_id, category_id: src.category_id, due_date: src.due_date, recurrence: src.recurrence,
        tags: src.tags.map((t) => t.name),
      });
      const ins = this.db.prepare('INSERT INTO checklist_items (task_id, kind, text, done, position) VALUES (?,?,?,0,?)');
      for (const c of src.checklist) ins.run(copy.id, c.kind, c.text, c.position);
      const insL = this.db.prepare('INSERT INTO task_links (task_id, label, url) VALUES (?,?,?)');
      for (const l of src.links) insL.run(copy.id, l.label, l.url);
      return this.get(copy.id);
    })();
  }

  remove(id: number): void {
    this.db.transaction(() => {
      const t = this.row(id);
      this.db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(now(), id);
      logHistory(this.db, this.ws(), 'task', id, 'enviada para a lixeira', t.title);
    })();
  }

  restore(id: number): void {
    this.db.transaction(() => {
      const t = this.row(id, true);
      this.db.prepare('UPDATE tasks SET deleted_at = NULL, position = ? WHERE id = ?').run(this.nextPosition(), id);
      logHistory(this.db, this.ws(), 'task', id, 'restaurada', t.title);
    })();
  }

  purge(id: number): void {
    this.db.transaction(() => {
      const t = this.row(id, true);
      if (!t.deleted_at) throw new Error('Só é possível excluir permanentemente itens que estão na lixeira.');
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      logHistory(this.db, this.ws(), 'task', id, 'excluída permanentemente', t.title);
    })();
  }

  /** Reordena (e opcionalmente move para outro status/categoria) — usado pela lista e pelo Kanban. */
  reorder(orderedIds: number[], status?: TaskStatus, categoryId?: number | null): void {
    this.db.transaction(() => {
      const setPos = this.db.prepare('UPDATE tasks SET position = ? WHERE id = ? AND workspace_id = ?');
      const rows = orderedIds.map((id) => this.row(id));
      // reutiliza as posições já ocupadas por esses itens: tarefas ocultas por filtros mantêm sua ordem relativa
      let slots = rows.map((r) => r.position).sort((a, b) => a - b);
      if (new Set(slots).size !== slots.length) {
        const base = slots[0];
        slots = slots.map((_, i) => base + i / slots.length); // desempate raro (posições iguais)
      }
      rows.forEach((before, i) => {
        const id = before.id;
        setPos.run(slots[i], id, this.ws());
        if (categoryId !== undefined && before.category_id !== categoryId) {
          this.db.prepare('UPDATE tasks SET category_id = ?, updated_at = ? WHERE id = ?').run(categoryId, now(), id);
          logHistory(this.db, this.ws(), 'task', id, 'categoria alterada', '');
        }
        if (status && before.status !== status) this.applyStatus(before, status);
      });
    })();
  }

  addChecklist(taskId: number, kind: 'checklist' | 'subtask', text: string): ChecklistItem {
    this.row(taskId);
    const pos = (this.db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM checklist_items WHERE task_id = ?').get(taskId) as { p: number }).p;
    const info = this.db.prepare('INSERT INTO checklist_items (task_id, kind, text, position) VALUES (?,?,?,?)').run(taskId, kind, text.trim(), pos);
    return this.db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(info.lastInsertRowid) as ChecklistItem;
  }

  updateChecklist(id: number, patch: { text?: string; done?: boolean }): void {
    const item = this.db.prepare('SELECT c.* FROM checklist_items c JOIN tasks t ON t.id = c.task_id WHERE c.id = ? AND t.workspace_id = ?').get(id, this.ws()) as ChecklistItem | undefined;
    if (!item) throw new Error('Item não encontrado.');
    this.db.prepare('UPDATE checklist_items SET text = ?, done = ? WHERE id = ?')
      .run(patch.text?.trim() ?? item.text, patch.done === undefined ? item.done : patch.done ? 1 : 0, id);
    if (patch.done !== undefined && item.kind === 'subtask') {
      logHistory(this.db, this.ws(), 'task', item.task_id, patch.done ? 'subtarefa concluída' : 'subtarefa reaberta', item.text);
    }
  }

  removeChecklist(id: number): void {
    this.db.prepare('DELETE FROM checklist_items WHERE id = ? AND task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)').run(id, this.ws());
  }

  addComment(taskId: number, body: string): TaskComment {
    this.row(taskId);
    const info = this.db.prepare('INSERT INTO task_comments (task_id, body) VALUES (?,?)').run(taskId, body.trim());
    return this.db.prepare('SELECT * FROM task_comments WHERE id = ?').get(info.lastInsertRowid) as TaskComment;
  }

  addLink(taskId: number, label: string, url: string): TaskLink {
    this.row(taskId);
    const info = this.db.prepare('INSERT INTO task_links (task_id, label, url) VALUES (?,?,?)').run(taskId, label.trim() || url, url.trim());
    return this.db.prepare('SELECT * FROM task_links WHERE id = ?').get(info.lastInsertRowid) as TaskLink;
  }

  removeLink(id: number): void {
    this.db.prepare('DELETE FROM task_links WHERE id = ? AND task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)').run(id, this.ws());
  }
}

export function advance(d: Date, r: Recurrence): Date {
  const n = new Date(d);
  if (r === 'daily') n.setDate(n.getDate() + 1);
  else if (r === 'weekly') n.setDate(n.getDate() + 7);
  else if (r === 'monthly') {
    const day = n.getDate(); n.setDate(1); n.setMonth(n.getMonth() + 1);
    n.setDate(Math.min(day, new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()));
  } else if (r === 'yearly') n.setFullYear(n.getFullYear() + 1);
  return n;
}
