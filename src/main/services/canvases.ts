import type { DB } from '../db/connection';
import type { Canvas, CanvasKind, CanvasSummary, CanvasVersion, TaskBrief, NoteBrief } from '../../shared/types';
import { logHistory } from './history';

const now = () => new Date().toISOString();
export const CANVAS_AUTO_VERSION_MS = 10 * 60 * 1000;
export const MAX_CANVAS_VERSIONS = 50;
const EMPTY_SCENE = '{"elements":[],"appState":{},"files":{}}';
const KIND_LABEL: Record<CanvasKind, string> = { drawing: 'desenho', board: 'quadro' };

interface Scene { elements: { type?: string; text?: string; isDeleted?: boolean }[]; appState?: object; files?: Record<string, unknown> }

/** Valida a estrutura mínima de uma cena (objetos editáveis, não imagem final). */
export function parseScene(json: string): Scene {
  const s = JSON.parse(json) as Scene;
  if (!s || !Array.isArray(s.elements) || typeof (s.appState ?? {}) !== 'object' || typeof (s.files ?? {}) !== 'object') throw new Error('Cena inválida.');
  return s;
}
export function sceneText(json: string): string {
  try { return parseScene(json).elements.filter((e) => !e.isDeleted && e.type === 'text' && e.text).map((e) => e.text).join('\n').slice(0, 100_000); } catch { return ''; }
}

interface Row extends Omit<Canvas, 'links'> { workspace_id: number; content_text: string; deleted_at: string | null }
const SUMMARY = 'id, kind, title, project_id, thumbnail, created_at, updated_at, opened_at';

export class CanvasService {
  constructor(private db: DB, private ws: () => number) {}

