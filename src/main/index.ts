import { app, BrowserWindow, dialog, screen } from 'electron';
import path from 'node:path';
import { openDatabase, migrate, checkIntegrity, type DB } from './db/connection';
import { registerIpc } from './ipc';
import { initLogger, log } from './logger';
import { SettingsService } from './services/workspace';

/**
 * Dados do usuário ficam em %APPDATA%\Workspace (app.getPath('userData')),
 * separados da pasta de instalação. Atualizações/reinstalações não os tocam.
 */
const dataDir = app.getPath('userData');
const paths = {
  db: path.join(dataDir, 'data', 'workspace.sqlite'),
  backups: path.join(dataDir, 'backups'),
  logs: path.join(dataDir, 'logs'),
  windowState: 'window',
};

let db: DB | null = null;
let mainWindow: BrowserWindow | null = null;

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
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: true,
    },
  });
  if (st.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', () => mainWindow && saveWinState(mainWindow));
  // bloqueia navegação e novas janelas arbitrárias no renderer
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'file://')) e.preventDefault(); });

  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
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
  registerIpc({ db, dataDir, version: app.getVersion(), ws: () => ws, setWs: (n) => { ws = n; } });
  createWindow();
}

app.whenReady().then(bootstrap);
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  try { db?.pragma('wal_checkpoint(TRUNCATE)'); db?.close(); } catch (e) { log('error', 'Erro ao fechar o banco', e); }
});
