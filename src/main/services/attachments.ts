import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { DB } from '../db/connection';
import type { Attachment, AttachmentDetail, AttachmentTarget, ImportResult } from '../../shared/types';
import { logHistory } from './history';

const now = () => new Date().toISOString();
const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
};
export const mimeFor = (name: string) => MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';

/** Extensões que executariam código se "abertas": o app nunca as abre, apenas mostra na pasta. */
export const EXECUTABLE_EXT = new Set(['.exe', '.bat', '.cmd', '.com', '.msi', '.msp', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.scr', '.pif', '.lnk', '.hta', '.jar', '.reg', '.cpl', '.msc', '.appx', '.appref-ms', '.url', '.dll', '.sys', '.inf', '.application', '.gadget', '.sh']);
export const isExecutable = (p: string) => EXECUTABLE_EXT.has(path.extname(p).toLowerCase());

const TITLE_SQL: Record<AttachmentTarget, string> = {
  task: 'SELECT title FROM tasks WHERE id = ?', note: "SELECT CASE WHEN title = '' THEN 'Sem título' ELSE title END AS title FROM notes WHERE id = ?",
  project: 'SELECT name AS title FROM projects WHERE id = ?', canvas: "SELECT CASE WHEN title = '' THEN 'Sem título' ELSE title END AS title FROM canvases WHERE id = ?",
};
const TARGET_TABLE: Record<AttachmentTarget, string> = { task: 'tasks', note: 'notes', project: 'projects', canvas: 'canvases' };

type Row = Omit<Attachment, 'missing' | 'link_count'> & { workspace_id: number; sha256: string | null; deleted_at: string | null; link_count?: number };

export class AttachmentService {
  /** @param filesDir pasta da biblioteca interna (dentro dos dados do usuário, nunca na instalação) */
  constructor(private db: DB, private ws: () => number, private filesDir: string) {}

  absolutePath(r: Pick<Row, 'mode' | 'stored_path'>): string {
    if (r.mode === 'link') return r.stored_path;
    const abs = path.resolve(this.filesDir, r.stored_path);
    if (!abs.startsWith(path.resolve(this.filesDir) + path.sep)) throw new Error('Caminho interno inválido.');
    return abs;
  }
  private exists(r: Row): boolean { try { return fs.statSync(this.absolutePath(r)).isFile(); } catch { return false; } }

  private row(id: number, includeDeleted = false): Row {
    const r = this.db.prepare(`SELECT * FROM attachments WHERE id = ? AND workspace_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).get(id, this.ws()) as Row | undefined;
    if (!r) throw new Error('Arquivo não encontrado.');
    return r;
  }
  private toAttachment(r: Row): Attachment {
    const { workspace_id: _w, sha256: _s, deleted_at: _d, ...rest } = r;
    return { ...rest, link_count: r.link_count ?? 0, missing: !this.exists(r) };
  }

  list(q: { search?: string; folder?: string; target?: { type: AttachmentTarget; id: number }; missingOnly?: boolean } = {}): Attachment[] {
    const where = ['a.workspace_id = ?', 'a.deleted_at IS NULL']; const args: unknown[] = [this.ws()];
    if (q.search?.trim()) { const s = `%${q.search.trim().replace(/[%_\\]/g, (c) => '\\' + c)}%`; where.push("(a.name LIKE ? ESCAPE '\\' OR a.original_name LIKE ? ESCAPE '\\' OR a.folder LIKE ? ESCAPE '\\')"); args.push(s, s, s); }
    if (q.folder !== undefined) { where.push('(a.folder = ? OR a.folder LIKE ?)'); args.push(q.folder, q.folder ? q.folder + '/%' : '%'); }
    if (q.target) { where.push('EXISTS (SELECT 1 FROM attachment_links l WHERE l.attachment_id = a.id AND l.target_type = ? AND l.target_id = ?)'); args.push(q.target.type, q.target.id); }
    const rows = this.db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM attachment_links l WHERE l.attachment_id = a.id) AS link_count FROM attachments a
      WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 5000`).all(...args) as Row[];
    const out = rows.map((r) => this.toAttachment(r));
    return q.missingOnly ? out.filter((a) => a.missing) : out;
  }

  get(id: number): AttachmentDetail {
    const r = this.row(id);
    const links = (this.db.prepare('SELECT target_type AS type, target_id AS id FROM attachment_links WHERE attachment_id = ?').all(id) as { type: AttachmentTarget; id: number }[])
      .map((l) => ({ ...l, title: (this.db.prepare(TITLE_SQL[l.type]).get(l.id) as { title: string } | undefined)?.title ?? '(excluído)' }));
    return { ...this.toAttachment({ ...r, link_count: links.length }), links, absolute_path: this.absolutePath(r) };
  }

  /** Copia para a biblioteca interna com hash; gravação atômica (temporário + rename) e deduplicação. */
  private async copyIn(src: string): Promise<{ rel: string; sha: string; size: number }> {
    fs.mkdirSync(this.filesDir, { recursive: true });
    const tmp = path.join(this.filesDir, `.importando-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const hash = crypto.createHash('sha256'); let size = 0;
    try {
      await pipeline(fs.createReadStream(src), async function* (chunks: AsyncIterable<Buffer>) {
        for await (const c of chunks) { hash.update(c); size += c.length; yield c; }
      }, fs.createWriteStream(tmp, { flags: 'wx' }));
      const sha = hash.digest('hex');
      const rel = path.join(sha.slice(0, 2), sha + path.extname(src).toLowerCase());
      const abs = path.join(this.filesDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (fs.existsSync(abs)) fs.rmSync(tmp); else fs.renameSync(tmp, abs);
      return { rel, sha, size };
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw new Error((e as NodeJS.ErrnoException).code === 'ENOSPC' ? 'Espaço em disco insuficiente.' : (e as Error).message);
    }
  }

  private insert(name: string, mode: 'internal' | 'link', stored: string, size: number, sha: string | null, folder = '', target?: { type: AttachmentTarget; id: number }): Attachment {
    return this.db.transaction(() => {
      const id = Number(this.db.prepare('INSERT INTO attachments (workspace_id, name, original_name, mode, stored_path, mime, size, sha256, folder) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(this.ws(), name, name, mode, stored, mimeFor(name), size, sha, folder.trim()).lastInsertRowid);
      if (target) this.link(id, target.type, target.id);
      logHistory(this.db, this.ws(), 'attachment', id, mode === 'internal' ? 'arquivo copiado para a biblioteca' : 'arquivo vinculado', name);
      return this.toAttachment({ ...this.row(id), link_count: target ? 1 : 0 });
    })();
  }

  async importPaths(paths: string[], mode: 'internal' | 'link', target?: { type: AttachmentTarget; id: number }): Promise<ImportResult> {
    const res: ImportResult = { imported: [], errors: [] };
    for (const p of paths) {
      const name = path.basename(p);
      try {
        if (!path.isAbsolute(p)) throw new Error('Caminho inválido.');
        const st = fs.statSync(p);
        if (!st.isFile()) throw new Error('Não é um arquivo (pastas não são suportadas).');
        if (mode === 'link') res.imported.push(this.insert(name, 'link', path.normalize(p), st.size, null, '', target));
        else { const c = await this.copyIn(p); res.imported.push(this.insert(name, 'internal', c.rel, c.size, c.sha, '', target)); }
      } catch (e) { res.errors.push({ name, message: (e as Error).message }); }
    }
    return res;
  }

  /** Arquivos vindos de bytes (arrastados sem caminho, capturas de tela): sempre na biblioteca interna. */
  async importBytes(name: string, bytes: Uint8Array, target?: { type: AttachmentTarget; id: number }, folder = ''): Promise<Attachment> {
    const safe = path.basename(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'arquivo';
    fs.mkdirSync(this.filesDir, { recursive: true });
    const tmp = path.join(this.filesDir, `.importando-${process.pid}-${Date.now()}${path.extname(safe)}`);
    try { await fs.promises.writeFile(tmp, bytes, { flag: 'wx' }); const c = await this.copyIn(tmp); return this.insert(safe, 'internal', c.rel, c.size, c.sha, folder, target); }
    finally { fs.rmSync(tmp, { force: true }); }
  }

  rename(id: number, name: string): void { this.row(id); this.db.prepare('UPDATE attachments SET name = ? WHERE id = ?').run(name.trim(), id); }
  setFolder(id: number, folder: string): void {
    const clean = folder.split('/').map((p) => p.trim()).filter(Boolean).join('/');
    this.row(id); this.db.prepare('UPDATE attachments SET folder = ? WHERE id = ?').run(clean, id);
  }

  link(id: number, type: AttachmentTarget, targetId: number): void {
    this.row(id);
    if (!this.db.prepare(`SELECT 1 FROM ${TARGET_TABLE[type]} WHERE id = ? AND workspace_id = ?`).get(targetId, this.ws())) throw new Error('Item de destino não encontrado.');
    this.db.prepare('INSERT OR IGNORE INTO attachment_links (attachment_id, target_type, target_id) VALUES (?,?,?)').run(id, type, targetId);
  }
  unlink(id: number, type: AttachmentTarget, targetId: number): void {
    this.row(id); this.db.prepare('DELETE FROM attachment_links WHERE attachment_id = ? AND target_type = ? AND target_id = ?').run(id, type, targetId);
  }

  remove(id: number): void {
    const r = this.row(id);
    this.db.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ?').run(now(), id);
    logHistory(this.db, this.ws(), 'attachment', id, 'enviado para a lixeira', r.name);
  }
  restore(id: number): void { const r = this.row(id, true); this.db.prepare('UPDATE attachments SET deleted_at = NULL WHERE id = ?').run(id); logHistory(this.db, this.ws(), 'attachment', id, 'restaurado', r.name); }

  /**
   * Exclusão definitiva. Cópias internas são apagadas da biblioteca (se nenhum outro registro usar o mesmo arquivo).
   * Arquivos apenas vinculados NUNCA são apagados do disco: somente o vínculo é removido.
   */
  purge(id: number): void {
    const r = this.row(id, true);
    if (!r.deleted_at) throw new Error('Só é possível excluir permanentemente itens que estão na lixeira.');
    this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    if (r.mode === 'internal') {
      const still = this.db.prepare("SELECT 1 FROM attachments WHERE mode = 'internal' AND stored_path = ?").get(r.stored_path);
      if (!still) fs.rmSync(this.absolutePath(r), { force: true });
    }
    logHistory(this.db, this.ws(), 'attachment', id, 'excluído permanentemente', r.name);
  }
  purgeAllDeleted(): void {
    for (const { id } of this.db.prepare('SELECT id FROM attachments WHERE workspace_id = ? AND deleted_at IS NOT NULL').all(this.ws()) as { id: number }[]) this.purge(id);
  }

  async read(id: number, maxBytes = 100 * 1024 * 1024): Promise<{ mime: string; bytes: Uint8Array }> {
    const r = this.row(id); const abs = this.absolutePath(r);
    const st = await fs.promises.stat(abs).catch(() => null);
    if (!st) throw new Error('Arquivo ausente no disco.');
    if (st.size > maxBytes) throw new Error('Arquivo grande demais para visualizar aqui; use “Abrir”.');
    return { mime: r.mime, bytes: new Uint8Array(await fs.promises.readFile(abs)) };
  }

  /** Atualiza o caminho de um vínculo externo (ex.: arquivo foi movido). */
  relink(id: number, newPath: string): void {
    const r = this.row(id);
    if (r.mode !== 'link') throw new Error('Somente arquivos vinculados podem ser reapontados.');
    const st = fs.statSync(newPath); if (!st.isFile()) throw new Error('Não é um arquivo.');
    this.db.prepare('UPDATE attachments SET stored_path = ?, size = ? WHERE id = ?').run(path.normalize(newPath), st.size, id);
  }

  /** Incorpora um arquivo vinculado à biblioteca interna (passa a entrar no backup). O original não é alterado. */
  async embed(id: number): Promise<void> {
    const r = this.row(id);
    if (r.mode !== 'link') return;
    const c = await this.copyIn(r.stored_path);
    this.db.prepare("UPDATE attachments SET mode = 'internal', stored_path = ?, sha256 = ?, size = ? WHERE id = ?").run(c.rel, c.sha, c.size, id);
    logHistory(this.db, this.ws(), 'attachment', id, 'incorporado à biblioteca interna', r.name);
  }
}
