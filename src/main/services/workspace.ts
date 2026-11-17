import type { DB } from '../db/connection';
import type { Project, Category, Tag, Workspace, KanbanColumn, DashboardStats, TrashItem, Settings } from '../../shared/types';
import { logHistory } from './history';
import { TaskService } from './tasks';

const now = () => new Date().toISOString();

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark', accent: '#6366f1', uiScale: 1, animations: true, sidebarCollapsed: false, showCompleted: true,
  dashboardPanels: ['stats', 'priority', 'dueSoon', 'projects', 'shortcuts'].map((id) => ({ id, visible: true })),
  lastView: 'home', activeWorkspaceId: 1,
};

export class SettingsService {
  constructor(private db: DB) {}
  get(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) { try { s[r.key] = JSON.parse(r.value); } catch { /* valor corrompido: mantém padrão */ } }
    return s as unknown as Settings;
  }
  set(patch: Partial<Settings>): Settings {
    const up = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS && v !== undefined) up.run(k, JSON.stringify(v));
    })();
    return this.get();
  }
}

export class OrgService {
  constructor(private db: DB, private ws: () => number) {}

  workspaces(): Workspace[] { return this.db.prepare('SELECT * FROM workspaces ORDER BY id').all() as Workspace[]; }
  createWorkspace(name: string): Workspace {
    return this.db.transaction(() => {
      const id = Number(this.db.prepare('INSERT INTO workspaces (name) VALUES (?)').run(name.trim()).lastInsertRowid);
      this.db.prepare(`INSERT INTO kanban_columns (workspace_id, status, title, color, position) VALUES
        (?, 'pending','Pendente','#94a3b8',0), (?, 'in_progress','Em andamento','#3b82f6',1),
        (?, 'paused','Pausada','#f59e0b',2), (?, 'done','Concluída','#22c55e',3)`).run(id, id, id, id);
      logHistory(this.db, id, 'workspace', id, 'criado', name);
      return this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace;
    })();
  }

  projects(): Project[] {
    return this.db.prepare('SELECT * FROM projects WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC').all(this.ws()) as Project[];
  }
  createProject(i: { name: string; color?: string; icon?: string; description?: string }): Project {
    const id = Number(this.db.prepare('INSERT INTO projects (workspace_id, name, color, icon, description) VALUES (?,?,?,?,?)')
      .run(this.ws(), i.name.trim(), i.color ?? '#6366f1', i.icon ?? 'folder', i.description ?? '').lastInsertRowid);
    logHistory(this.db, this.ws(), 'project', id, 'criado', i.name);
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project;
  }
  updateProject(id: number, p: Partial<Pick<Project, 'name' | 'color' | 'icon' | 'description'>>): Project {
    const cur = this.db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?').get(id, this.ws()) as Project | undefined;
    if (!cur) throw new Error('Projeto não encontrado.');
    this.db.prepare('UPDATE projects SET name = ?, color = ?, icon = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(p.name?.trim() ?? cur.name, p.color ?? cur.color, p.icon ?? cur.icon, p.description ?? cur.description, now(), id);
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project;
  }
  removeProject(id: number): void {
    const r = this.db.prepare('UPDATE projects SET deleted_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').run(now(), id, this.ws());
    if (!r.changes) throw new Error('Projeto não encontrado.');
    logHistory(this.db, this.ws(), 'project', id, 'enviado para a lixeira');
  }

  categories(): Category[] { return this.db.prepare('SELECT * FROM categories WHERE workspace_id = ? ORDER BY position, id').all(this.ws()) as Category[]; }
  createCategory(name: string, color = '#64748b'): Category {
    const id = Number(this.db.prepare('INSERT INTO categories (workspace_id, name, color, position) VALUES (?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM categories WHERE workspace_id = ?))')
      .run(this.ws(), name.trim(), color, this.ws()).lastInsertRowid);
    return this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category;
  }
  removeCategory(id: number): void { this.db.prepare('DELETE FROM categories WHERE id = ? AND workspace_id = ?').run(id, this.ws()); }

  tags(): Tag[] { return this.db.prepare('SELECT * FROM tags WHERE workspace_id = ? ORDER BY name').all(this.ws()) as Tag[]; }

  columns(): KanbanColumn[] { return this.db.prepare('SELECT * FROM kanban_columns WHERE workspace_id = ? ORDER BY position').all(this.ws()) as KanbanColumn[]; }
  updateColumn(id: number, p: { title?: string; color?: string; visible?: boolean }): void {
    const c = this.db.prepare('SELECT * FROM kanban_columns WHERE id = ? AND workspace_id = ?').get(id, this.ws()) as KanbanColumn | undefined;
    if (!c) throw new Error('Coluna não encontrada.');
    this.db.prepare('UPDATE kanban_columns SET title = ?, color = ?, visible = ? WHERE id = ?')
      .run(p.title?.trim() || c.title, p.color ?? c.color, p.visible === undefined ? c.visible : p.visible ? 1 : 0, id);
  }

  dashboard(tasks: TaskService): DashboardStats {
    const counts = this.db.prepare('SELECT status, COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND deleted_at IS NULL AND parent_id IS NULL GROUP BY status').all(this.ws()) as { status: string; n: number }[];
    const c = Object.fromEntries(counts.map((x) => [x.status, x.n])) as Record<string, number>;
    const open = tasks.list({ showCompleted: false, sort: 'due' });
    const today = new Date().toISOString().slice(0, 10);
    const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    return {
      total: counts.reduce((a, x) => a + x.n, 0),
      pending: c.pending ?? 0, in_progress: c.in_progress ?? 0, paused: c.paused ?? 0, done: c.done ?? 0, cancelled: c.cancelled ?? 0,
      priority: open.filter((t) => t.priority === 'urgent' || t.priority === 'high').slice(0, 8),
      dueSoon: open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= in7).slice(0, 8),
      overdue: open.filter((t) => t.due_date && t.due_date < today).slice(0, 8),
      recentProjects: this.projects().slice(0, 6),
    };
  }

  trash(): TrashItem[] {
    return this.db.prepare(`
      SELECT 'task' AS entity_type, id, title, deleted_at FROM tasks WHERE workspace_id = ? AND deleted_at IS NOT NULL
      UNION ALL
      SELECT 'project', id, name, deleted_at FROM projects WHERE workspace_id = ? AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC`).all(this.ws(), this.ws()) as TrashItem[];
  }
  restore(type: TrashItem['entity_type'], id: number, tasks: TaskService): void {
    if (type === 'task') return tasks.restore(id);
    this.db.prepare('UPDATE projects SET deleted_at = NULL WHERE id = ? AND workspace_id = ?').run(id, this.ws());
    logHistory(this.db, this.ws(), 'project', id, 'restaurado');
  }
  purge(type: TrashItem['entity_type'], id: number, tasks: TaskService): void {
    if (type === 'task') return tasks.purge(id);
    const r = this.db.prepare('DELETE FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL').run(id, this.ws());
    if (r.changes) logHistory(this.db, this.ws(), 'project', id, 'excluído permanentemente');
  }
  emptyTrash(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM tasks WHERE workspace_id = ? AND deleted_at IS NOT NULL').run(this.ws());
      this.db.prepare('DELETE FROM projects WHERE workspace_id = ? AND deleted_at IS NOT NULL').run(this.ws());
      logHistory(this.db, this.ws(), 'trash', 0, 'lixeira esvaziada');
    })();
  }
}
