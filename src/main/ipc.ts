import { ipcMain, BrowserWindow, shell, dialog, clipboard, ClipboardItem } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CanvasService } from './services/canvases';
import { AttachmentService, isExecutable } from './services/attachments';
import { PlanningService, FloatingService } from './services/planning';
import { appendImageToNote, insertImageIntoCanvas, pngSize } from './services/capture';
import { StickyManager, CaptureManager, isTrustedUrl } from './windows';
import { z } from 'zod';
import type { DB } from './db/connection';
import { checkIntegrity, getUserVersion } from './db/connection';
import { TaskService } from './services/tasks';
import { OrgService, SettingsService } from './services/workspace';
import { listHistory } from './services/history';
import { NoteService, MediaService } from './services/notes';
import { searchAll } from './services/search';
import { TASK_STATUSES, TASK_PRIORITIES, RECURRENCES } from '../shared/types';
import { log } from './logger';

const id = z.number().int().positive();
const nullableId = id.nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const taskInput = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(200_000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  project_id: nullableId, category_id: nullableId, due_date: date, due_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  recurrence: z.enum(RECURRENCES).optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
});
const taskQuery = z.object({
  search: z.string().max(200).optional(),
  statuses: z.array(z.enum(TASK_STATUSES)).optional(),
  priorities: z.array(z.enum(TASK_PRIORITIES)).optional(),
  project_id: id.nullable().optional(), category_id: id.nullable().optional(),
  showCompleted: z.boolean().optional(),
  sort: z.enum(['manual', 'title', 'created', 'due', 'priority']).optional(),
});
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const settingsPatch = z.object({
  theme: z.enum(['dark', 'light']), accent: color, uiScale: z.number().min(0.75).max(1.5),
  animations: z.boolean(), sidebarCollapsed: z.boolean(), showCompleted: z.boolean(),
  dashboardPanels: z.array(z.object({ id: z.string().max(40), visible: z.boolean() })).max(30),
  lastView: z.string().max(40), activeWorkspaceId: id,
  openNotes: z.array(id).max(30), activeNote: id.nullable(),
  openCanvas: z.object({ drawing: id.nullable(), board: id.nullable() }), wheelZoom: z.boolean(),
  notificationsEnabled: z.boolean(), systemNotifications: z.boolean(), dueReminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  tabs: z.array(z.object({ id: z.string().max(40), view: z.string().max(40), arg: z.number().int().positive().optional() })).min(1).max(20),
  activeTab: z.string().max(40), split: z.object({ tabId: z.string().max(40), dir: z.enum(['vertical', 'horizontal']) }).nullable(),
}).partial();
const trashType = z.enum(['task', 'project', 'note', 'canvas', 'attachment']);
const sceneJson = z.string().max(200_000_000);
const kind = z.enum(['drawing', 'board']);
const linkType = z.enum(['task', 'note']);
const attTarget = z.object({ type: z.enum(['task', 'note', 'project', 'canvas']), id: z.number().int().positive() });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const docJson = z.string().max(50_000_000).refine((v) => { try { return JSON.parse(v)?.type === 'doc'; } catch { return false; } }, 'documento inválido');
const notePatch = z.object({
  title: z.string().max(500).optional(), content_json: docJson.optional(), folder_id: id.nullable().optional(),
  project_id: id.nullable().optional(), category_id: id.nullable().optional(), pinned: z.boolean().optional(),
  favorite: z.boolean().optional(), tags: z.array(z.string().max(60)).max(50).optional(),
});

export interface IpcContext { filesDir: string; mainWindow: () => BrowserWindow | null; media: MediaService; db: DB; dataDir: string; version: string; ws: () => number; setWs: (n: number) => void }

