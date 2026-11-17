/**
 * Backup completo em ZIP, verificação e restauração segura.
 * Módulo sem dependência do Electron (testável com Node).
 *
 * Estrutura do ZIP:
 *   manifest.json                 versões, data, contagens, lista de arquivos com SHA-256
 *   db/workspace.sqlite           cópia consistente do banco (API de backup online do SQLite)
 *   files/<aa>/<sha>.<ext>        biblioteca interna de arquivos
 *   linked/<id>/<nome>            (opcional) cópias de arquivos apenas vinculados
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yazl from 'yazl';
import yauzl from 'yauzl';
import Database from 'better-sqlite3';
import { openDatabase, migrate, checkIntegrity, getUserVersion, type DB } from '../db/connection';
import { LATEST_DB_VERSION } from '../db/migrations';

export const BACKUP_FORMAT = 1;
export const DB_ENTRY = 'db/workspace.sqlite';

export interface ManifestFile { path: string; size: number; sha256: string }
export interface Manifest {
  format: number; app: 'Workspace'; appVersion: string; dbVersion: number; createdAt: string;
  includeLinked: boolean; counts: Record<string, number>; files: ManifestFile[];
  linkedNotIncluded: { id: number; name: string; path: string }[];
}
export interface Progress { phase: 'preparando' | 'banco' | 'arquivos' | 'verificando' | 'extraindo' | 'migrando' | 'concluído'; done: number; total: number; detail?: string }
export interface VerifyReport {
  ok: boolean; errors: string[]; warnings: string[]; manifest: Manifest | null;
  compatible: boolean; needsMigration: boolean; counts: Record<string, number>; totalSize: number;
}

const COUNT_SQL: Record<string, string> = {
  tarefas: 'SELECT COUNT(*) n FROM tasks WHERE deleted_at IS NULL',
  subtarefas: "SELECT COUNT(*) n FROM checklist_items",
  projetos: 'SELECT COUNT(*) n FROM projects WHERE deleted_at IS NULL',
  etiquetas: 'SELECT COUNT(*) n FROM tags',
  anotacoes: 'SELECT COUNT(*) n FROM notes WHERE deleted_at IS NULL',
  versoes_de_notas: 'SELECT COUNT(*) n FROM note_versions',
  desenhos: "SELECT COUNT(*) n FROM canvases WHERE kind = 'drawing' AND deleted_at IS NULL",
  quadros: "SELECT COUNT(*) n FROM canvases WHERE kind = 'board' AND deleted_at IS NULL",
  imagens: 'SELECT COUNT(*) n FROM media',
  arquivos: 'SELECT COUNT(*) n FROM attachments WHERE deleted_at IS NULL',
  lembretes: 'SELECT COUNT(*) n FROM reminders',
  notas_flutuantes: 'SELECT COUNT(*) n FROM floating_notes WHERE deleted_at IS NULL',
  lixeira: `SELECT (SELECT COUNT(*) FROM tasks WHERE deleted_at IS NOT NULL) + (SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL) n`,
};
export function countData(db: DB | Database.Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, sql] of Object.entries(COUNT_SQL)) { try { out[k] = (db.prepare(sql).get() as { n: number }).n; } catch { /* tabela inexistente em versões antigas */ } }
  return out;
}

async function sha256File(file: string): Promise<string> {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), new Transform({ transform(c, _e, cb) { h.update(c); cb(); } }));
  return h.digest('hex');
}
function walk(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p, base);
    return e.isFile() && !e.name.startsWith('.importando-') ? [path.relative(base, p)] : [];
  });
}
const zipPath = (rel: string) => rel.split(path.sep).join('/');
const safeName = (n: string) => n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 150) || 'arquivo';

