import { RotateCcw, Trash2 } from 'lucide-react';
import { api, useQuery, fmtDateTime } from '../lib/api';
import { useUi } from '../lib/ui';

export function TrashView() {
  const ui = useUi();
  const { data: items = [] } = useQuery(() => api().trash.list());
  return (
    <div className="view">
      <header className="view-h"><h2>Lixeira</h2><span className="grow" />
        <button className="btn danger" disabled={!items.length} onClick={async () => { if (await ui.confirm(`Excluir permanentemente ${items.length} item(ns)? Esta ação não pode ser desfeita.`, true)) ui.run(api().trash.empty(), 'Lixeira esvaziada'); }}>Esvaziar lixeira</button>
      </header>
      {items.length === 0 ? <div className="empty">A lixeira está vazia.</div> : (
        <table className="table"><thead><tr><th>Tipo</th><th>Item</th><th>Excluído em</th><th /></tr></thead><tbody>
          {items.map((i) => (
            <tr key={i.entity_type + i.id}>
              <td>{({ task: 'Tarefa', project: 'Projeto', note: 'Anotação', canvas: 'Desenho/quadro', attachment: 'Arquivo' } as const)[i.entity_type]}</td><td>{i.title}</td><td>{fmtDateTime(i.deleted_at)}</td>
              <td className="row end">
                <button className="btn" onClick={() => ui.run(api().trash.restore(i.entity_type, i.id), 'Restaurado')}><RotateCcw size={14} /> Restaurar</button>
                <button className="btn danger" onClick={async () => { if (await ui.confirm(`Excluir "${i.title}" permanentemente?`, true)) ui.run(api().trash.purge(i.entity_type, i.id)); }}><Trash2 size={14} /></button>
              </td>
            </tr>))}
        </tbody></table>
      )}
    </div>
  );
}

const ENTITY: Record<string, string> = { task: 'Tarefa', project: 'Projeto', workspace: 'Espaço', trash: 'Lixeira', note: 'Anotação', folder: 'Pasta', drawing: 'Desenho', board: 'Quadro', attachment: 'Arquivo' };
export function HistoryView({ onOpen, openNote, openCanvas }: { onOpen: (id: number) => void; openNote: (id: number) => void; openCanvas: (k: 'drawing' | 'board', id: number) => void }) {
  const { data: h = [] } = useQuery(() => api().history.list(300));
  return (
    <div className="view">
      <header className="view-h"><h2>Histórico de alterações</h2></header>
      <table className="table"><tbody>
        {h.map((e) => (
          <tr key={e.id} className={['task', 'note', 'drawing', 'board'].includes(e.entity_type) ? 'clickable' : ''} onClick={() => { if (e.entity_type === 'task') onOpen(e.entity_id); else if (e.entity_type === 'note') openNote(e.entity_id); else if (e.entity_type === 'drawing' || e.entity_type === 'board') openCanvas(e.entity_type, e.entity_id); }}>
            <td className="muted nowrap">{fmtDateTime(e.created_at)}</td><td>{ENTITY[e.entity_type] ?? e.entity_type} #{e.entity_id}</td><td>{e.action}</td><td className="muted">{e.details}</td>
          </tr>))}
      </tbody></table>
    </div>
  );
}

export function UpcomingView({ title, stage, items }: { title: string; stage: number; items: string[] }) {
  return (
    <div className="view">
      <header className="view-h"><h2>{title}</h2></header>
      <div className="card upcoming">
        <p><strong>Ainda não implementado.</strong> Este módulo faz parte da Etapa {stage} do plano de desenvolvimento.</p>
        <p className="muted">Escopo previsto:</p>
        <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
      </div>
    </div>
  );
}
