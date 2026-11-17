export const TASK_STATUSES = ['pending', 'in_progress', 'paused', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const RECURRENCES = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pendente', in_progress: 'Em andamento', paused: 'Pausada', done: 'Concluída', cancelled: 'Cancelada',
};
export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente',
};
export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: 'Não repete', daily: 'Diariamente', weekly: 'Semanalmente', monthly: 'Mensalmente', yearly: 'Anualmente',
};

export interface Workspace { id: number; name: string; created_at: string }
export interface Project {
  id: number; workspace_id: number; name: string; color: string; icon: string;
  description: string; created_at: string; updated_at: string; deleted_at: string | null;
}
export interface Category { id: number; workspace_id: number; name: string; color: string; position: number }
export interface Tag { id: number; workspace_id: number; name: string; color: string }

export interface ChecklistItem {
  id: number; task_id: number; kind: 'checklist' | 'subtask'; text: string; done: 0 | 1; position: number;
}
export interface TaskComment { id: number; task_id: number; body: string; created_at: string }
export interface TaskLink { id: number; task_id: number; label: string; url: string }

export interface Task {
  id: number; workspace_id: number; project_id: number | null; category_id: number | null;
  parent_id: number | null; title: string; description: string; status: TaskStatus; priority: TaskPriority;
  due_date: string | null; recurrence: Recurrence; position: number;
  created_at: string; updated_at: string; completed_at: string | null; deleted_at: string | null;
  tags: Tag[]; progress: { done: number; total: number };
}
export interface TaskDetail extends Task {
  checklist: ChecklistItem[]; comments: TaskComment[]; links: TaskLink[]; history: HistoryEntry[];
}

export interface TaskInput {
  title: string; description?: string; status?: TaskStatus; priority?: TaskPriority;
  project_id?: number | null; category_id?: number | null; due_date?: string | null;
  recurrence?: Recurrence; tags?: string[];
}
export type TaskPatch = Partial<TaskInput>;

export type TaskSort = 'manual' | 'title' | 'created' | 'due' | 'priority';
export interface TaskQuery {
  search?: string; statuses?: TaskStatus[]; priorities?: TaskPriority[];
  project_id?: number | null; category_id?: number | null; showCompleted?: boolean; sort?: TaskSort;
}

export interface KanbanColumn { id: number; workspace_id: number; status: TaskStatus; title: string; color: string; position: number; visible: 0 | 1 }

export interface HistoryEntry {
  id: number; entity_type: string; entity_id: number; action: string; details: string; created_at: string;
}
export interface TrashItem { entity_type: 'task' | 'project'; id: number; title: string; deleted_at: string }

export interface DashboardStats {
  total: number; pending: number; in_progress: number; paused: number; done: number; cancelled: number;
  priority: Task[]; dueSoon: Task[]; overdue: Task[]; recentProjects: Project[];
}

export interface Settings {
  theme: 'dark' | 'light'; accent: string; uiScale: number; animations: boolean;
  sidebarCollapsed: boolean; showCompleted: boolean;
  dashboardPanels: { id: string; visible: boolean }[];
  lastView: string; activeWorkspaceId: number;
}

export interface AppInfo { version: string; dbVersion: number; dataDir: string; platform: string; electron: string }

/** API exposta ao renderer pelo preload (contextBridge). */
export interface WorkspaceApi {
  app: { info(): Promise<AppInfo>; openDataDir(): Promise<void> };
  settings: { get(): Promise<Settings>; set(patch: Partial<Settings>): Promise<Settings> };
  workspaces: { list(): Promise<Workspace[]>; create(name: string): Promise<Workspace> };
  projects: {
    list(): Promise<Project[]>; create(input: { name: string; color?: string; icon?: string; description?: string }): Promise<Project>;
    update(id: number, patch: Partial<Pick<Project, 'name' | 'color' | 'icon' | 'description'>>): Promise<Project>;
    remove(id: number): Promise<void>;
  };
  categories: { list(): Promise<Category[]>; create(name: string, color?: string): Promise<Category>; remove(id: number): Promise<void> };
  tags: { list(): Promise<Tag[]> };
  tasks: {
    list(q: TaskQuery): Promise<Task[]>; get(id: number): Promise<TaskDetail>;
    create(input: TaskInput): Promise<Task>; update(id: number, patch: TaskPatch): Promise<Task>;
    duplicate(id: number): Promise<Task>; remove(id: number): Promise<void>;
    reorder(orderedIds: number[], status?: TaskStatus, categoryId?: number | null): Promise<void>;
    addChecklist(taskId: number, kind: 'checklist' | 'subtask', text: string): Promise<ChecklistItem>;
    updateChecklist(id: number, patch: { text?: string; done?: boolean }): Promise<void>;
    removeChecklist(id: number): Promise<void>;
    addComment(taskId: number, body: string): Promise<TaskComment>;
    addLink(taskId: number, label: string, url: string): Promise<TaskLink>;
    removeLink(id: number): Promise<void>;
  };
  kanban: {
    columns(): Promise<KanbanColumn[]>;
    updateColumn(id: number, patch: { title?: string; color?: string; visible?: boolean }): Promise<void>;
  };
  dashboard: { stats(): Promise<DashboardStats> };
  history: { list(limit?: number): Promise<HistoryEntry[]> };
  trash: { list(): Promise<TrashItem[]>; restore(type: TrashItem['entity_type'], id: number): Promise<void>; purge(type: TrashItem['entity_type'], id: number): Promise<void>; empty(): Promise<void> };
  db: { checkIntegrity(): Promise<{ ok: boolean; message: string }> };
  onDataChanged(cb: (scope: string) => void): () => void;
}