export async function freeSpace(dir: string): Promise<number | null> {
  try { const s = await fs.promises.statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

/**
 * Gera o ZIP: grava em `<destino>.parcial`, verifica e só então renomeia para o nome final.
 * Os dados originais não são modificados (o banco é lido por uma cópia consistente).
 */
export async function exportBackup(opts: {
  db: DB; filesDir: string; tmpDir: string; dest: string; appVersion: string; includeLinked: boolean; onProgress?: (p: Progress) => void;
}): Promise<{ path: string; size: number; manifest: Manifest; report: VerifyReport }> {
  const { db, filesDir, tmpDir, dest, onProgress } = opts;
  fs.mkdirSync(tmpDir, { recursive: true });
  onProgress?.({ phase: 'preparando', done: 0, total: 1 });
  const snap = path.join(tmpDir, `snapshot-${process.pid}-${Date.now()}.sqlite`);
  const partial = dest + '.parcial';
  try {
    // 1) cópia consistente do banco, mesmo com o programa aberto
    onProgress?.({ phase: 'banco', done: 0, total: 1 });
    await db.backup(snap);
    const snapDb = new Database(snap, { readonly: true });
    let counts: Record<string, number>, linked: { id: number; name: string; path: string }[], dbVersion: number;
    try {
      counts = countData(snapDb);
      linked = (() => { try { return snapDb.prepare("SELECT id, name, stored_path AS path FROM attachments WHERE mode = 'link' AND deleted_at IS NULL").all() as { id: number; name: string; path: string }[]; } catch { return []; } })();
      dbVersion = snapDb.pragma('user_version', { simple: true }) as number;
    } finally { snapDb.close(); }

    // 2) inventário
    const entries: { zip: string; abs: string }[] = [{ zip: DB_ENTRY, abs: snap }];
    for (const rel of walk(filesDir)) entries.push({ zip: 'files/' + zipPath(rel), abs: path.join(filesDir, rel) });
    const linkedNotIncluded: Manifest['linkedNotIncluded'] = [];
    for (const l of linked) {
      if (opts.includeLinked && fs.existsSync(l.path) && fs.statSync(l.path).isFile()) entries.push({ zip: `linked/${l.id}/${safeName(path.basename(l.path))}`, abs: l.path });
      else linkedNotIncluded.push(l);
    }
    const total = entries.reduce((s, e) => s + fs.statSync(e.abs).size, 0);
    const free = await freeSpace(path.dirname(dest));
    if (free !== null && free < total * 1.05 + 10 * 1024 * 1024) throw new Error(`Espaço em disco insuficiente no destino (necessário ~${Math.ceil(total / 1048576)} MB, disponível ${Math.floor(free / 1048576)} MB).`);

    // 3) hashes + ZIP
    const files: ManifestFile[] = [];
    let done = 0;
    for (const e of entries) {
      files.push({ path: e.zip, size: fs.statSync(e.abs).size, sha256: await sha256File(e.abs) });
      onProgress?.({ phase: 'arquivos', done: ++done, total: entries.length * 2, detail: e.zip });
    }
    const manifest: Manifest = {
      format: BACKUP_FORMAT, app: 'Workspace', appVersion: opts.appVersion, dbVersion, createdAt: new Date().toISOString(),
      includeLinked: opts.includeLinked, counts, files, linkedNotIncluded,
    };
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'manifest.json');
    for (const e of entries) {
      // arquivos já comprimidos (imagens, zip, docx…) são armazenados sem recompressão
      const compress = !/\.(png|jpe?g|webp|gif|zip|docx|xlsx|pptx|mp4|mp3|7z|rar|gz)$/i.test(e.zip);
      zip.addFile(e.abs, e.zip, { compress });
    }
    zip.end();
    const out = fs.createWriteStream(partial, { flags: 'w' });
    let written = 0;
    zip.outputStream.on('data', (c: Buffer) => { written += c.length; onProgress?.({ phase: 'arquivos', done: entries.length + Math.min(entries.length, Math.round((written / Math.max(total, 1)) * entries.length)), total: entries.length * 2 }); });
    await pipeline(zip.outputStream, out);
    await new Promise<void>((res, rej) => fs.open(partial, 'r+', (err, fd) => (err ? rej(err) : fs.fsync(fd, (e) => fs.close(fd, () => (e ? rej(e) : res()))))));

    // 4) verificação completa antes de declarar sucesso
    onProgress?.({ phase: 'verificando', done: 0, total: 1 });
    const report = await verifyBackup(partial, tmpDir);
    if (!report.ok) throw new Error('A verificação do backup falhou: ' + report.errors.join('; '));
    fs.renameSync(partial, dest);
    onProgress?.({ phase: 'concluído', done: 1, total: 1 });
    return { path: dest, size: fs.statSync(dest).size, manifest, report };
  } catch (e) {
    fs.rmSync(partial, { force: true });
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOSPC') throw new Error('Espaço em disco insuficiente para gravar o backup.');
    throw e;
  } finally {
    for (const f of [snap, snap + '-wal', snap + '-shm']) fs.rmSync(f, { force: true });
  }
}

// ---------------------------------------------------------------- leitura ----

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((res, rej) => yauzl.open(file, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (e, z) => (e ? rej(e) : res(z!))));
}
async function listEntries(z: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((res, rej) => {
    const out: yauzl.Entry[] = [];
    z.on('entry', (e: yauzl.Entry) => { out.push(e); z.readEntry(); });
    z.on('end', () => res(out)); z.on('error', rej);
    z.readEntry();
  });
}
function readStream(z: yauzl.ZipFile, e: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((res, rej) => z.openReadStream(e, (err, s) => (err ? rej(err) : res(s!))));
}

