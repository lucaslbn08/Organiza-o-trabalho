import { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, FolderOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, useQuery } from '../lib/api';
import { useUi } from '../lib/ui';
import { loadPdf } from '../lib/pdf';

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export { fmtSize };

/** Visualizador interno: imagens, PDFs (pdf.js) e texto. Outros formatos abrem no aplicativo padrão do Windows. */
export function FilePreview({ id, onClose }: { id: number; onClose: () => void }) {
  const ui = useUi();
  const { data: a, error } = useQuery(() => api().files.get(id), [id]);
  const [content, setContent] = useState<{ kind: 'img' | 'text' | 'pdf' | 'none'; url?: string; text?: string; bytes?: Uint8Array; err?: string }>({ kind: 'none' });
  useEffect(() => {
    if (!a) return;
    let url: string | null = null;
    const kind = a.mime.startsWith('image/') ? 'img' : a.mime === 'application/pdf' ? 'pdf' : a.mime.startsWith('text/') || a.mime === 'application/json' ? 'text' : 'none';
    if (kind === 'none' || a.missing) { setContent({ kind: 'none' }); return; }
    api().files.read(a.id).then((r) => {
      if (kind === 'img') { url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime })); setContent({ kind, url }); }
      else if (kind === 'text') setContent({ kind, text: new TextDecoder().decode(r.bytes.slice(0, 2_000_000)) });
      else setContent({ kind, bytes: r.bytes });
    }).catch((e: Error) => setContent({ kind: 'none', err: e.message }));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [a]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal preview-modal">
        <div className="row"><strong className="grow ellipsis">{a?.name ?? 'Arquivo'}</strong>
          {a && <small className="muted">{a.mode === 'internal' ? 'Biblioteca interna' : 'Vínculo externo'} · {fmtSize(a.size)}</small>}
          <button className="btn" disabled={!a || a.missing} onClick={() => ui.run(api().files.open(id))}><ExternalLink size={14} /> Abrir no Windows</button>
          <button className="btn" disabled={!a || a.missing} onClick={() => ui.run(api().files.reveal(id))}><FolderOpen size={14} /> Mostrar na pasta</button>
          <button className="icon" onClick={onClose}><X size={16} /></button></div>
        <div className="preview-body">
          {error && <p className="danger-text">{error}</p>}
          {a?.missing && <div className="empty">Arquivo ausente: <code>{a.absolute_path}</code><br />Use “Localizar arquivo” na biblioteca para reapontar o vínculo.</div>}
          {content.err && <p className="danger-text">{content.err}</p>}
          {content.kind === 'img' && <img src={content.url} alt={a?.name} />}
          {content.kind === 'text' && <pre className="text-preview">{content.text}</pre>}
          {content.kind === 'pdf' && content.bytes && <PdfViewer bytes={content.bytes} />}
          {content.kind === 'none' && a && !a.missing && !content.err && <div className="empty">Pré-visualização indisponível para este formato. Use “Abrir no Windows”.</div>}
        </div>
      </div>
    </div>
  );
}

function PdfViewer({ bytes }: { bytes: Uint8Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<Awaited<ReturnType<typeof loadPdf>> | null>(null);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState('');
  useEffect(() => { let d: typeof doc = null; loadPdf(bytes).then((x) => { d = x; setDoc(x); }).catch((e: Error) => setErr('PDF inválido ou protegido: ' + e.message)); return () => { void d?.loadingTask.destroy(); }; }, [bytes]);
  useEffect(() => {
    if (!doc || !ref.current) return;
    let task: { cancel(): void } | null = null;
    doc.getPage(page).then((p) => {
      const vp = p.getViewport({ scale: Math.min(2, 1000 / p.getViewport({ scale: 1 }).width) });
      const c = ref.current!; c.width = vp.width; c.height = vp.height;
      const t = p.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp }); task = t; return t.promise;
    }).catch(() => undefined);
    return () => task?.cancel();
  }, [doc, page]);
  if (err) return <p className="danger-text">{err}</p>;
  return (
    <div className="pdf-viewer">
      <div className="row"><button className="icon" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button>
        <span>Página {page} de {doc?.numPages ?? '…'}</span>
        <button className="icon" disabled={!doc || page >= doc.numPages} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button></div>
      <canvas ref={ref} />
    </div>
  );
}
