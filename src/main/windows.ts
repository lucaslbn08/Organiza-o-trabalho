import { BrowserWindow, screen, desktopCapturer, type Rectangle } from 'electron';
import path from 'node:path';
import type { FloatingService } from './services/planning';
import type { FloatingNote } from '../shared/types';
import { log } from './logger';

export const isTrustedUrl = (url: string) => url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'file://');

/** Preferências seguras para TODAS as janelas: isolamento, sandbox, sem Node no renderer. */
export function secureWebPreferences(): Electron.WebPreferences {
  return { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: true };
}
export function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!isTrustedUrl(url)) e.preventDefault(); });
}
export function loadRenderer(win: BrowserWindow, hash = ''): void {
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL + (hash ? '#' + hash : ''));
  else void win.loadFile(path.join(__dirname, '../../renderer/index.html'), { hash });
}

/** Janelas de notas flutuantes: pequenas, sem moldura, opcionalmente sempre visíveis sobre outros aplicativos. */
export class StickyManager {
  private wins = new Map<number, BrowserWindow>();
  quitting = false;
  constructor(private floating: FloatingService) {}

  private visibleBounds(f: FloatingNote): Partial<Rectangle> {
    const b = { x: f.x ?? undefined, y: f.y ?? undefined, width: f.width, height: f.minimized ? 40 : f.height };
    if (b.x === undefined || b.y === undefined) return b;
    const onScreen = screen.getAllDisplays().some((d) => b.x! < d.workArea.x + d.workArea.width - 40 && b.x! + b.width > d.workArea.x + 40 && b.y! >= d.workArea.y - 10 && b.y! < d.workArea.y + d.workArea.height - 30);
    return onScreen ? b : { width: b.width, height: b.height };
  }

  open(id: number): void {
    const existing = this.wins.get(id);
    if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return; }
    const f = this.floating.get(id);
    this.floating.update(id, { is_open: true });
    const win = new BrowserWindow({
      ...this.visibleBounds(f), minWidth: 160, minHeight: 40, frame: false, resizable: true, minimizable: true, maximizable: false,
      alwaysOnTop: !!f.always_on_top, skipTaskbar: false, show: false, title: 'Nota flutuante', backgroundColor: f.color,
      webPreferences: secureWebPreferences(),
    });
    if (f.always_on_top) win.setAlwaysOnTop(true, 'floating');
    hardenWindow(win);
    loadRenderer(win, `sticky/${id}`);
    win.once('ready-to-show', () => win.showInactive());
    let t: ReturnType<typeof setTimeout> | undefined;
    const persist = () => { clearTimeout(t); t = setTimeout(() => {
      if (win.isDestroyed()) return;
      const cur = this.floating.get(id); const b = win.getBounds();
      this.floating.update(id, { bounds: { x: b.x, y: b.y, width: b.width, height: cur.minimized ? cur.height : b.height } });
    }, 400); };
    win.on('move', persist); win.on('resize', persist);
    win.on('closed', () => { this.wins.delete(id); if (!this.quitting) { try { this.floating.update(id, { is_open: false }); } catch { /* removida */ } } });
    this.wins.set(id, win);
  }
  close(id: number): void { const w = this.wins.get(id); if (w && !w.isDestroyed()) w.close(); else this.floating.update(id, { is_open: false }); }
  apply(id: number): void {
    const w = this.wins.get(id); if (!w || w.isDestroyed()) return;
    const f = this.floating.get(id);
    w.setAlwaysOnTop(!!f.always_on_top, 'floating');
    const b = w.getBounds();
    w.setBounds({ ...b, height: f.minimized ? 40 : f.height });
  }
  restoreOpen(): void { for (const f of this.floating.openOnes()) { try { this.open(f.id); } catch (e) { log('warn', 'Falha ao reabrir nota flutuante ' + f.id, e); } } }
  closeAllForQuit(): void { this.quitting = true; for (const w of this.wins.values()) if (!w.isDestroyed()) w.destroy(); }
}

