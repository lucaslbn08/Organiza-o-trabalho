/**
 * Migrações versionadas. NUNCA editar uma migração já publicada:
 * sempre adicionar uma nova com versão maior.
 */
export interface Migration { version: number; name: string; up: string }

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'base: workspaces, projetos, tarefas, kanban, histórico, configurações',
    up: `
CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6366f1', icon TEXT NOT NULL DEFAULT 'folder',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#64748b', position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE, color TEXT NOT NULL DEFAULT '#64748b',
  UNIQUE(workspace_id, name)
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','paused','done','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  due_date TEXT,
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','daily','weekly','monthly','yearly')),
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT,
  deleted_at TEXT
);
CREATE INDEX idx_tasks_ws_status ON tasks(workspace_id, status, position);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE TABLE task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE TABLE checklist_items (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'checklist' CHECK (kind IN ('checklist','subtask')),
  text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE task_comments (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE task_links (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL, url TEXT NOT NULL
);
CREATE TABLE kanban_columns (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','in_progress','paused','done','cancelled')),
  title TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#64748b',
  position INTEGER NOT NULL, visible INTEGER NOT NULL DEFAULT 1,
  UNIQUE(workspace_id, status)
);
CREATE TABLE history (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER,
  entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_history_entity ON history(entity_type, entity_id);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

INSERT INTO workspaces (id, name) VALUES (1, 'Pessoal');
INSERT INTO kanban_columns (workspace_id, status, title, color, position) VALUES
  (1,'pending','Pendente','#94a3b8',0),
  (1,'in_progress','Em andamento','#3b82f6',1),
  (1,'paused','Pausada','#f59e0b',2),
  (1,'done','Concluída','#22c55e',3);
`,
  },
];

export const LATEST_DB_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