export function registerIpc(ctx: IpcContext): { planning: PlanningService; sticky: StickyManager; settings: SettingsService } {
  const tasks = new TaskService(ctx.db, ctx.ws);
  const org = new OrgService(ctx.db, ctx.ws);
  const settings = new SettingsService(ctx.db);
  const notes = new NoteService(ctx.db, ctx.ws);
  const canvases = new CanvasService(ctx.db, ctx.ws);
  const attachments = new AttachmentService(ctx.db, ctx.ws, ctx.filesDir);
  const planning = new PlanningService(ctx.db, ctx.ws, tasks);
  const floating = new FloatingService(ctx.db, ctx.ws);
  const sticky = new StickyManager(floating);
  const capture = new CaptureManager(ctx.mainWindow);
  const svc = { tasks, notes, canvases, attachments };

  const notify = (scope: string) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('data:changed', scope));

  /** Registra um handler validando os argumentos; `mutates` dispara a sincronização entre telas/janelas. */
  function handle<A extends z.ZodTypeAny[]>(channel: string, schemas: [...A], fn: (...args: { [K in keyof A]: z.infer<A[K]> }) => unknown, mutates?: string) {
    ipcMain.handle(channel, async (event, ...raw) => {
      if (!event.senderFrame || !isTrustedUrl(event.senderFrame.url)) throw new Error('Origem não autorizada.');
      try {
        const args = schemas.map((s, i) => s.parse(raw[i])) as { [K in keyof A]: z.infer<A[K]> };
        const result = await fn(...args);
        if (mutates) notify(mutates);
        return result;
      } catch (err) {
        log('error', `IPC ${channel} falhou`, err);
        if (err instanceof z.ZodError) throw new Error('Dados inválidos: ' + err.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
        throw err;
      }
    });
  }

  handle('app:info', [], () => ({
    version: ctx.version, dbVersion: getUserVersion(ctx.db), dataDir: ctx.dataDir,
    platform: `${process.platform} ${process.arch}`, electron: process.versions.electron,
  }));
  handle('app:openDataDir', [], () => shell.openPath(ctx.dataDir).then(() => undefined));

  handle('settings:get', [], () => settings.get());
  handle('settings:set', [settingsPatch], (p) => {
    const s = settings.set(p);
    if (p.activeWorkspaceId) ctx.setWs(p.activeWorkspaceId);
    return s;
  }, 'settings');

  handle('workspaces:list', [], () => org.workspaces());
  handle('workspaces:create', [z.string().trim().min(1).max(100)], (n) => org.createWorkspace(n), 'workspaces');

  handle('projects:list', [], () => org.projects());
  handle('projects:create', [z.object({ name: z.string().trim().min(1).max(200), color: color.optional(), icon: z.string().max(40).optional(), description: z.string().max(10000).optional() })], (i) => org.createProject(i), 'projects');
  handle('projects:update', [id, z.object({ name: z.string().trim().min(1).max(200).optional(), color: color.optional(), icon: z.string().max(40).optional(), description: z.string().max(10000).optional() })], (i, p) => org.updateProject(i, p), 'projects');
  handle('projects:remove', [id], (i) => org.removeProject(i), 'projects');

  handle('categories:list', [], () => org.categories());
  handle('categories:create', [z.string().trim().min(1).max(100), color.optional()], (n, c) => org.createCategory(n, c), 'categories');
  handle('categories:remove', [id], (i) => org.removeCategory(i), 'categories');
  handle('tags:list', [], () => org.tags());

  handle('tasks:list', [taskQuery.optional()], (q) => tasks.list(q ?? {}));
  handle('tasks:get', [id], (i) => tasks.detail(i));
  handle('tasks:create', [taskInput], (i) => tasks.create(i), 'tasks');
  handle('tasks:update', [id, taskInput.partial()], (i, p) => tasks.update(i, p), 'tasks');
  handle('tasks:duplicate', [id], (i) => tasks.duplicate(i), 'tasks');
  handle('tasks:remove', [id], (i) => tasks.remove(i), 'tasks');
  handle('tasks:reorder', [z.array(id).max(10000), z.enum(TASK_STATUSES).optional(), id.nullable().optional()], (ids, s, c) => tasks.reorder(ids, s, c), 'tasks');
  handle('tasks:addChecklist', [id, z.enum(['checklist', 'subtask']), z.string().trim().min(1).max(1000)], (t, k, x) => tasks.addChecklist(t, k, x), 'tasks');
  handle('tasks:updateChecklist', [id, z.object({ text: z.string().trim().min(1).max(1000).optional(), done: z.boolean().optional() })], (i, p) => tasks.updateChecklist(i, p), 'tasks');
  handle('tasks:removeChecklist', [id], (i) => tasks.removeChecklist(i), 'tasks');
  handle('tasks:addComment', [id, z.string().trim().min(1).max(20000)], (t, b) => tasks.addComment(t, b), 'tasks');
  handle('tasks:addLink', [id, z.string().max(300), z.string().trim().min(1).max(2000)], (t, l, u) => tasks.addLink(t, l, u), 'tasks');
  handle('tasks:removeLink', [id], (i) => tasks.removeLink(i), 'tasks');

  handle('kanban:columns', [], () => org.columns());
  handle('kanban:updateColumn', [id, z.object({ title: z.string().max(60).optional(), color: color.optional(), visible: z.boolean().optional() })], (i, p) => org.updateColumn(i, p), 'kanban');

  handle('dashboard:stats', [], () => org.dashboard(svc));
  handle('history:list', [z.number().int().optional()], (l) => listHistory(ctx.db, ctx.ws(), l ?? 200));
  handle('trash:list', [], () => org.trash());
  handle('trash:restore', [trashType, id], (t, i) => org.restore(t, i, svc), 'trash');
  handle('trash:purge', [trashType, id], (t, i) => org.purge(t, i, svc), 'trash');
  handle('trash:empty', [], () => org.emptyTrash(attachments), 'trash');
  const noteQuery = z.object({
    search: z.string().max(200).optional(), folder_id: id.nullable().optional(), project_id: id.optional(), task_id: id.optional(),
    favorites: z.boolean().optional(), tag: z.string().max(60).optional(), category_id: id.optional(),
  });
  handle('notes:list', [noteQuery.optional()], (q) => notes.list(q ?? {}));
  handle('notes:get', [id], (i) => notes.get(i));
  handle('notes:create', [z.object({ title: z.string().max(500).optional(), folder_id: id.nullable().optional(), project_id: id.nullable().optional(), task_id: id.optional() }).optional()], (i) => notes.create(i ?? {}), 'notes');
  handle('notes:update', [id, notePatch], (i, p) => notes.update(i, p), 'notes');
  handle('notes:duplicate', [id], (i) => notes.duplicate(i), 'notes');
  handle('notes:remove', [id], (i) => notes.remove(i), 'notes');
  handle('notes:linkTask', [id, id], (n, t) => notes.linkTask(n, t), 'notes');
  handle('notes:unlinkTask', [id, id], (n, t) => notes.unlinkTask(n, t), 'notes');
  handle('notes:versions', [id], (i) => notes.versions(i));
  handle('notes:versionContent', [id], (i) => notes.versionContent(i));
  handle('notes:snapshot', [id], (i) => notes.snapshot(i), 'notes');
  handle('notes:restoreVersion', [id], (i) => notes.restoreVersion(i), 'notes');
  handle('notes:folders', [], () => notes.folders());
  handle('notes:createFolder', [z.string().trim().min(1).max(120), id.nullable()], (n, p) => notes.createFolder(n, p), 'folders');
  handle('notes:renameFolder', [id, z.string().trim().min(1).max(120)], (i, n) => notes.renameFolder(i, n), 'folders');
  handle('notes:moveFolder', [id, id.nullable()], (i, p) => notes.moveFolder(i, p), 'folders');
  handle('notes:removeFolder', [id], (i) => notes.removeFolder(i), 'folders');
  handle('media:save', [z.instanceof(Uint8Array), z.string().max(40)], (b, m) => ctx.media.save(b, m));
  handle('search:query', [z.string().max(200), z.array(z.enum(['task', 'note', 'project', 'tag', 'drawing', 'board', 'file'])).optional()], (q, t) => searchAll(ctx.db, ctx.ws(), q, t));
  handle('media:get', [z.string().regex(/^[0-9a-f]{64}$/)], (h) => { const m = ctx.media.get(h); return m ? { mime: m.mime, bytes: new Uint8Array(m.data) } : null; });

  const canvasQuery = z.object({ search: z.string().max(200).optional(), project_id: id.optional(), task_id: id.optional(), note_id: id.optional() });
  handle('canvases:list', [kind, canvasQuery.optional()], (k, q) => canvases.list(k, q ?? {}));
  handle('canvases:get', [id], (i) => canvases.get(i));
  handle('canvases:create', [z.object({ kind, title: z.string().max(300).optional(), project_id: id.nullable().optional(), task_id: id.optional(), note_id: id.optional() })], (i) => canvases.create(i), 'canvases');
  handle('canvases:update', [id, z.object({ title: z.string().max(300).optional(), scene_json: sceneJson.optional(), project_id: id.nullable().optional(), thumbnail: z.string().regex(/^ws-media:\/\/[0-9a-f]{64}$/).nullable().optional() })], (i, p) => canvases.update(i, p), 'canvases');
  handle('canvases:duplicate', [id], (i) => canvases.duplicate(i), 'canvases');
  handle('canvases:remove', [id], (i) => canvases.remove(i), 'canvases');
  handle('canvases:touch', [id], (i) => canvases.touch(i));
  handle('canvases:link', [id, linkType, id], (i, t, x) => canvases.link(i, t, x), 'canvases');
  handle('canvases:unlink', [id, linkType, id], (i, t, x) => canvases.unlink(i, t, x), 'canvases');
  handle('canvases:versions', [id], (i) => canvases.versions(i));
  handle('canvases:snapshot', [id], (i) => canvases.snapshot(i), 'canvases');
  handle('canvases:restoreVersion', [id], (i) => canvases.restoreVersion(i), 'canvases');
  handle('briefs:tasks', [z.array(id).max(5000)], (ids) => canvases.taskBriefs(ids));
  handle('briefs:notes', [z.array(id).max(5000)], (ids) => canvases.noteBriefs(ids));

  /** Exportação: o usuário escolhe destino; gravação atômica (arquivo temporário + rename). */
  handle('files:saveAs', [z.instanceof(Uint8Array), z.string().max(200), z.enum(['png', 'pdf'])], async (bytes, name, ext) => {
    const win = BrowserWindow.getFocusedWindow();
    const opts = { defaultPath: name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '.' + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    const target = path.extname(r.filePath).toLowerCase() === '.' + ext ? r.filePath : r.filePath + '.' + ext;
    const tmp = target + '.tmp-' + process.pid;
    try {
      await fs.promises.writeFile(tmp, bytes);
      await fs.promises.rename(tmp, target);
    } catch (e) {
      await fs.promises.rm(tmp, { force: true });
      throw new Error((e as NodeJS.ErrnoException).code === 'ENOSPC' ? 'Espaço em disco insuficiente.' : 'Não foi possível gravar o arquivo: ' + (e as Error).message);
    }
    return target;
  });
  // ---------- arquivos e anexos ----------
  const mode = z.enum(['internal', 'link']);
  handle('files:list', [z.object({ search: z.string().max(200).optional(), folder: z.string().max(500).optional(), target: attTarget.optional(), missingOnly: z.boolean().optional() }).optional()], (q) => attachments.list(q ?? {}));
  handle('files:get', [id], (i) => attachments.get(i));
  handle('files:pick', [mode, attTarget.optional()], async (m, t) => {
    const win = BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = { title: m === 'internal' ? 'Copiar arquivos para a biblioteca' : 'Vincular arquivos (sem copiar)', properties: ['openFile', 'multiSelections'] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? { imported: [], errors: [] } : attachments.importPaths(r.filePaths, m, t);
  }, 'files');
  handle('files:importPaths', [z.array(z.string().max(4000)).max(500), mode, attTarget.optional()], (p, m, t) => attachments.importPaths(p, m, t), 'files');
  handle('files:importBytes', [z.string().max(300), z.instanceof(Uint8Array), z.string().max(200), attTarget.optional(), z.string().max(500).optional()], (n, b, _m, t, f) => attachments.importBytes(n, b, t, f), 'files');
  handle('files:rename', [id, z.string().trim().min(1).max(300)], (i, n) => attachments.rename(i, n), 'files');
  handle('files:setFolder', [id, z.string().max(500)], (i, f) => attachments.setFolder(i, f), 'files');
  handle('files:remove', [id], (i) => attachments.remove(i), 'files');
  handle('files:read', [id], (i) => attachments.read(i));
  handle('files:link', [id, attTarget.shape.type, id], (i, t, x) => attachments.link(i, t, x), 'files');
  handle('files:unlink', [id, attTarget.shape.type, id], (i, t, x) => attachments.unlink(i, t, x), 'files');
  handle('files:embed', [id], (i) => attachments.embed(i), 'files');
  handle('files:open', [id], async (i) => {
    const a = attachments.get(i);
    if (a.missing) throw new Error('Arquivo ausente: ' + a.absolute_path);
    // nunca executa programas/scripts anexados: apenas mostra na pasta
    if (isExecutable(a.absolute_path)) { shell.showItemInFolder(a.absolute_path); throw new Error('Por segurança, arquivos executáveis não são abertos pelo Workspace. A pasta foi exibida.'); }
    const err = await shell.openPath(a.absolute_path);
    if (err) throw new Error('Não foi possível abrir: ' + err);
  });
  handle('files:reveal', [id], (i) => { const a = attachments.get(i); if (a.missing) throw new Error('Arquivo ausente.'); shell.showItemInFolder(a.absolute_path); });
  handle('files:relink', [id], async (i) => {
    const win = BrowserWindow.getFocusedWindow();
    const r = win ? await dialog.showOpenDialog(win, { title: 'Localizar arquivo', properties: ['openFile'] }) : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return false;
    attachments.relink(i, r.filePaths[0]); return true;
  }, 'files');

  // ---------- agenda e lembretes ----------
  handle('reminders:list', [], () => planning.listReminders());
  handle('reminders:create', [z.object({ task_id: id.nullable().optional(), title: z.string().trim().min(1).max(300), remind_at: z.string().max(40) })], (i) => planning.createReminder(i), 'reminders');
  handle('reminders:remove', [id], (i) => planning.removeReminder(i), 'reminders');
  handle('reminders:dismiss', [id], (i) => planning.dismiss(i), 'reminders');
  handle('reminders:snooze', [id, z.number().int().min(1).max(60 * 24 * 7)], (i, m) => planning.snooze(i, m), 'reminders');
  handle('reminders:center', [], () => planning.center());
  handle('agenda:range', [z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)], (f, t) => planning.agenda(f, t));

  // ---------- notas flutuantes ----------
  handle('floating:list', [], () => floating.list());
  handle('floating:get', [id], (i) => floating.get(i));
  handle('floating:create', [z.object({ content: z.string().max(100000).optional(), task_id: id.nullable().optional(), color: color.optional() }).optional()], (i) => { const f = floating.create(i ?? {}); sticky.open(f.id); return f; }, 'floating');
  handle('floating:update', [id, z.object({ content: z.string().max(100000).optional(), color: color.optional(), task_id: id.nullable().optional(), always_on_top: z.boolean().optional(), minimized: z.boolean().optional() })],
    (i, p) => { floating.update(i, p); if (p.always_on_top !== undefined || p.minimized !== undefined) sticky.apply(i); }, 'floating');
  handle('floating:open', [id], (i) => sticky.open(i), 'floating');
  handle('floating:close', [id], (i) => sticky.close(i), 'floating');
  handle('floating:remove', [id], (i) => { sticky.close(i); floating.remove(i); }, 'floating');

  // ---------- captura de tela ----------
  handle('capture:sources', [], () => capture.sources());
  handle('capture:take', [z.string().max(200)], (s) => capture.take(s));
  handle('capture:region', [], () => capture.region());
  handle('capture:regionInit', [], () => capture.regionInit());
  handle('capture:regionDone', [z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable()], (r) => capture.regionDone(r));
  const captureTarget = z.union([z.object({ type: z.enum(['clipboard', 'new-note']) }), z.object({ type: z.enum(['note', 'task', 'drawing', 'board']), id })]);
  handle('capture:send', [z.instanceof(Uint8Array).refine((b) => b.length < 200 * 1024 * 1024), captureTarget], async (png, t) => {
    const { width, height } = pngSize(png);
    const stamp = new Date().toLocaleString('pt-BR').replace(/[/:]/g, '-');
    switch (t.type) {
      case 'clipboard': await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })]); return 'Captura copiada para a área de transferência.';
      case 'new-note': { const n = notes.create({ title: `Captura ${stamp}` }); appendImageToNote(notes, ctx.media, n.id, png); notify('notes'); return `note:${n.id}`; }
      case 'note': appendImageToNote(notes, ctx.media, t.id, png); notify('notes'); return 'Captura adicionada à anotação.';
      case 'task': await attachments.importBytes(`Captura ${stamp}.png`, png, { type: 'task', id: t.id }, 'Capturas'); notify('files'); return 'Captura anexada à tarefa.';
      default: insertImageIntoCanvas(canvases, ctx.media, t.id, png, width, height); notify('canvases'); return `Captura inserida no ${t.type === 'board' ? 'quadro' : 'desenho'}.`;
    }
  });

  handle('db:checkIntegrity', [], () => checkIntegrity(ctx.db));
  return { planning, sticky, settings };

  // links externos de tarefas: somente http(s)/mailto, abertos no navegador padrão
  handle('shell:openExternal', [z.string().url()], (u) => {
    if (!/^(https?:|mailto:)/i.test(u)) throw new Error('Protocolo não permitido.');
    return shell.openExternal(u);
  });
}
