import { useState } from 'react';
import { Plus, Search, PenTool, Infinity as InfIcon } from 'lucide-react';
import type { CanvasKind, Settings } from '../../shared/types';
import { api, useQuery, fmtDateTime } from '../lib/api';
import { useUi } from '../lib/ui';
import { MediaImg } from '../components/MediaImg';
import { CanvasEditor } from '../components/CanvasEditor';

const LABEL: Record<CanvasKind, { title: string; one: string; empty: string }> = {
  drawing: { title: 'Desenhos e esboços', one: 'Novo desenho', empty: 'Nenhum desenho ainda.' },
  board: { title: 'Quadros infinitos', one: 'Novo quadro', empty: 'Nenhum quadro ainda.' },
};

export function CanvasesView({ kind, settings, openId, setOpen, onOpenTask, onOpenNote, onOpenBoard }: {
  kind: CanvasKind; settings: Settings; openId: number | null; setOpen: (id: number | null) => void;
  onOpenTask: (id: number) => void; onOpenNote: (id: number) => void; onOpenBoard: (id: number) => void;
}) {
  const ui = useUi();
  const [search, setSearch] = useState('');
  const { data: items = [] } = useQuery(() => api().canvases.list(kind, { search: search || undefined }), [kind, search]);
  const L = LABEL[kind];
  const create = async () => { const c = await ui.run(api().canvases.create({ kind })); if (c) setOpen(c.id); };

  if (openId) return <CanvasEditor id={openId} settings={settings} onClose={() => setOpen(null)} onOpenTask={onOpenTask} onOpenNote={onOpenNote} onOpenBoard={onOpenBoard} />;
  return (
    <div className="view">
      <header className="view-h"><h2>{L.title}</h2><span className="grow" />
        <button className="btn primary" onClick={create}><Plus size={16} /> {L.one}</button></header>
      <div className="toolbar"><div className="search"><Search size={14} /><input placeholder="Pesquisar por título ou texto…" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
      {items.length === 0 ? <div className="empty">{search ? 'Nada encontrado.' : L.empty} <button className="link" onClick={create}>{L.one}</button></div> : (
        <div className="canvas-grid">
          {items.map((c) => (
            <button key={c.id} className="card canvas-card" onClick={() => setOpen(c.id)} onContextMenu={(e) => ui.menu(e, [
              { label: 'Abrir', onClick: () => setOpen(c.id) },
              { label: 'Renomear', onClick: () => { const n = prompt('Novo título', c.title); if (n !== null) ui.run(api().canvases.update(c.id, { title: n })); } },
              { label: 'Duplicar', onClick: () => ui.run(api().canvases.duplicate(c.id), 'Duplicado') },
              { label: 'Enviar para a lixeira', danger: true, onClick: () => ui.run(api().canvases.remove(c.id), 'Enviado para a lixeira') },
            ])}>
              <div className="thumb">{c.thumbnail ? <MediaImg src={c.thumbnail} alt="" /> : kind === 'drawing' ? <PenTool size={28} /> : <InfIcon size={28} />}</div>
              <strong className="ellipsis">{c.title || 'Sem título'}</strong>
              <small className="muted">Editado {fmtDateTime(c.updated_at)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
