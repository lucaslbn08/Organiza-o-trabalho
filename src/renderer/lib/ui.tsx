import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

interface Toast { id: number; text: string; kind: 'ok' | 'error' }
interface Confirm { text: string; danger?: boolean; resolve: (v: boolean) => void }
interface Menu { x: number; y: number; items: { label: string; onClick: () => void; danger?: boolean }[] }
interface UiCtx {
  toast(text: string, kind?: Toast['kind']): void;
  confirm(text: string, danger?: boolean): Promise<boolean>;
  menu(e: React.MouseEvent, items: Menu['items']): void;
  run<T>(p: Promise<T>, ok?: string): Promise<T | undefined>;
}
const Ctx = createContext<UiCtx>(null!);
export const useUi = () => useContext(Ctx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const ctx: UiCtx = {
    toast,
    confirm: (text, danger) => new Promise((resolve) => setConfirm({ text, danger, resolve })),
    menu: (e, items) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, items }); },
    run: async (p, ok) => {
      try { const r = await p; if (ok) toast(ok); return r; }
      catch (e) { toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error'); return undefined; }
    },
  };
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('click', close); window.addEventListener('blur', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close); };
  }, []);
  const done = (v: boolean) => { confirm?.resolve(v); setConfirm(null); };
  return (
    <Ctx.Provider value={ctx}>
      {children}
      {menu && (
        <div className="ctx-menu" style={{ left: Math.min(menu.x, innerWidth - 200), top: Math.min(menu.y, innerHeight - menu.items.length * 34 - 10) }}>
          {menu.items.map((it) => <button key={it.label} className={it.danger ? 'danger' : ''} onClick={() => { setMenu(null); it.onClick(); }}>{it.label}</button>)}
        </div>
      )}
      {confirm && (
        <div className="modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && done(false)}>
          <div className="modal small" role="alertdialog">
            <p>{confirm.text}</p>
            <div className="row end">
              <button className="btn" onClick={() => done(false)} autoFocus>Cancelar</button>
              <button className={confirm.danger ? 'btn danger' : 'btn primary'} onClick={() => done(true)}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
    </Ctx.Provider>
  );
}
