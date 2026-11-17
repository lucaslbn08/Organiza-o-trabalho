import type { DB } from '../db/connection';
import type { SearchHit, SearchType } from '../../shared/types';
import { STATUS_LABEL } from '../../shared/types';
import { ftsQuery } from './notes';

const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;

/** Pesquisa universal (Ctrl+K): tarefas, notas (texto completo), projetos e etiquetas. */
export function searchAll(db: DB, ws: number, q: string, types: SearchType[] = ['task', 'note', 'project', 'tag'], limit = 15): SearchHit[] {
  const query = q.trim();
  if (!query) return [];
  const s = like(query);
  const hits: SearchHit[] = [];
  if (types.includes('task')) {
    const rows = db.prepare(`SELECT t.id, t.title, t.status, substr(t.description, 1, 120) AS d FROM tasks t WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND
      (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM task_tags x JOIN tags g ON g.id = x.tag_id WHERE x.task_id = t.id AND g.name LIKE ? ESCAPE '\\'))
      ORDER BY (t.title LIKE ? ESCAPE '\\') DESC, t.updated_at DESC LIMIT ?`).all(ws, s, s, s, s, limit) as { id: number; title: string; status: keyof typeof STATUS_LABEL; d: string }[];
    hits.push(...rows.map((r) => ({ type: 'task' as const, id: r.id, title: r.title, snippet: r.d, extra: STATUS_LABEL[r.status] })));
  }
  const fq = ftsQuery(query);
  if (types.includes('note') && fq) {
    const rows = db.prepare(`SELECT n.id, n.title, snippet(notes_fts, 1, '«', '»', '…', 12) AS snip FROM notes_fts f JOIN notes n ON n.id = f.rowid
      WHERE notes_fts MATCH ? AND n.workspace_id = ? AND n.deleted_at IS NULL ORDER BY bm25(notes_fts, 5.0, 1.0) LIMIT ?`).all(fq, ws, limit) as { id: number; title: string; snip: string }[];
    hits.push(...rows.map((r) => ({ type: 'note' as const, id: r.id, title: r.title || 'Sem título', snippet: r.snip })));
  }
  if (types.includes('project')) {
    const rows = db.prepare(`SELECT id, name, color FROM projects WHERE workspace_id = ? AND deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') LIMIT ?`).all(ws, s, s, limit) as { id: number; name: string; color: string }[];
    hits.push(...rows.map((r) => ({ type: 'project' as const, id: r.id, title: r.name, snippet: '', extra: r.color })));
  }
  if (types.includes('tag')) {
    const rows = db.prepare(`SELECT g.id, g.name, (SELECT COUNT(*) FROM task_tags x WHERE x.tag_id = g.id) + (SELECT COUNT(*) FROM note_tags y WHERE y.tag_id = g.id) AS n
      FROM tags g WHERE g.workspace_id = ? AND g.name LIKE ? ESCAPE '\\' LIMIT ?`).all(ws, s, limit) as { id: number; name: string; n: number }[];
    hits.push(...rows.map((r) => ({ type: 'tag' as const, id: r.id, title: '#' + r.name, snippet: `${r.n} item(ns)` })));
  }
  return hits;
}
