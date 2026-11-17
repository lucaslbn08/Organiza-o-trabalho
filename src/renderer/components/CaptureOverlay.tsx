import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/** Sobreposição em tela cheia para selecionar a região da captura. */
export function CaptureOverlay() {
  const [img, setImg] = useState<{ dataURL: string; width: number; height: number } | null>(null);
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragging = useRef(false);
  useEffect(() => {
    document.body.classList.add('capture-body');
    api().capture.regionInit().then(setImg).catch(() => void api().capture.regionDone(null));
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') void api().capture.regionDone(null); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);
  if (!img) return null;
  const sx = img.width / innerWidth, sy = img.height / innerHeight;
  const r = rect && { x: Math.min(rect.x0, rect.x1), y: Math.min(rect.y0, rect.y1), w: Math.abs(rect.x1 - rect.x0), h: Math.abs(rect.y1 - rect.y0) };
  return (
    <div className="capture-overlay" style={{ backgroundImage: `url(${img.dataURL})` }}
      onMouseDown={(e) => { dragging.current = true; setRect({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY }); }}
      onMouseMove={(e) => dragging.current && setRect((p) => p && { ...p, x1: e.clientX, y1: e.clientY })}
      onMouseUp={() => {
        dragging.current = false;
        if (r && r.w > 3 && r.h > 3) void api().capture.regionDone({ x: r.x * sx, y: r.y * sy, width: r.w * sx, height: r.h * sy });
        else setRect(null);
      }}>
      <div className="capture-dim" style={r ? { clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${r.x}px ${r.y}px, ${r.x}px ${r.y + r.h}px, ${r.x + r.w}px ${r.y + r.h}px, ${r.x + r.w}px ${r.y}px, ${r.x}px ${r.y}px)` } : undefined} />
      {r && <div className="capture-rect" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}><span>{Math.round(r.w * sx)} × {Math.round(r.h * sy)}</span></div>}
      {!r && <div className="capture-hint">Arraste para selecionar a área · Esc para cancelar</div>}
    </div>
  );
}
