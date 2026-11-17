import type { DB } from '../db/connection';
import type { Reminder, NotificationCenter, FloatingNote, Task } from '../../shared/types';
import type { TaskService } from './tasks';

const now = () => new Date().toISOString();
const localDate = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const REM_SQL = 'SELECT r.id, r.task_id, r.title, r.remind_at, r.fired_at, r.dismissed_at, t.title AS task_title FROM reminders r LEFT JOIN tasks t ON t.id = r.task_id';

/** Agenda, lembretes e central de notificações. Sem cronômetros nem medição de tempo trabalhado. */
export class PlanningService {
  constructor(private db: DB, private ws: () => number, private tasks: TaskService) {}

  listReminders(): Reminder[] {
    return this.db.prepare(`${REM_SQL} WHERE r.workspace_id = ? AND r.dismissed_at IS NULL AND (r.task_id IS NULL OR t.deleted_at IS NULL) ORDER BY r.remind_at`).all(this.ws()) as Reminder[];
  }
  createReminder(i: { task_id?: number | null; title: string; remind_at: string }): Reminder {
    if (Number.isNaN(Date.parse(i.remind_at))) throw new Error('Data/hora inválida.');
    if (i.task_id && !this.db.prepare('SELECT 1 FROM tasks WHERE id = ? AND workspace_id = ?').get(i.task_id, this.ws())) throw new Error('Tarefa não encontrada.');
    const id = Number(this.db.prepare('INSERT INTO reminders (workspace_id, task_id, title, remind_at) VALUES (?,?,?,?)').run(this.ws(), i.task_id ?? null, i.title.trim(), new Date(i.remind_at).toISOString()).lastInsertRowid);
    return this.db.prepare(`${REM_SQL} WHERE r.id = ?`).get(id) as Reminder;
  }
  removeReminder(id: number): void { this.db.prepare('DELETE FROM reminders WHERE id = ? AND workspace_id = ?').run(id, this.ws()); }
  dismiss(id: number): void { this.db.prepare('UPDATE reminders SET dismissed_at = ? WHERE id = ? AND workspace_id = ?').run(now(), id, this.ws()); }
  snooze(id: number, minutes: number, nowMs = Date.now()): void {
    this.db.prepare('UPDATE reminders SET remind_at = ?, fired_at = NULL WHERE id = ? AND workspace_id = ?').run(new Date(nowMs + minutes * 6e4).toISOString(), id, this.ws());
  }

  /** Lembretes vencidos ainda não disparados (de todos os espaços). Marca como disparados na mesma transação. */
  takeDue(nowMs = Date.now()): Reminder[] {
    return this.db.transaction(() => {
      const due = this.db.prepare(`${REM_SQL} WHERE r.fired_at IS NULL AND r.dismissed_at IS NULL AND r.remind_at <= ? AND (r.task_id IS NULL OR (t.deleted_at IS NULL AND t.status NOT IN ('done','cancelled')))`).all(new Date(nowMs).toISOString()) as Reminder[];
      const mark = this.db.prepare('UPDATE reminders SET fired_at = ? WHERE id = ?');
      for (const r of due) mark.run(now(), r.id);
      return due;
    })();
  }

  /** Aviso automático no dia do prazo (horário configurável), uma única vez por tarefa e data. */
  takeDueTasks(time: string | null, nowDate = new Date()): Task[] {
    if (!time) return [];
    const today = localDate(nowDate);
    const hhmm = nowDate.toTimeString().slice(0, 5);
    const rows = this.db.prepare(`SELECT id FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('done','cancelled') AND due_date = ?
      AND COALESCE(due_time, ?) <= ? AND NOT EXISTS (SELECT 1 FROM notification_log WHERE key = 'due:' || tasks.id || ':' || ?)`).all(today, time, hhmm, today) as { id: number }[];
    const log = this.db.prepare('INSERT OR IGNORE INTO notification_log (key) VALUES (?)');
    const out: Task[] = [];
    for (const { id } of rows) {
      log.run(`due:${id}:${today}`);
      const ws = (this.db.prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(id) as { workspace_id: number }).workspace_id;
      if (ws === this.ws()) out.push(this.tasks.get(id));
    }
    this.db.prepare("DELETE FROM notification_log WHERE created_at < datetime('now', '-60 days')").run();
    return out;
  }