/** Proteção contra "zip slip": só caminhos relativos, sem "..", dentro das pastas conhecidas. */
export function isSafeEntry(name: string): boolean {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false;
  const isDir = name.endsWith('/');
  const parts = (isDir ? name.slice(0, -1) : name).split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '')) return false;
  if (isDir) return ['db', 'files', 'linked'].includes(parts[0]);
  return name === 'manifest.json' || name === DB_ENTRY || /^files\/[^/]+\/[^/]+$/.test(name) || /^linked\/\d+\/[^/]+$/.test(name);
}
export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, ...rel.split('/'));
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error('Caminho inválido no backup: ' + rel);
  return abs;
}

/** Verifica integridade (hashes), estrutura, compatibilidade e o próprio banco contido no ZIP. */
export async function verifyBackup(file: string, tmpDir: string): Promise<VerifyReport> {
  const r: VerifyReport = { ok: false, errors: [], warnings: [], manifest: null, compatible: false, needsMigration: false, counts: {}, totalSize: 0 };
  let z: yauzl.ZipFile | null = null;
  const tmpDb = path.join(tmpDir, `verificacao-${process.pid}-${Date.now()}.sqlite`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    z = await openZip(file);
    const entries = await listEntries(z);
    const bad = entries.filter((e) => !isSafeEntry(e.fileName));
    if (bad.length) r.errors.push(`Entradas inválidas ou inseguras: ${bad.slice(0, 5).map((e) => e.fileName).join(', ')}`);
    const byName = new Map(entries.map((e) => [e.fileName, e]));
    const me = byName.get('manifest.json');
    if (!me) { r.errors.push('manifest.json ausente: este arquivo não é um backup do Workspace.'); return r; }
    if (me.uncompressedSize > 50 * 1024 * 1024) { r.errors.push('Manifesto grande demais.'); return r; }
    const chunks: Buffer[] = []; for await (const c of await readStream(z, me)) chunks.push(c as Buffer);
    let m: Manifest;
    try { m = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { r.errors.push('Manifesto corrompido.'); return r; }
    if (m.app !== 'Workspace' || !Array.isArray(m.files)) { r.errors.push('Manifesto não reconhecido.'); return r; }
    r.manifest = m;
    if (m.format > BACKUP_FORMAT) r.errors.push(`Formato de backup ${m.format} é mais novo que o suportado (${BACKUP_FORMAT}). Atualize o Workspace.`);
    if (m.dbVersion > LATEST_DB_VERSION) r.errors.push(`O backup foi criado por uma versão mais nova (banco v${m.dbVersion}; este programa suporta até v${LATEST_DB_VERSION}). Atualize o Workspace.`);
    r.compatible = m.dbVersion <= LATEST_DB_VERSION && m.format <= BACKUP_FORMAT;
    r.needsMigration = m.dbVersion < LATEST_DB_VERSION;
    if (!m.files.some((f) => f.path === DB_ENTRY)) r.errors.push('Banco de dados ausente no backup.');
    const listed = new Set(m.files.map((f) => f.path));
    for (const e of entries) if (!e.fileName.endsWith('/') && e.fileName !== 'manifest.json' && !listed.has(e.fileName)) r.warnings.push(`Arquivo não listado no manifesto será ignorado: ${e.fileName}`);

    for (const f of m.files) {
      const e = byName.get(f.path);
      if (!e) { r.errors.push(`Arquivo listado no manifesto não encontrado no ZIP: ${f.path}`); continue; }
      if (e.uncompressedSize !== f.size) { r.errors.push(`Tamanho divergente: ${f.path}`); continue; }
      r.totalSize += f.size;
      const h = crypto.createHash('sha256');
      const s = await readStream(z, e);
      if (f.path === DB_ENTRY) await pipeline(s, new Transform({ transform(c, _e, cb) { h.update(c); cb(null, c); } }), fs.createWriteStream(tmpDb));
      else for await (const c of s) h.update(c as Buffer);
      if (h.digest('hex') !== f.sha256) r.errors.push(`Arquivo corrompido (hash não confere): ${f.path}`);
    }
    if (fs.existsSync(tmpDb) && !r.errors.some((x) => x.includes(DB_ENTRY))) {
      try {
        const d = new Database(tmpDb, { readonly: true, fileMustExist: true });
        try {
          const ic = d.pragma('integrity_check', { simple: true });
          if (ic !== 'ok') r.errors.push('Banco de dados do backup falhou na verificação de integridade: ' + ic);
          if ((d.pragma('user_version', { simple: true }) as number) !== m.dbVersion) r.errors.push('Versão do banco não confere com o manifesto.');
          r.counts = countData(d);
        } finally { d.close(); }
      } catch (e) { r.errors.push('Não foi possível abrir o banco do backup: ' + (e as Error).message); }
    }
    if (m.linkedNotIncluded?.length) r.warnings.push(`${m.linkedNotIncluded.length} arquivo(s) apenas vinculado(s) não estão no backup (somente o caminho original foi guardado).`);
    r.ok = r.errors.length === 0;
    return r;
  } catch (e) {
    r.errors.push('Arquivo ZIP ilegível ou corrompido: ' + (e as Error).message);
    return r;
  } finally {
    z?.close();
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) fs.rmSync(f, { force: true });
  }
}

