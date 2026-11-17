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
  due_date: string | null; due_time: string | null; recurrence: Recurrence; position: number;
  created_at: string; updated_at: string; completed_at: string | null; deleted_at: string | null;
  tags: Tag[]; progress: { done: number; total: number };
}
export interface TaskDetail extends Task {
  checklist: ChecklistItem[]; comments: TaskComment[]; links: TaskLink[]; history: HistoryEntry[];
}

export interface TaskInput {
  title: string; description?: string; status?: TaskStatus; priority?: TaskPriority;
  project_id?: number | null; category_id?: number | null; due_date?: string | null; due_time?: string | null;
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
export interface TrashItem { entity_type: 'task' | 'project' | 'note' | 'canvas' | 'attachment'; id: number; title: string; deleted_at: string }

export interface DashboardStats {
  total: number; pending: number; in_progress: number; paused: number; done: number; cancelled: number;
  priority: Task[]; dueSoon: Task[]; overdue: Task[]; recentProjects: Project[]; recentNotes: NoteSummary[]; recentDrawings: CanvasSummary[]; recentBoards: CanvasSummary[];
}

export interface Settings {
  theme: 'dark' | 'light'; accent: string; uiScale: number; animations: boolean;
  sidebarCollapsed: boolean; showCompleted: boolean;
  dashboardPanels: { id: string; visible: boolean }[];
  lastView: string; activeWorkspaceId: number;
  openNotes: number[]; activeNote: number | null;
  openCanvas: { drawing: number | null; board: number | null }; wheelZoom: boolean;
  notificationsEnabled: boolean; systemNotifications: boolean; dueReminderTime: string | null;
  tabs: AppTab[]; activeTab: string; split: { tabId: string; dir: 'vertical' | 'horizontal' } | null;
}
export interface AppTab { id: string; view: string; arg?: number }

export interface AppInfo { version: string; dbVersion: number; dataDir: string; platform: string; electron: string }

export interface NoteFolder { id: number; workspace_id: number; parent_id: number | null; name: string; position: number }
export interface NoteSummary {
  id: number; title: string; folder_id: number | null; project_id: number | null; category_id: number | null;
  pinned: 0 | 1; favorite: 0 | 1; created_at: string; updated_at: string; excerpt: string; tags: Tag[];
}
export interface Note extends NoteSummary {
  content_json: string; revision: number; tasks: { id: number; title: string; status: TaskStatus }[];
}
export interface NoteVersion { id: number; note_id: number; title: string; reason: string; created_at: string; size: number }
export interface NoteQuery {
  search?: string; folder_id?: number | null; project_id?: number; task_id?: number; favorites?: boolean;
  tag?: string; category_id?: number;
}
export interface NotePatch {
  title?: string; content_json?: string; folder_id?: number | null; project_id?: number | null; category_id?: number | null;
  pinned?: boolean; favorite?: boolean; tags?: string[];
}
export type SearchType = 'task' | 'note' | 'project' | 'tag' | 'drawing' | 'board' | 'file';
export interface SearchHit { type: SearchType; id: number; title: string; snippet: string; extra?: string }

export type CanvasKind = 'drawing' | 'board';
export interface CanvasSummary {
  id: number; kind: CanvasKind; title: string; project_id: number | null; thumbnail: string | null;
  created_at: string; updated_at: string; opened_at: string | null;
}
export interface Canvas extends CanvasSummary {
  scene_json: string; revision: number; links: { type: 'task' | 'note'; id: number; title: string }[];
}
export interface CanvasVersion { id: number; canvas_id: number; reason: string; created_at: string; size: number }
export interface TaskBrief { id: number; title: string; status: TaskStatus; priority: TaskPriority; due_date: string | null; deleted: boolean }
export interface NoteBrief { id: number; title: string; excerpt: string; deleted: boolean }

export type AttachmentTarget = 'task' | 'note' | 'project' | 'canvas';
export interface Attachment {
  id: number; name: string; original_name: string; mode: 'internal' | 'link'; stored_path: string; mime: string; size: number;
  folder: string; created_at: string; missing: boolean; link_count: number;
}
export interface AttachmentDetail extends Attachment { links: { type: AttachmentTarget; id: number; title: string }[]; absolute_path: string }
export interface ImportResult { imported: Attachment[]; errors: { name: string; message: string }[] }
export interface Reminder { id: number; task_id: number | null; title: string; remind_at: string; fired_at: string | null; dismissed_at: string | null; task_title: string | null }
export interface NotificationCenter { overdue: Task[]; today: Task[]; upcoming: Task[]; reminders: Reminder[]; count: number }
export interface FloatingNote {
  id: number; task_id: number | null; task_title: string | null; content: string; color: string; x: number | null; y: number | null;
  width: number; height: number; always_on_top: 0 | 1; minimized: 0 | 1; is_open: 0 | 1; updated_at: string;
}
export interface CaptureSource { id: string; name: string; kind: 'screen' | 'window'; thumbnail: string }
export type CaptureTarget = { type: 'clipboard' } | { type: 'new-note' } | { type: 'note' | 'task' | 'drawing' | 'board'; id: number };

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
  notes: {
    list(q: NoteQuery): Promise<NoteSummary[]>; get(id: number): Promise<Note>;
    create(input?: { title?: string; folder_id?: number | null; project_id?: number | null; task_id?: number }): Promise<Note>;
    update(id: number, patch: NotePatch): Promise<{ revision: number; updated_at: string }>;
    duplicate(id: number): Promise<Note>; remove(id: number): Promise<void>;
    linkTask(noteId: number, taskId: number): Promise<void>; unlinkTask(noteId: number, taskId: number): Promise<void>;
    versions(noteId: number): Promise<NoteVersion[]>; versionContent(versionId: number): Promise<{ title: string; content_json: string }>;
    snapshot(noteId: number): Promise<void>; restoreVersion(versionId: number): Promise<void>;
    folders(): Promise<NoteFolder[]>; createFolder(name: string, parentId: number | null): Promise<NoteFolder>;
    renameFolder(id: number, name: string): Promise<void>; moveFolder(id: number, parentId: number | null): Promise<void>;
    removeFolder(id: number): Promise<void>;
  };
  media: { save(bytes: Uint8Array, mime: string): Promise<string>; get(hash: string): Promise<{ mime: string; bytes: Uint8Array } | null> };
  canvases: {
    list(kind: CanvasKind, q?: { search?: string; project_id?: number; task_id?: number; note_id?: number }): Promise<CanvasSummary[]>;
    get(id: number): Promise<Canvas>;
    create(input: { kind: CanvasKind; title?: string; project_id?: number | null; task_id?: number; note_id?: number }): Promise<Canvas>;
    update(id: number, patch: { title?: string; scene_json?: string; project_id?: number | null; thumbnail?: string | null }): Promise<{ revision: number; updated_at: string }>;
    duplicate(id: number): Promise<Canvas>; remove(id: number): Promise<void>; touch(id: number): Promise<void>;
    link(id: number, type: 'task' | 'note', targetId: number): Promise<void>; unlink(id: number, type: 'task' | 'note', targetId: number): Promise<void>;
    versions(id: number): Promise<CanvasVersion[]>; snapshot(id: number): Promise<void>; restoreVersion(versionId: number): Promise<void>;
  };
  briefs: { tasks(ids: number[]): Promise<TaskBrief[]>; notes(ids: number[]): Promise<NoteBrief[]> };
  files: {
    saveAs(bytes: Uint8Array, defaultName: string, ext: 'png' | 'pdf'): Promise<string | null>;
    list(q?: { search?: string; folder?: string; target?: { type: AttachmentTarget; id: number }; missingOnly?: boolean }): Promise<Attachment[]>;
    get(id: number): Promise<AttachmentDetail>;
    pick(mode: 'internal' | 'link', target?: { type: AttachmentTarget; id: number }): Promise<ImportResult>;
    importPaths(paths: string[], mode: 'internal' | 'link', target?: { type: AttachmentTarget; id: number }): Promise<ImportResult>;
    importBytes(name: string, bytes: Uint8Array, mime: string, target?: { type: AttachmentTarget; id: number }, folder?: string): Promise<Attachment>;
    rename(id: number, name: string): Promise<void>; setFolder(id: number, folder: string): Promise<void>;
    remove(id: number): Promise<void>; open(id: number): Promise<void>; reveal(id: number): Promise<void>;
    read(id: number): Promise<{ mime: string; bytes: Uint8Array }>;
    link(id: number, type: AttachmentTarget, targetId: number): Promise<void>; unlink(id: number, type: AttachmentTarget, targetId: number): Promise<void>;
    relink(id: number): Promise<boolean>; embed(id: number): Promise<void>;
    pathForFile(file: File): string;
  };
  reminders: {
    list(): Promise<Reminder[]>; create(input: { task_id?: number | null; title: string; remind_at: string }): Promise<Reminder>;
    remove(id: number): Promise<void>; dismiss(id: number): Promise<void>; snooze(id: number, minutes: number): Promise<void>;
    center(): Promise<NotificationCenter>;
  };
  agenda: { range(from: string, to: string): Promise<{ tasks: Task[]; reminders: Reminder[] }> };
  floating: {
    list(): Promise<FloatingNote[]>; get(id: number): Promise<FloatingNote>;
    create(input?: { content?: string; task_id?: number | null; color?: string }): Promise<FloatingNote>;
    update(id: number, patch: Partial<Pick<FloatingNote, 'content' | 'color' | 'task_id'>> & { always_on_top?: boolean; minimized?: boolean }): Promise<void>;
    open(id: number): Promise<void>; close(id: number): Promise<void>; remove(id: number): Promise<void>;
  };
  capture: {
    sources(): Promise<CaptureSource[]>; take(sourceId: string): Promise<Uint8Array>; region(): Promise<Uint8Array | null>;
    send(png: Uint8Array, target: CaptureTarget): Promise<string>;
    regionInit(): Promise<{ dataURL: string; width: number; height: number }>; regionDone(rect: { x: number; y: number; width: number; height: number } | null): Promise<void>;
  };
  onEvent(cb: (e: { type: 'reminder'; reminder: Reminder } | { type: 'navigate'; view: string; id?: number } | { type: 'notice'; title: string; body: string; view: string; id?: number }) => void): () => void;
  search: { query(q: string, types?: SearchType[]): Promise<SearchHit[]> };
  trash: { list(): Promise<TrashItem[]>; restore(type: TrashItem['entity_type'], id: number): Promise<void>; purge(type: TrashItem['entity_type'], id: number): Promise<void>; empty(): Promise<void> };
  db: { checkIntegrity(): Promise<{ ok: boolean; message: string }> };
  onDataChanged(cb: (scope: string) => void): () => void;
  onFlushRequest(cb: () => Promise<void>): void;
}