  private row(id: number, includeDeleted = false): Row {
    const r = this.db.prepare(`SELECT * FROM canvases WHERE id = ? AND workspace_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).get(id, this.ws()) as Row | undefined;
    if (!r) throw new Error('Desenho ou quadro não encontrado.');
    return r;
  }

  list(kind: CanvasKind, q: { search?: string; project_id?: number; task_id?: number; note_id?: number } = {}): CanvasSummary[] {
    const where = ['workspace_id = ?', 'kind = ?', 'deleted_at IS NULL']; const args: unknown[] = [this.ws(), kind];
    if (q.search?.trim()) { const s = `%${q.search.trim().replace(/[%_\\]/g, (c) => '\\' + c)}%`; where.push("(title LIKE ? ESCAPE '\\' OR content_text LIKE ? ESCAPE '\\')"); args.push(s, s); }
    if (q.project_id) { where.push('project_id = ?'); args.push(q.project_id); }
    if (q.task_id) { where.push("id IN (SELECT canvas_id FROM canvas_links WHERE target_type = 'task' AND target_id = ?)"); args.push(q.task_id); }
    if (q.note_id) { where.push("id IN (SELECT canvas_id FROM canvas_links WHERE target_type = 'note' AND target_id = ?)"); args.push(q.note_id); }
    return this.db.prepare(`SELECT ${SUMMARY} FROM canvases WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 2000`).all(...args) as CanvasSummary[];
  }

  recent(kind: CanvasKind, limit = 6): CanvasSummary[] {
    return this.db.prepare(`SELECT ${SUMMARY} FROM canvases WHERE workspace_id = ? AND kind = ? AND deleted_at IS NULL ORDER BY COALESCE(opened_at, updated_at) DESC LIMIT ?`).all(this.ws(), kind, limit) as CanvasSummary[];
  }

  get(id: number): Canvas {
    const r = this.row(id);
    const links = this.db.prepare(`
      SELECT 'task' AS type, t.id, t.title FROM canvas_links l JOIN tasks t ON t.id = l.target_id WHERE l.canvas_id = ? AND l.target_type = 'task' AND t.deleted_at IS NULL
      UNION ALL
      SELECT 'note', n.id, CASE WHEN n.title = '' THEN 'Sem título' ELSE n.title END FROM canvas_links l JOIN notes n ON n.id = l.target_id WHERE l.canvas_id = ? AND l.target_type = 'note' AND n.deleted_at IS NULL`).all(id, id) as Canvas['links'];
    const { workspace_id: _w, content_text: _c, deleted_at: _d, ...rest } = r;
    return { ...rest, links };
  }

  create(input: { kind: CanvasKind; title?: string; project_id?: number | null; task_id?: number; note_id?: number; scene_json?: string }): Canvas {
    return this.db.transaction(() => {
      const scene = input.scene_json ?? EMPTY_SCENE; parseScene(scene);
      const id = Number(this.db.prepare('INSERT INTO canvases (workspace_id, kind, title, project_id, scene_json, content_text) VALUES (?,?,?,?,?,?)')
        .run(this.ws(), input.kind, (input.title ?? '').trim(), input.project_id ?? null, scene, sceneText(scene)).lastInsertRowid);
      if (input.task_id) this.link(id, 'task', input.task_id);
      if (input.note_id) this.link(id, 'note', input.note_id);
      logHistory(this.db, this.ws(), input.kind, id, `${KIND_LABEL[input.kind]} criado`, input.title ?? '');
      return this.get(id);
    })();
  }

  private addVersion(r: Pick<Row, 'id' | 'title' | 'scene_json'>, reason: string): void {
    this.db.prepare('INSERT INTO canvas_versions (canvas_id, title, scene_json, reason) VALUES (?,?,?,?)').run(r.id, r.title, r.scene_json, reason);
    this.db.prepare(`DELETE FROM canvas_versions WHERE canvas_id = ? AND id NOT IN (SELECT id FROM canvas_versions WHERE canvas_id = ? ORDER BY id DESC LIMIT ${MAX_CANVAS_VERSIONS})`).run(r.id, r.id);
  }

  update(id: number, p: { title?: string; scene_json?: string; project_id?: number | null; thumbnail?: string | null }, nowMs = Date.now()): { revision: number; updated_at: string } {
    return this.db.transaction(() => {
      const r = this.row(id);
      if (p.scene_json !== undefined) {
        parseScene(p.scene_json);
        const hadContent = parseScene(r.scene_json).elements.some((e) => !e.isDeleted);
        if (p.scene_json !== r.scene_json && hadContent) {
          const last = this.db.prepare('SELECT created_at FROM canvas_versions WHERE canvas_id = ? ORDER BY id DESC LIMIT 1').get(id) as { created_at: string } | undefined;
          if (!last || nowMs - Date.parse(last.created_at) >= CANVAS_AUTO_VERSION_MS) this.addVersion(r, 'auto');
        }
      }
      const updated_at = now();
      const scene = p.scene_json ?? r.scene_json;
      this.db.prepare('UPDATE canvases SET title = ?, scene_json = ?, content_text = ?, project_id = ?, thumbnail = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(p.title !== undefined ? p.title.trim() : r.title, scene, p.scene_json !== undefined ? sceneText(scene) : r.content_text,
          p.project_id !== undefined ? p.project_id : r.project_id, p.thumbnail !== undefined ? p.thumbnail : r.thumbnail, updated_at, id);
      return { revision: r.revision + 1, updated_at };
    })();
  }

  touch(id: number): void { this.db.prepare('UPDATE canvases SET opened_at = ? WHERE id = ? AND workspace_id = ?').run(now(), id, this.ws()); }

  duplicate(id: number): Canvas {
    return this.db.transaction(() => {
      const r = this.row(id);
      const c = this.create({ kind: r.kind, title: `${r.title || 'Sem título'} (cópia)`, project_id: r.project_id, scene_json: r.scene_json });
      this.db.prepare('INSERT INTO canvas_links (canvas_id, target_type, target_id) SELECT ?, target_type, target_id FROM canvas_links WHERE canvas_id = ?').run(c.id, id);
      this.db.prepare('UPDATE canvases SET thumbnail = ? WHERE id = ?').run(r.thumbnail, c.id);
      return this.get(c.id);
    })();
  }

  remove(id: number): void {
    const r = this.row(id);
    this.db.prepare('UPDATE canvases SET deleted_at = ? WHERE id = ?').run(now(), id);
    logHistory(this.db, this.ws(), r.kind, id, 'enviado para a lixeira', r.title);
  }
  restore(id: number): void {
    const r = this.row(id, true);
    this.db.prepare('UPDATE canvases SET deleted_at = NULL WHERE id = ?').run(id);
    logHistory(this.db, this.ws(), r.kind, id, 'restaurado', r.title);
  }
  purge(id: number): void {
    const r = this.row(id, true);
    if (!r.deleted_at) throw new Error('Só é possível excluir permanentemente itens que estão na lixeira.');
    this.db.prepare('DELETE FROM canvases WHERE id = ?').run(id);
    logHistory(this.db, this.ws(), r.kind, id, 'excluído permanentemente', r.title);
  }

  link(id: number, type: 'task' | 'note', targetId: number): void {
    this.row(id);
    const table = type === 'task' ? 'tasks' : 'notes';
    if (!this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND workspace_id = ?`).get(targetId, this.ws())) throw new Error('Item não encontrado.');
    this.db.prepare('INSERT OR IGNORE INTO canvas_links (canvas_id, target_type, target_id) VALUES (?,?,?)').run(id, type, targetId);
  }
  unlink(id: number, type: 'task' | 'note', targetId: number): void {
    this.row(id);
    this.db.prepare('DELETE FROM canvas_links WHERE canvas_id = ? AND target_type = ? AND target_id = ?').run(id, type, targetId);
  }

  versions(id: number): CanvasVersion[] {
    this.row(id);
    return this.db.prepare('SELECT id, canvas_id, reason, created_at, length(scene_json) AS size FROM canvas_versions WHERE canvas_id = ? ORDER BY id DESC').all(id) as CanvasVersion[];
  }
  snapshot(id: number): void { this.addVersion(this.row(id), 'manual'); }
  restoreVersion(versionId: number): void {
    this.db.transaction(() => {
      const v = this.db.prepare('SELECT v.* FROM canvas_versions v JOIN canvases c ON c.id = v.canvas_id WHERE v.id = ? AND c.workspace_id = ?').get(versionId, this.ws()) as { canvas_id: number; scene_json: string; created_at: string } | undefined;
      if (!v) throw new Error('Versão não encontrada.');
      const cur = this.row(v.canvas_id);
      this.addVersion(cur, 'antes de restaurar');
      this.db.prepare('UPDATE canvases SET scene_json = ?, content_text = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(v.scene_json, sceneText(v.scene_json), now(), v.canvas_id);
      logHistory(this.db, this.ws(), cur.kind, cur.id, 'versão restaurada', v.created_at);
    })();
  }

  /** Dados atuais das tarefas e notas exibidas nos quadros (sincronização sem duplicar registros). */
  taskBriefs(ids: number[]): TaskBrief[] {
    const clean = [...new Set(ids)].filter(Number.isInteger).slice(0, 2000);
    if (!clean.length) return [];
    return (this.db.prepare(`SELECT id, title, status, priority, due_date, deleted_at FROM tasks WHERE workspace_id = ? AND id IN (${clean.map(() => '?').join(',')})`).all(this.ws(), ...clean) as (TaskBrief & { deleted_at: string | null })[])
      .map(({ deleted_at, ...t }) => ({ ...t, deleted: !!deleted_at }));
  }
  noteBriefs(ids: number[]): NoteBrief[] {
    const clean = [...new Set(ids)].filter(Number.isInteger).slice(0, 2000);
    if (!clean.length) return [];
    return (this.db.prepare(`SELECT id, title, substr(content_text, 1, 160) AS excerpt, deleted_at FROM notes WHERE workspace_id = ? AND id IN (${clean.map(() => '?').join(',')})`).all(this.ws(), ...clean) as (NoteBrief & { deleted_at: string | null })[])
      .map(({ deleted_at, ...n }) => ({ ...n, deleted: !!deleted_at }));
  }
}
