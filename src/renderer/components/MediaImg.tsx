import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Exibe uma imagem guardada no banco (ws-media://hash) via IPC, sem depender do protocolo. */
export function MediaImg({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src?.startsWith('ws-media://')) return;
    let obj: string | null = null; let alive = true;
    api().media.get(src.slice('ws-media://'.length)).then((m) => {
      if (!m || !alive) return;
      obj = URL.createObjectURL(new Blob([m.bytes as BlobPart], { type: m.mime })); setUrl(obj);
    }).catch(() => undefined);
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [src]);
  return url ? <img src={url} alt={alt} className={className} draggable={false} /> : <div className={`${className ?? ''} thumb-empty`} />;
}
