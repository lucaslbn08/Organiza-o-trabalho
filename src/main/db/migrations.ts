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
  {
    version: 2,
    name: 'anotações: pastas, notas, versões, vínculos, mídia e índice de texto completo',
    up: `
CREATE TABLE note_folders (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES note_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES note_folders(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  content_json TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}' CHECK (json_valid(content_json)),
  content_text TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE INDEX idx_notes_ws ON notes(workspace_id, deleted_at, updated_at);
CREATE TABLE note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE TABLE note_tasks (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, task_id)
);
CREATE TABLE note_versions (
  id INTEGER PRIMARY KEY,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  title TEXT NOT NULL, content_json TEXT NOT NULL, reason TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_note_versions ON note_versions(note_id, id);
CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE VIRTUAL TABLE notes_fts USING fts5(title, content_text, content='notes', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content_text) VALUES (new.id, new.title, new.content_text);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content_text) VALUES ('delete', old.id, old.title, old.content_text);
END;
CREATE TRIGGER notes_au AFTER UPDATE OF title, content_text ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content_text) VALUES ('delete', old.id, old.title, old.content_text);
  INSERT INTO notes_fts(rowid, title, content_text) VALUES (new.id, new.title, new.content_text);
END;
`,
  },
  {
    version: 3,
    name: 'desenhos e quadros infinitos: cenas editáveis, versões e vínculos',
    up: `
CREATE TABLE canvases (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('drawing','board')),
  title TEXT NOT NULL DEFAULT '',
  scene_json TEXT NOT NULL DEFAULT '{"elements":[],"appState":{},"files":{}}' CHECK (json_valid(scene_json)),
  content_text TEXT NOT NULL DEFAULT '',
  thumbnail TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  opened_at TEXT,
  deleted_at TEXT
);
CREATE INDEX idx_canvases_ws ON canvases(workspace_id, kind, deleted_at, updated_at);
CREATE TABLE canvas_versions (
  id INTEGER PRIMARY KEY,
  canvas_id INTEGER NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  title TEXT NOT NULL, scene_json TEXT NOT NULL, reason TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_canvas_versions ON canvas_versions(canvas_id, id);
CREATE TABLE canvas_links (
  canvas_id INTEGER NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('task','note')),
  target_id INTEGER NOT NULL,
  PRIMARY KEY (canvas_id, target_type, target_id)
);
CREATE INDEX idx_canvas_links_target ON canvas_links(target_type, target_id);
CREATE TRIGGER canvas_links_task_del AFTER DELETE ON tasks BEGIN
  DELETE FROM canvas_links WHERE target_type = 'task' AND target_id = old.id;
END;
CREATE TRIGGER canvas_links_note_del AFTER DELETE ON notes BEGIN
  DELETE FROM canvas_links WHERE target_type = 'note' AND target_id = old.id;
END;
`,
  },
  {
    version: 4,
    name: 'arquivos e anexos, lembretes, notas flutuantes, horário nas tarefas',
    up: `
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  original_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('internal','link')),
  stored_path TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  folder TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE INDEX idx_attachments_ws ON attachments(workspace_id, deleted_at, folder);
CREATE TABLE attachment_links (
  attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('task','note','project','canvas')),
  target_id INTEGER NOT NULL,
  PRIMARY KEY (attachment_id, target_type, target_id)
);
CREATE INDEX idx_attachment_links_target ON attachment_links(target_type, target_id);
CREATE TRIGGER att_links_task_del AFTER DELETE ON tasks BEGIN DELETE FROM attachment_links WHERE target_type = 'task' AND target_id = old.id; END;
CREATE TRIGGER att_links_note_del AFTER DELETE ON notes BEGIN DELETE FROM attachment_links WHERE target_type = 'note' AND target_id = old.id; END;
CREATE TRIGGER att_links_project_del AFTER DELETE ON projects BEGIN DELETE FROM attachment_links WHERE target_type = 'project' AND target_id = old.id; END;
CREATE TRIGGER att_links_canvas_del AFTER DELETE ON canvases BEGIN DELETE FROM attachment_links WHERE target_type = 'canvas' AND target_id = old.id; END;

ALTER TABLE tasks ADD COLUMN due_time TEXT CHECK (due_time IS NULL OR due_time GLOB '[0-2][0-9]:[0-5][0-9]');

CREATE TABLE reminders (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  fired_at TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_reminders_due ON reminders(workspace_id, dismissed_at, remind_at);
CREATE TABLE notification_log (key TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));

CREATE TABLE floating_notes (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  content TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#fff3a3',
  x INTEGER, y INTEGER, width INTEGER NOT NULL DEFAULT 260, height INTEGER NOT NULL DEFAULT 240,
  always_on_top INTEGER NOT NULL DEFAULT 1 CHECK (always_on_top IN (0,1)),
  minimized INTEGER NOT NULL DEFAULT 0 CHECK (minimized IN (0,1)),
  is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
`,
  },
  {
    version: 5,
    name: 'histórico de backups',
    up: `
CREATE TABLE backup_log (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('export','safety','restore')),
  path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`,
  },
];

export const LATEST_DB_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
