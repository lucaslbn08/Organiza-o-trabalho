import { app, BrowserWindow, dialog, screen, protocol, ipcMain, Notification } from 'electron';
import { secureWebPreferences, hardenWindow, loadRenderer } from './windows';
import path from 'node:path';
import { openDatabase, migrate, checkIntegrity, type DB } from './db/connection';
import { registerIpc } from './ipc';
import { initLogger, log } from './logger';
import { SettingsService } from './services/workspace';
import { MediaService } from './services/notes';

// imagens das notas: ws-media://<sha256>, servidas do banco (somente leitura)
protocol.registerSchemesAsPrivileged([{ scheme: 'ws-media', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/**
 * Dados do usuário ficam em %APPDATA%\Workspace (app.getPath('userData')),
 * separados da pasta de instalação. Atualizações/reinstalações não os tocam.
 */
const dataDir = app.getPath('userData');
const paths = {
  db: path.join(dataDir, 'data', 'workspace.sqlite'),
  backups: path.join(dataDir, 'backups'),
  logs: path.join(dataDir, 'logs'),
  files: path.join(dataDir, 'files'),
  windowState: 'window',
};

let db: DB | null = null;
let mainWindow: BrowserWindow | null = null;
let onQuit: (() => void) | null = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

process.on('uncaughtException', (e) => log('error', 'Exceção não tratada', e));
process.on('unhandledRejection', (e) => log('error', 'Promise rejeitada', e));

interface WinState { x?: number; y?: number; width: number; height: number; maximized: boolean }

function loadWinState(): WinState {
  const def: WinState = { width: 1280, height: 800, maximized: false };
  try {
    const row = db!.prepare("SELECT value FROM settings WHERE key = '__window'").get() as { value: string } | undefined;
    if (!row) return def;
    const s = JSON.parse(row.value) as WinState;
    const visible = s.x === undefined || screen.getAllDisplays().some((d) => {
      const b = d.workArea; return s.x! >= b.x - 50 && s.y! >= b.y - 50 && s.x! < b.x + b.width && s.y! < b.y + b.height;
    });
    return visible ? s : { ...def, width: s.width, height: s.height };
  } catch { return def; }
}

function saveWinState(win: BrowserWindow): void {
  try {
    const b = win.getNormalBounds();
    db!.prepare("INSERT INTO settings (key, value) VALUES ('__window', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch (e) { log('warn', 'Não foi possível salvar o estado da janela', e); }
}

function createWindow(): void {
  const st = loadWinState();
  mainWindow = new BrowserWindow({
    x: st.x, y: st.y, width: st.width, height: st.height, minWidth: 900, minHeight: 600,
    show: false, backgroundColor: '#0f1115', title: 'Workspace', autoHideMenuBar: true,
    webPreferences: secureWebPreferences(),
  });
  if (st.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // antes de fechar, pede ao renderer que grave edições pendentes (autosave com debounce)
  let flushed = false;
  mainWindow.on('close', (e) => {
    if (!mainWindow) return;
    saveWinState(mainWindow);
    if (flushed) return;
    e.preventDefault();
    const win = mainWindow;
    const done = () => { flushed = true; ipcMain.removeAllListeners('app:flushed'); if (!win.isDestroyed()) win.close(); };
    ipcMain.once('app:flushed', done);
    setTimeout(done, 2500); // nunca impede o fechamento por mais de 2,5 s
    win.webContents.send('app:flush');
  });
  // bloqueia navegação e novas janelas arbitrárias no renderer
  hardenWindow(mainWindow);
  // fechar a janela principal encerra o app (notas flutuantes abertas são reabertas na próxima vez)
  mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
  loadRenderer(mainWindow);
}

async function bootstrap(): Promise<void> {
  initLogger(paths.logs);
  log('info', `Iniciando Workspace ${app.getVersion()} — dados em ${dataDir}`);
  try {
    db = openDatabase(paths.db);
    const integ = checkIntegrity(db);
    if (!integ.ok) log('error', 'Falha de integridade ao abrir: ' + integ.message);
    const rep = await migrate(db, paths.backups);
    if (rep.applied.length) log('info', `Migrações aplicadas (${rep.from}→${rep.to}): ${rep.applied.join(' | ')}; backup: ${rep.backupPath ?? 'n/a'}`);
  } catch (e) {
    log('error', 'Falha ao abrir/migrar o banco', e);
    dialog.showErrorBox('Workspace — erro no banco de dados',
      `Não foi possível abrir seus dados. Nenhum dado foi apagado.\n\n${(e as Error).message}\n\nPasta de dados: ${dataDir}`);
    app.exit(1);
    return;
  }
  let ws = new SettingsService(db).get().activeWorkspaceId || 1;
  const media = new MediaService(db);
  protocol.handle('ws-media', (req) => {
    const m = media.get(new URL(req.url).hostname);
    return m ? new Response(new Uint8Array(m.data), { headers: { 'content-type': m.mime, 'cache-control': 'max-age=31536000, immutable' } }) : new Response('não encontrado', { status: 404 });
  });
  const ipc = registerIpc({ filesDir: paths.files, mainWindow: () => mainWindow, media, db, dataDir, version: app.getVersion(), ws: () => ws, setWs: (n) => { ws = n; } });
  createWindow();
  ipc.sticky.restoreOpen();
  onQuit = () => ipc.sticky.closeAllForQuit();
  startScheduler(ipc);
}

/** Verifica lembretes e prazos a cada 30 s; avisa no app e, se autorizado, pelas notificações do Windows. */
function startScheduler(ipc: ReturnType<typeof registerIpc>): void {
  const tick = () => {
    try {
      const s = ipc.settings.get();
      if (!s.notificationsEnabled) return;
      const send = (title: string, body: string, nav: { view: string; id?: number }) => {
        mainWindow?.webContents.send('app:event', { type: 'notice', title, body, ...nav });
        if (s.systemNotifications && Notification.isSupported()) {
          const n = new Notification({ title, body, silent: false });
          n.on('click', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('app:event', { type: 'navigate', ...nav }); } });
          n.show();
        }
      };
      for (const r of ipc.planning.takeDue()) {
        mainWindow?.webContents.send('app:event', { type: 'reminder', reminder: r });
        send('Lembrete', r.title + (r.task_title && r.task_title !== r.title ? ` — ${r.task_title}` : ''), r.task_id ? { view: 'task', id: r.task_id } : { view: 'agenda' });
      }
      for (const t of ipc.planning.takeDueTasks(s.dueReminderTime)) send('Prazo hoje', t.title + (t.due_time ? ` às ${t.due_time}` : ''), { view: 'task', id: t.id });
    } catch (e) { log('error', 'Falha no agendador de lembretes', e); }
  };
  setTimeout(tick, 5000);
  setInterval(tick, 30_000);
}

if (process.platform === 'win32') app.setAppUserModelId('br.local.workspace'); // necessário para notificações do Windows
app.whenReady().then(bootstrap);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => onQuit?.());
app.on('will-quit', () => {
  try { db?.pragma('wal_checkpoint(TRUNCATE)'); db?.close(); } catch (e) { log('error', 'Erro ao fechar o banco', e); }
});
