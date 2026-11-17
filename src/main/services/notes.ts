import crypto from 'node:crypto';
import type { DB } from '../db/connection';
import type { Note, NoteFolder, NotePatch, NoteQuery, NoteSummary, NoteVersion, Tag } from '../../shared/types';
import { logHistory } from './history';

const now = () => new Date().toISOString();
const EMPTY_DOC = '{"type":"doc","content":[]}';
/** Intervalo mínimo entre versões automáticas de uma nota. */
export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
export const MAX_VERSIONS_PER_NOTE = 100;
export const MEDIA_PREFIX = 'ws-media://';
const MEDIA_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

type JsonNode = { type?: string; text?: string; content?: JsonNode[] };
const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'taskItem', 'codeBlock', 'blockquote', 'tableRow', 'horizontalRule']);

/** Extrai o texto puro do documento (usado pelo índice de pesquisa e pelos resumos). */
export function extractText(json: string): string {
  let doc: JsonNode;
  try { doc = JSON.parse(json); } catch { return ''; }
  const out: string[] = [];
  const walk = (n: JsonNode) => {
    if (n.text) out.push(n.text);
    if (n.type === 'tableCell' || n.type === 'tableHeader') out.push(' ');
    n.content?.forEach(walk);
    if (n.type && BLOCKS.has(n.type)) out.push('\n');
  };
  walk(doc);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** Converte a pesquisa do usuário em consulta FTS5 segura (prefixo por palavra, AND implícito). */
export function ftsQuery(q: string): string | null {
  const words = q.normalize('NFC').split(/[^\p{L}\p{N}_]+/u).filter(Boolean).slice(0, 12);
  return words.length ? words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ') : null;
}

interface Row {
  id: number; workspace_id: number; folder_id: number | null; project_id: number | null; category_id: number | null; title: string;
  content_json: string; content_text: string; pinned: 0 | 1; favorite: 0 | 1; revision: number; created_at: string; updated_at: string; deleted_at: string | null;
}

export class NoteService {
  constructor(private db: DB, private ws: () => number) {}

  private row(id: number, includeDeleted = false): Row {
    const r = this.db.prepare(`SELECT * FROM notes WHERE id = ? AND workspace_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).get(id, this.ws()) as Row | undefined;
    if (!r) throw new Error('Anotação não encontrada.');
    return r;
  }

  private tagsFor(ids: number[]): Map<number, Tag[]> {
    const m = new Map<number, Tag[]>();
    if (!ids.length) return m;
    const rows = this.db.prepare(`SELECT nt.note_id, t.* FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.name`).all(...ids) as (Tag & { note_id: number })[];
    for (const { note_id, ...t } of rows) (m.get(note_id) ?? m.set(note_id, []).get(note_id)!).push(t);
    return m;
  }

  private summary(r: Row & { snip?: string }, tags: Map<number, Tag[]>): NoteSummary {
    return {
      id: r.id, title: r.title, folder_id: r.folder_id, project_id: r.project_id, category_id: r.category_id,
      pinned: r.pinned, favorite: r.favorite, created_at: r.created_at, updated_at: r.updated_at,
      excerpt: r.snip ?? r.content_text.slice(0, 160), tags: tags.get(r.id) ?? [],
    };
  }

  list(q: NoteQuery = {}): NoteSummary[] {
    const where = ['n.workspace_id = ?', 'n.deleted_at IS NULL']; const args: unknown[] = [this.ws()];
    let from = 'notes n'; let snip = 'NULL';
    const fq = q.search ? ftsQuery(q.search) : null;
    if (fq) {
      from = 'notes_fts f JOIN notes n ON n.id = f.rowid';
      where.push('notes_fts MATCH ?'); args.push(fq);
      snip = "snippet(notes_fts, 1, '«', '»', '…', 16)";
    }
    if (q.folder_id !== undefined) { where.push(q.folder_id === null ? 'n.folder_id IS NULL' : 'n.folder_id = ?'); if (q.folder_id !== null) args.push(q.folder_id); }
    if (q.project_id) { where.push('n.project_id = ?'); args.push(q.project_id); }
    if (q.category_id) { where.push('n.category_id = ?'); args.push(q.category_id); }
    if (q.favorites) where.push('n.favorite = 1');
    if (q.task_id) { where.push('EXISTS (SELECT 1 FROM note_tasks x WHERE x.note_id = n.id AND x.task_id = ?)'); args.push(q.task_id); }
    if (q.tag) { where.push('EXISTS (SELECT 1 FROM note_tags x JOIN tags t ON t.id = x.tag_id WHERE x.note_id = n.id AND t.name = ?)'); args.push(q.tag); }
    const order = fq ? 'n.pinned DESC, bm25(notes_fts, 5.0, 1.0)' : 'n.pinned DESC, n.updated_at DESC';
    const rows = this.db.prepare(`SELECT n.id, n.title, n.folder_id, n.project_id, n.category_id, n.pinned, n.favorite, n.created_at, n.updated_at,
      substr(n.content_text, 1, 200) AS content_text, ${snip} AS snip FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 1000`).all(...args) as (Row & { snip: string | null })[];
    const tags = this.tagsFor(rows.map((r) => r.id));
    return rows.map((r) => this.summary({ ...r, snip: r.snip ?? undefined }, tags));
  }

  get(id: number): Note {
    const r = this.row(id);
    const tasks = this.db.prepare('SELECT t.id, t.title, t.status FROM note_tasks x JOIN tasks t ON t.id = x.task_id WHERE x.note_id = ? AND t.deleted_at IS NULL ORDER BY t.title').all(id) as Note['tasks'];
    return { ...this.summary(r, this.tagsFor([id])), content_json: r.content_json, revision: r.revision, tasks };
  }

  create(input: { title?: string; folder_id?: number | null; project_id?: number | null; task_id?: number; content_json?: string } = {}): Note {
    return this.db.transaction(() => {
      const json = input.content_json ?? EMPTY_DOC;
      const id = Number(this.db.prepare('INSERT INTO notes (workspace_id, folder_id, project_id, title, content_json, content_text) VALUES (?,?,?,?,?,?)')
        .run(this.ws(), input.folder_id ?? null, input.project_id ?? null, (input.title ?? '').trim(), json, extractText(json)).lastInsertRowid);
      if (input.task_id) this.linkTask(id, input.task_id);
      logHistory(this.db, this.ws(), 'note', id, 'criada', input.title ?? '');
      return this.get(id);
    })();
  }

  private addVersion(r: Pick<Row, 'id' | 'title' | 'content_json'>, reason: string): void {
    this.db.prepare('INSERT INTO note_versions (note_id, title, content_json, reason) VALUES (?,?,?,?)').run(r.id, r.title, r.content_json, reason);
    this.db.prepare(`DELETE FROM note_versions WHERE note_id = ? AND id NOT IN (SELECT id FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT ${MAX_VERSIONS_PER_NOTE})`).run(r.id, r.id);
  }

  update(id: number, p: NotePatch, nowMs = Date.now()): { revision: number; updated_at: string } {
    return this.db.transaction(() => {
      const r = this.row(id);
      const contentChanged = (p.content_json !== undefined && p.content_json !== r.content_json) || (p.title !== undefined && p.title.trim() !== r.title);
      if (p.content_json !== undefined) JSON.parse(p.content_json); // valida antes de gravar
      if (contentChanged && r.content_text !== '') { // nota ainda vazia não gera versão
        const last = this.db.prepare('SELECT created_at FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT 1').get(id) as { created_at: string } | undefined;
        if (!last || nowMs - Date.parse(last.created_at) >= AUTO_VERSION_INTERVAL_MS) this.addVersion(r, 'auto');
      }
      const next = {
        title: p.title !== undefined ? p.title.trim() : r.title,
        content_json: p.content_json ?? r.content_json,
        folder_id: p.folder_id !== undefined ? p.folder_id : r.folder_id,
        project_id: p.project_id !== undefined ? p.project_id : r.project_id,
        category_id: p.category_id !== undefined ? p.category_id : r.category_id,
        pinned: p.pinned !== undefined ? (p.pinned ? 1 : 0) : r.pinned,
        favorite: p.favorite !== undefined ? (p.favorite ? 1 : 0) : r.favorite,
      };
      const updated_at = now();
      this.db.prepare(`UPDATE notes SET title = ?, content_json = ?, content_text = ?, folder_id = ?, project_id = ?, category_id = ?, pinned = ?, favorite = ?,
        revision = revision + 1, updated_at = ? WHERE id = ?`).run(next.title, next.content_json,
        p.content_json !== undefined ? extractText(next.content_json) : r.content_text, next.folder_id, next.project_id, next.category_id,
        next.pinned, next.favorite, updated_at, id);
      if (p.tags) this.setTags(id, p.tags);
      if (p.folder_id !== undefined && p.folder_id !== r.folder_id) logHistory(this.db, this.ws(), 'note', id, 'movida de pasta');
      return { revision: r.revision + 1, updated_at };
    })();
  }

  private setTags(noteId: number, names: string[]): void {
    const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    this.db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
    for (const n of clean) {
      this.db.prepare('INSERT INTO tags (workspace_id, name) VALUES (?, ?) ON CONFLICT(workspace_id, name) DO NOTHING').run(this.ws(), n);
      const t = this.db.prepare('SELECT id FROM tags WHERE workspace_id = ? AND name = ?').get(this.ws(), n) as { id: number };
      this.db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, t.id);
    }
  }

  duplicate(id: number): Note {
    return this.db.transaction(() => {
      const src = this.get(id);
      const copy = this.create({ title: `${src.title || 'Sem título'} (cópia)`, folder_id: src.folder_id, project_id: src.project_id, content_json: src.content_json });
      this.setTags(copy.id, src.tags.map((t) => t.name));
      for (const t of src.tasks) this.linkTask(copy.id, t.id);
      return this.get(copy.id);
    })();
  }

  remove(id: number): void {
    const r = this.row(id);
    this.db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(now(), id);
    logHistory(this.db, this.ws(), 'note', id, 'enviada para a lixeira', r.title);
  }
  restore(id: number): void {
    const r = this.row(id, true);
    // se a pasta original não existe mais, a nota volta para a raiz (FK ON DELETE SET NULL já cuida disso)
    this.db.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ?').run(id);
    logHistory(this.db, this.ws(), 'note', id, 'restaurada', r.title);
  }
  purge(id: number): void {
    const r = this.row(id, true);
    if (!r.deleted_at) throw new Error('Só é possível excluir permanentemente itens que estão na lixeira.');
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    logHistory(this.db, this.ws(), 'note', id, 'excluída permanentemente', r.title);
  }

  linkTask(noteId: number, taskId: number): void {
    this.row(noteId);
    const t = this.db.prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?').get(taskId, this.ws());
    if (!t) throw new Error('Tarefa não encontrada.');
    this.db.prepare('INSERT OR IGNORE INTO note_tasks (note_id, task_id) VALUES (?, ?)').run(noteId, taskId);
  }
  unlinkTask(noteId: number, taskId: number): void {
    this.db.prepare('DELETE FROM note_tasks WHERE note_id = ? AND task_id = ? AND note_id IN (SELECT id FROM notes WHERE workspace_id = ?)').run(noteId, taskId, this.ws());
  }

  versions(noteId: number): NoteVersion[] {
    this.row(noteId);
    return this.db.prepare('SELECT id, note_id, title, reason, created_at, length(content_json) AS size FROM note_versions WHERE note_id = ? ORDER BY id DESC').all(noteId) as NoteVersion[];
  }
  versionContent(versionId: number): { title: string; content_json: string } {
    const v = this.db.prepare('SELECT v.title, v.content_json FROM note_versions v JOIN notes n ON n.id = v.note_id WHERE v.id = ? AND n.workspace_id = ?').get(versionId, this.ws()) as { title: string; content_json: string } | undefined;
    if (!v) throw new Error('Versão não encontrada.');
    return v;
  }
  snapshot(noteId: number): void { this.addVersion(this.row(noteId), 'manual'); }
  restoreVersion(versionId: number): void {
    this.db.transaction(() => {
      const v = this.db.prepare('SELECT v.* FROM note_versions v JOIN notes n ON n.id = v.note_id WHERE v.id = ? AND n.workspace_id = ?').get(versionId, this.ws()) as { note_id: number; title: string; content_json: string; created_at: string } | undefined;
      if (!v) throw new Error('Versão não encontrada.');
      const cur = this.row(v.note_id);
      this.addVersion(cur, 'antes de restaurar');
      this.db.prepare('UPDATE notes SET title = ?, content_json = ?, content_text = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(v.title, v.content_json, extractText(v.content_json), now(), v.note_id);
      logHistory(this.db, this.ws(), 'note', v.note_id, 'versão restaurada', v.created_at);
    })();
  }

  // ---------- pastas ----------
  folders(): NoteFolder[] {
    return this.db.prepare('SELECT * FROM note_folders WHERE workspace_id = ? ORDER BY position, name COLLATE NOCASE').all(this.ws()) as NoteFolder[];
  }
  private folder(id: number): NoteFolder {
    const f = this.db.prepare('SELECT * FROM note_folders WHERE id = ? AND workspace_id = ?').get(id, this.ws()) as NoteFolder | undefined;
    if (!f) throw new Error('Pasta não encontrada.');
    return f;
  }
  createFolder(name: string, parentId: number | null): NoteFolder {
    if (parentId) this.folder(parentId);
    const id = Number(this.db.prepare('INSERT INTO note_folders (workspace_id, parent_id, name) VALUES (?,?,?)').run(this.ws(), parentId, name.trim()).lastInsertRowid);
    return this.folder(id);
  }
  renameFolder(id: number, name: string): void { this.folder(id); this.db.prepare('UPDATE note_folders SET name = ? WHERE id = ?').run(name.trim(), id); }
  moveFolder(id: number, parentId: number | null): void {
    this.folder(id);
    for (let p = parentId; p !== null; p = this.folder(p).parent_id) if (p === id) throw new Error('Não é possível mover uma pasta para dentro dela mesma.');
    this.db.prepare('UPDATE note_folders SET parent_id = ? WHERE id = ?').run(parentId, id);
  }
  /** Remove a pasta sem apagar conteúdo: notas e subpastas sobem para a pasta-mãe. */
  removeFolder(id: number): void {
    this.db.transaction(() => {
      const f = this.folder(id);
      this.db.prepare('UPDATE notes SET folder_id = ? WHERE folder_id = ?').run(f.parent_id, id);
      this.db.prepare('UPDATE note_folders SET parent_id = ? WHERE parent_id = ?').run(f.parent_id, id);
      this.db.prepare('DELETE FROM note_folders WHERE id = ?').run(id);
      logHistory(this.db, this.ws(), 'folder', id, 'pasta removida', f.name);
    })();
  }

  recent(limit = 6): NoteSummary[] { return this.list({}).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit); }
}

/** Armazenamento de imagens deduplicado por SHA-256 dentro do próprio banco (entra no backup automaticamente). */
export class MediaService {
  constructor(private db: DB) {}
  save(bytes: Uint8Array, mime: string): string {
    if (!MEDIA_MIME.includes(mime)) throw new Error('Formato de imagem não suportado (use PNG, JPG, WEBP ou GIF).');
    if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('Imagem muito grande (máximo 25 MB).');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    this.db.prepare('INSERT OR IGNORE INTO media (hash, mime, size, data) VALUES (?,?,?,?)').run(hash, mime, bytes.byteLength, Buffer.from(bytes));
    return MEDIA_PREFIX + hash;
  }
  get(hash: string): { mime: string; data: Buffer } | null {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    return (this.db.prepare('SELECT mime, data FROM media WHERE hash = ?').get(hash) as { mime: string; data: Buffer } | undefined) ?? null;
  }
}
