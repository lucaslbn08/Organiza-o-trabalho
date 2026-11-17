import { Plus, X, Pin, ExternalLink, Trash2 } from 'lucide-react';
import { api, useQuery } from '../lib/api';
import { useUi } from '../lib/ui';

export function FloatingNotesPanel({ onClose }: { onClose: () => void }) {
  const ui = useUi();
  const { data: notes = [] } = useQuery(() => api().floating.list());
  return (
    <div className="popover" onMouseDown={(e) => e.stopPropagation()}>
      <div className="row"><strong>Notas flutuantes</strong><span className="grow" />
        <button className="btn primary" onClick={() => ui.run(api().floating.create({}))}><Plus size={14} /> Nova</button>
        <button className="icon" onClick={onClose}><X size={14} /></button></div>
      <small className="muted">Janelas pequenas que ficam sobre outros programas do Windows. Reabrem automaticamente.</small>
      {notes.length === 0 && <p className="muted">Nenhuma nota flutuante.</p>}
      <ul className="mini-list">
        {notes.map((n) => (
          <li key={n.id}>
            <span className="dot" style={{ background: n.color, border: '1px solid var(--border)' }} />
            <span className="task-title">{n.content.split('\n')[0] || 'Nota vazia'}</span>
            {n.always_on_top ? <Pin size={12} className="accent" /> : null}
            <small className="muted">{n.is_open ? 'aberta' : 'fechada'}</small>
            <button className="icon ghost" title={n.is_open ? 'Trazer para a frente' : 'Abrir'} onClick={() => ui.run(api().floating.open(n.id))}><ExternalLink size={12} /></button>
            <button className="icon ghost" title="Excluir" onClick={async () => { if (await ui.confirm('Excluir esta nota flutuante?', true)) ui.run(api().floating.remove(n.id)); }}><Trash2 size={12} /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