/** Captura de tela via desktopCapturer (API oficial do Electron; no Windows não requer permissão extra). */
export class CaptureManager {
  private pending: { resolve: (png: Uint8Array | null) => void; image: Electron.NativeImage; display: Electron.Display; win: BrowserWindow } | null = null;
  constructor(private mainWindow: () => BrowserWindow | null) {}

  async sources() {
    const s = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 } });
    return s.filter((x) => !x.name.startsWith('Nota flutuante')).map((x) => ({ id: x.id, name: x.name, kind: x.id.startsWith('screen') ? 'screen' as const : 'window' as const, thumbnail: x.thumbnail.toDataURL() }));
  }

  private async withHidden<T>(fn: () => Promise<T>): Promise<T> {
    const w = this.mainWindow(); const wasVisible = !!w?.isVisible();
    if (wasVisible) { w!.hide(); await new Promise((r) => setTimeout(r, 300)); }
    try { return await fn(); } finally { if (wasVisible) { w!.show(); w!.focus(); } }
  }

  private async grab(sourceId: string, size: { width: number; height: number }): Promise<Electron.NativeImage> {
    const s = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: size });
    const src = s.find((x) => x.id === sourceId);
    if (!src || src.thumbnail.isEmpty()) throw new Error('Não foi possível capturar a origem selecionada (a janela pode ter sido fechada).');
    return src.thumbnail;
  }
  private maxSize() {
    const ds = screen.getAllDisplays();
    return { width: Math.max(...ds.map((d) => Math.round(d.size.width * d.scaleFactor))), height: Math.max(...ds.map((d) => Math.round(d.size.height * d.scaleFactor))) };
  }

  /** Tela inteira ou janela. */
  take(sourceId: string): Promise<Uint8Array> {
    return this.withHidden(async () => new Uint8Array((await this.grab(sourceId, this.maxSize())).toPNG()));
  }

  /** Região: captura a tela sob o cursor e abre uma sobreposição para o usuário selecionar a área. */
  region(): Promise<Uint8Array | null> {
    if (this.pending) throw new Error('Já existe uma captura em andamento.');
    return this.withHidden(async () => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) } });
      const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
      if (!src) throw new Error('Nenhuma tela disponível para captura.');
      const win = new BrowserWindow({ ...display.bounds, frame: false, transparent: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, fullscreenable: false, show: false, backgroundColor: '#000000', webPreferences: secureWebPreferences() });
      win.setAlwaysOnTop(true, 'screen-saver');
      hardenWindow(win); loadRenderer(win, 'capture');
      win.once('ready-to-show', () => { win.show(); win.focus(); });
      return await new Promise<Uint8Array | null>((resolve) => {
        this.pending = { resolve, image: src.thumbnail, display, win };
        win.on('closed', () => { if (this.pending?.win === win) { this.pending = null; resolve(null); } });
      });
    });
  }
  regionInit() {
    if (!this.pending) throw new Error('Nenhuma captura em andamento.');
    const sz = this.pending.image.getSize();
    return { dataURL: this.pending.image.toDataURL(), width: sz.width, height: sz.height };
  }
  regionDone(rect: { x: number; y: number; width: number; height: number } | null) {
    const p = this.pending; if (!p) return;
    this.pending = null;
    let out: Uint8Array | null = null;
    if (rect && rect.width >= 2 && rect.height >= 2) {
      const sz = p.image.getSize();
      const x = Math.max(0, Math.round(rect.x)), y = Math.max(0, Math.round(rect.y));
      const crop = { x, y, width: Math.min(sz.width - x, Math.round(rect.width)), height: Math.min(sz.height - y, Math.round(rect.height)) };
      out = new Uint8Array(p.image.crop(crop).toPNG());
    }
    p.resolve(out);
    if (!p.win.isDestroyed()) p.win.destroy();
  }
}