  center(nowDate = new Date()): NotificationCenter {
    const today = localDate(nowDate);
    const in3 = localDate(new Date(nowDate.getTime() + 3 * 864e5));
    const open = this.tasks.list({ showCompleted: false, sort: 'due' }).filter((t) => t.due_date);
    const overdue = open.filter((t) => t.due_date! < today);
    const todayT = open.filter((t) => t.due_date === today);
    const upcoming = open.filter((t) => t.due_date! > today && t.due_date! <= in3);
    const reminders = this.listReminders().filter((r) => r.fired_at || Date.parse(r.remind_at) - nowDate.getTime() < 864e5);
    return { overdue, today: todayT, upcoming, reminders, count: overdue.length + todayT.length + reminders.filter((r) => r.fired_at).length };
  }

  agenda(from: string, to: string): { tasks: Task[]; reminders: Reminder[] } {
    const tasks = this.tasks.list({ sort: 'due' }).filter((t) => t.due_date && t.due_date >= from && t.due_date <= to);
    const reminders = this.db.prepare(`${REM_SQL} WHERE r.workspace_id = ? AND r.remind_at >= ? AND r.remind_at < ? ORDER BY r.remind_at`)
      .all(this.ws(), new Date(from + 'T00:00:00').toISOString(), new Date(to + 'T23:59:59.999').toISOString()) as Reminder[];
    return { tasks, reminders };
  }
}

const FN_SQL = 'SELECT f.*, t.title AS task_title FROM floating_notes f LEFT JOIN tasks t ON t.id = f.task_id';
export class FloatingService {
  constructor(private db: DB, private ws: () => number) {}
  list(): FloatingNote[] { return this.db.prepare(`${FN_SQL} WHERE f.workspace_id = ? AND f.deleted_at IS NULL ORDER BY f.updated_at DESC`).all(this.ws()) as FloatingNote[]; }
  openOnes(): FloatingNote[] { return this.db.prepare(`${FN_SQL} WHERE f.deleted_at IS NULL AND f.is_open = 1`).all() as FloatingNote[]; }
  get(id: number): FloatingNote {
    const f = this.db.prepare(`${FN_SQL} WHERE f.id = ? AND f.deleted_at IS NULL`).get(id) as FloatingNote | undefined;
    if (!f) throw new Error('Nota flutuante não encontrada.');
    return f;
  }
  create(i: { content?: string; task_id?: number | null; color?: string } = {}): FloatingNote {
    const id = Number(this.db.prepare('INSERT INTO floating_notes (workspace_id, content, task_id, color) VALUES (?,?,?,?)').run(this.ws(), i.content ?? '', i.task_id ?? null, i.color ?? '#fff3a3').lastInsertRowid);
    return this.get(id);
  }
  update(id: number, p: { content?: string; color?: string; task_id?: number | null; always_on_top?: boolean; minimized?: boolean; is_open?: boolean; bounds?: { x: number; y: number; width: number; height: number } }): void {
    const f = this.get(id);
    const b = p.bounds;
    this.db.prepare(`UPDATE floating_notes SET content = ?, color = ?, task_id = ?, always_on_top = ?, minimized = ?, is_open = ?, x = ?, y = ?, width = ?, height = ?, updated_at = ? WHERE id = ?`).run(
      p.content ?? f.content, p.color ?? f.color, p.task_id !== undefined ? p.task_id : f.task_id,
      p.always_on_top === undefined ? f.always_on_top : p.always_on_top ? 1 : 0, p.minimized === undefined ? f.minimized : p.minimized ? 1 : 0,
      p.is_open === undefined ? f.is_open : p.is_open ? 1 : 0, b ? Math.round(b.x) : f.x, b ? Math.round(b.y) : f.y,
      b ? Math.max(160, Math.round(b.width)) : f.width, b ? Math.max(60, Math.round(b.height)) : f.height, now(), id);
  }
  remove(id: number): void { this.db.prepare('UPDATE floating_notes SET deleted_at = ?, is_open = 0 WHERE id = ?').run(now(), id); }
}
