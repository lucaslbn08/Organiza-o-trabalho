import { useEffect, useState } from 'react';
import { Crop, Monitor, AppWindow, X, Copy } from 'lucide-react';
import type { CaptureSource, CaptureTarget } from '../../shared/types';
import { api, useQuery } from '../lib/api';
import { useUi } from '../lib/ui';

/** Captura (região, janela ou tela inteira) e envio para nota, tarefa, desenho, quadro ou área de transferência. */
export function CaptureDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const ui = useUi();
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [png, setPng] = useState<Uint8Array | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [dest, setDest] = useState<string>('new-note');
  const [busy, setBusy] = useState(false);
  const { data: notes = [] } = useQuery(() => api().notes.list({}));
  const { data: tasks = [] } = useQuery(() => api().tasks.list({ showCompleted: false, sort: 'title' }));
  const { data: drawings = [] } = useQuery(() => api().canvases.list('drawing'));
  const { data: boards = [] } = useQuery(() => api().canvases.list('board'));
  useEffect(() => { if (!png) return; const u = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })); setUrl(u); return () => URL.revokeObjectURL(u); }, [png]);

  const grab = async (p: Promise<Uint8Array | null>) => { setBusy(true); const r = await ui.run(p); setBusy(false); if (r) setPng(r); };
  const send = async () => {
    if (!png) return;
    const [type, id] = dest.split(':');
    const t = (id ? { type, id: Number(id) } : { type }) as CaptureTarget;
    setBusy(true); const msg = await ui.run(api().capture.send(png, t)); setBusy(false);
    if (msg) { onDone(msg); onClose(); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal capture-modal">
        <div className="row"><h3 className="grow">Capturar tela</h3><button className="icon" onClick={onClose}><X size={16} /></button></div>
        {!png && <>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => grab(api().capture.region())}><Crop size={16} /> Selecionar região</button>
            <button className="btn" disabled={busy} onClick={() => ui.run(api().capture.sources()).then((s) => s && setSources(s))}><Monitor size={16} /> Tela inteira ou janela…</button>
          </div>
          <small className="muted">Na seleção de região, arraste para marcar a área; Esc cancela. A janela do Workspace é ocultada durante a captura.</small>
          {sources && <div className="source-grid">{sources.map((s) => (
            <button key={s.id} className="card source" disabled={busy} onClick={() => grab(api().capture.take(s.id))}>
              <img src={s.thumbnail} alt="" /><span className="row">{s.kind === 'screen' ? <Monitor size={12} /> : <AppWindow size={12} />}<span className="ellipsis">{s.name}</span></span>
            </button>))}</div>}
        </>}
        {png && url && <>
          <img className="capture-preview" src={url} alt="Captura" />
          <div className="row">
            <label className="grow">Enviar para
              <select value={dest} onChange={(e) => setDest(e.target.value)}>
                <option value="new-note">Nova anotação</option>
                <option value="clipboard">Área de transferência</option>
                <optgroup label="Anotação existente">{notes.map((n) => <option key={n.id} value={`note:${n.id}`}>{n.title || 'Sem título'}</option>)}</optgroup>
                <optgroup label="Anexar à tarefa">{tasks.map((t) => <option key={t.id} value={`task:${t.id}`}>{t.title}</option>)}</optgroup>
                <optgroup label="Desenho">{drawings.map((c) => <option key={c.id} value={`drawing:${c.id}`}>{c.title || 'Sem título'}</option>)}</optgroup>
                <optgroup label="Quadro infinito">{boards.map((c) => <option key={c.id} value={`board:${c.id}`}>{c.title || 'Sem título'}</option>)}</optgroup>
              </select></label>
          </div>
          <div className="row end">
            <button className="btn" onClick={() => { setPng(null); setSources(null); }}>Capturar novamente</button>
            <button className="btn" disabled={busy} onClick={() => ui.run(api().capture.send(png, { type: 'clipboard' })).then((m) => m && ui.toast(m))}><Copy size={14} /> Copiar</button>
            <button className="btn primary" disabled={busy} onClick={send}>Enviar</button>
          </div>
        </>}
      </div>
    </div>
  );
}