// ------------------------------------------------------------ restauração ----

export const PENDING_MARKER = 'restauracao-pendente.json';
export const RESULT_MARKER = 'restauracao-resultado.json';
interface Pending { staging: string; createdAt: string; source: string; safetyBackup: string | null }

/**
 * Etapa 1 (com o programa aberto, sem tocar nos dados atuais): verifica, extrai para uma área de preparação
 * com validação de caminhos, ajusta vínculos externos, aplica migrações à cópia e grava um marcador.
 * A troca efetiva acontece na próxima inicialização, antes de o banco ser aberto (`applyPendingRestore`).
 */
export async function prepareRestore(opts: { zip: string; dataDir: string; safetyBackup: string | null; onProgress?: (p: Progress) => void }): Promise<{ report: VerifyReport; staging: string }> {
  const { zip, dataDir, onProgress } = opts;
  const tmp = path.join(dataDir, 'tmp');
  onProgress?.({ phase: 'verificando', done: 0, total: 1 });
  const report = await verifyBackup(zip, tmp);
  if (!report.ok) throw new Error('Backup inválido: ' + report.errors.join('; '));
  const staging = path.join(dataDir, `restauracao-preparo-${Date.now()}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const z = await openZip(zip);
  try {
    const entries = (await listEntries(z)).filter((e) => !e.fileName.endsWith('/'));
    const listed = new Set(report.manifest!.files.map((f) => f.path));
    let done = 0;
    for (const e of entries) {
      if (!listed.has(e.fileName) || !isSafeEntry(e.fileName)) continue;
      const rel = e.fileName === DB_ENTRY ? 'data/workspace.sqlite' : e.fileName;
      const dest = resolveInside(staging, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await pipeline(await readStream(z, e), fs.createWriteStream(dest, { flags: 'wx' }));
      onProgress?.({ phase: 'extraindo', done: ++done, total: listed.size, detail: e.fileName });
    }
  } finally { z.close(); }

  // vínculos externos incluídos: se o original não existir neste computador, a cópia vai para a biblioteca interna
  onProgress?.({ phase: 'migrando', done: 0, total: 1 });
  const dbFile = path.join(staging, 'data', 'workspace.sqlite');
  const db = openDatabase(dbFile);
  try {
    await migrate(db, path.join(staging, 'backups-migracao'));
    const linkedDir = path.join(staging, 'linked');
    if (fs.existsSync(linkedDir)) {
      for (const idDir of fs.readdirSync(linkedDir)) {
        const [name] = fs.readdirSync(path.join(linkedDir, idDir));
        const row = db.prepare("SELECT id, stored_path FROM attachments WHERE id = ? AND mode = 'link'").get(Number(idDir)) as { id: number; stored_path: string } | undefined;
        if (!row || !name || fs.existsSync(row.stored_path)) continue;
        const src = path.join(linkedDir, idDir, name);
        const sha = await sha256File(src);
        const rel = path.join(sha.slice(0, 2), sha + path.extname(name).toLowerCase());
        const dst = path.join(staging, 'files', rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
        db.prepare("UPDATE attachments SET mode = 'internal', stored_path = ?, sha256 = ? WHERE id = ?").run(rel, sha, row.id);
      }
      fs.rmSync(linkedDir, { recursive: true, force: true });
    }
    const ic = checkIntegrity(db);
    if (!ic.ok) throw new Error(ic.message);
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally { db.close(); }
  fs.mkdirSync(path.join(staging, 'files'), { recursive: true });
  const pending: Pending = { staging, createdAt: new Date().toISOString(), source: zip, safetyBackup: opts.safetyBackup };
  writeJsonAtomic(path.join(dataDir, PENDING_MARKER), pending);
  onProgress?.({ phase: 'concluído', done: 1, total: 1 });
  return { report, staging };
}

function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  const fd = fs.openSync(tmp, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd);
  fs.renameSync(tmp, file);
}

export interface RestoreResult { ok: boolean; message: string; previousDir: string | null; at: string }

/**
 * Etapa 2 (na inicialização, antes de abrir o banco): troca `data/` e `files/` pelos preparados.
 * Os dados anteriores são movidos (não apagados) para `dados-anteriores-<data>/`. Qualquer falha desfaz a troca.
 * Também recupera uma troca interrompida (ex.: queda de energia no meio).
 */
export function applyPendingRestore(dataDir: string): RestoreResult | null {
  const markerFile = path.join(dataDir, PENDING_MARKER);
  if (!fs.existsSync(markerFile)) return null;
  const at = new Date().toISOString();
  let pending: Pending & { swapping?: { previousDir: string; moved: string[] } };
  try { pending = JSON.parse(fs.readFileSync(markerFile, 'utf8')); } catch { fs.rmSync(markerFile, { force: true }); return { ok: false, message: 'Marcador de restauração corrompido; nenhum dado foi alterado.', previousDir: null, at }; }
  const items = ['data', 'files'];

  // troca interrompida anteriormente: desfaz e mantém os dados que existiam antes
  if (pending.swapping) {
    const { previousDir, moved } = pending.swapping;
    for (const it of moved) {
      const cur = path.join(dataDir, it); const prev = path.join(previousDir, it);
      if (fs.existsSync(prev)) { fs.rmSync(cur, { recursive: true, force: true }); fs.renameSync(prev, cur); }
    }
    fs.rmSync(markerFile, { force: true });
    return writeResult(dataDir, { ok: false, message: 'A restauração anterior foi interrompida e foi desfeita. Seus dados anteriores foram mantidos.', previousDir: null, at });
  }
  if (!fs.existsSync(path.join(pending.staging, 'data', 'workspace.sqlite'))) {
    fs.rmSync(markerFile, { force: true });
    return writeResult(dataDir, { ok: false, message: 'Dados preparados para restauração não encontrados; nada foi alterado.', previousDir: null, at });
  }
  const previousDir = path.join(dataDir, `dados-anteriores-${at.replace(/[:.]/g, '-')}`);
  fs.mkdirSync(previousDir, { recursive: true });
  const moved: string[] = [];
  try {
    writeJsonAtomic(markerFile, { ...pending, swapping: { previousDir, moved } });
    for (const it of items) {
      const cur = path.join(dataDir, it);
      if (fs.existsSync(cur)) { fs.renameSync(cur, path.join(previousDir, it)); moved.push(it); writeJsonAtomic(markerFile, { ...pending, swapping: { previousDir, moved } }); }
    }
    for (const it of items) fs.renameSync(path.join(pending.staging, it), path.join(dataDir, it));
    // fecha o banco mesmo se a verificação falhar: no Windows um arquivo aberto não pode ser movido/apagado
    let ic: unknown;
    const db = new Database(path.join(dataDir, 'data', 'workspace.sqlite'), { fileMustExist: true });
    try { ic = db.pragma('integrity_check', { simple: true }); } finally { db.close(); }
    if (ic !== 'ok') throw new Error('integridade: ' + ic);
    fs.rmSync(pending.staging, { recursive: true, force: true });
    fs.rmSync(markerFile, { force: true });
    return writeResult(dataDir, { ok: true, message: 'Backup restaurado com sucesso.', previousDir, at });
  } catch (e) {
    for (const it of items) {
      const cur = path.join(dataDir, it); const prev = path.join(previousDir, it);
      if (fs.existsSync(prev)) { fs.rmSync(cur, { recursive: true, force: true }); fs.renameSync(prev, cur); }
    }
    fs.rmSync(markerFile, { force: true });
    return writeResult(dataDir, { ok: false, message: 'Falha ao restaurar; os dados anteriores foram mantidos. ' + (e as Error).message, previousDir: null, at });
  }
}
function writeResult(dataDir: string, r: RestoreResult): RestoreResult { writeJsonAtomic(path.join(dataDir, RESULT_MARKER), r); return r; }

/** Restauração preparada mas não aplicada pode ser cancelada antes de reiniciar. */
export function cancelPendingRestore(dataDir: string): void {
  const markerFile = path.join(dataDir, PENDING_MARKER);
  if (!fs.existsSync(markerFile)) return;
  const p = JSON.parse(fs.readFileSync(markerFile, 'utf8')) as Pending;
  if ((p as { swapping?: unknown }).swapping) return;
  fs.rmSync(p.staging, { recursive: true, force: true });
  fs.rmSync(markerFile, { force: true });
}

export { getUserVersion };
