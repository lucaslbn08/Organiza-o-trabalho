import { useState, type ReactElement } from 'react';
import { Eye, EyeOff, GripVertical, Plus } from 'lucide-react';
import type { Settings, Task } from '../../shared/types';
import { api, useQuery } from '../lib/api';
import { useUi } from '../lib/ui';
import { PriorityDot, TaskMeta } from '../components/TaskBits';
import { fmtDateTime } from '../lib/api';

const PANEL_TITLES: Record<string, string> = {
  stats: 'Resumo das tarefas', priority: 'Prioritárias', dueSoon: 'Prazos próximos e atrasadas', projects: 'Projetos recentes', notes: 'Anotações recentes', shortcuts: 'Atalhos',
};

export function HomeView({ settings, onOpen, onQuickAdd, go, openNote, newNote }: { settings: Settings; onOpen: (id: number) => void; onQuickAdd: () => void; go: (v: string, arg?: number) => void; openNote: (id: number) => void; newNote: () => void }) {
  const ui = useUi();
  const { data: s } = useQuery(() => api().dashboard.stats());
  const [customize, setCustomize] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const panels = settings.dashboardPanels;
  const save = (p: Settings['dashboardPanels']) => ui.run(api().settings.set({ dashboardPanels: p }));
  if (!s) return <div className="view" />;

  const list = (ts: Task[], empty: string) => ts.length ? <ul className="mini-list">{ts.map((t) => (
    <li key={t.id} onClick={() => onOpen(t.id)}><PriorityDot p={t.priority} /><span className="task-title">{t.title}</span><TaskMeta t={t} /></li>))}</ul> : <p className="muted">{empty}</p>;

  const content: Record<string, ReactElement> = {
    stats: (
      <div className="stats">
        {[['Total', s.total, 'tasks'], ['Pendentes', s.pending], ['Em andamento', s.in_progress], ['Pausadas', s.paused], ['Concluídas', s.done], ['Prioritárias', s.priority.length]].map(([l, n]) => (
          <button key={l as string} className="stat" onClick={() => go('tasks')}><strong>{n}</strong><span>{l}</span></button>
        ))}
      </div>
    ),
    priority: list(s.priority, 'Nenhuma tarefa urgente ou de alta prioridade em aberto.'),
    dueSoon: <>{s.overdue.length > 0 && <><h5 className="danger-text">Atrasadas</h5>{list(s.overdue, '')}</>}<h5>Próximos 7 dias</h5>{list(s.dueSoon, 'Nenhum prazo nos próximos 7 dias.')}</>,
    projects: s.recentProjects.length ? <ul className="mini-list">{s.recentProjects.map((p) => <li key={p.id} onClick={() => go('project', p.id)}><span className="dot" style={{ background: p.color }} />{p.name}</li>)}</ul> : <p className="muted">Nenhum projeto ainda. <button className="link" onClick={() => go('projects')}>Criar projeto</button></p>,
    notes: s.recentNotes.length ? <ul className="mini-list">{s.recentNotes.map((n) => <li key={n.id} onClick={() => openNote(n.id)}><span className="task-title">{n.title || 'Sem título'}</span><small className="muted">{fmtDateTime(n.updated_at)}</small></li>)}</ul> : <p className="muted">Nenhuma anotação ainda. <button className="link" onClick={newNote}>Criar anotação</button></p>,
    shortcuts: (
      <ul className="shortcuts">
        <li><kbd>Ctrl+K</kbd> Pesquisa e comandos</li><li><kbd>Ctrl+N</kbd> Nova tarefa</li><li><kbd>Ctrl+Shift+N</kbd> Nova anotação</li>
        <li><kbd>Ctrl+B</kbd> Recolher barra lateral</li><li><kbd>Ctrl+1…4</kbd> Início, Tarefas, Kanban, Projetos</li>
      </ul>
    ),
  };

  return (
    <div className="view">
      <header className="view-h">
        <h2>Início</h2><span className="grow" />
        <button className="btn" onClick={() => setCustomize(!customize)}>{customize ? 'Concluir' : 'Personalizar'}</button>
        <button className="btn" onClick={newNote}><Plus size={16} /> Anotação</button>
        <button className="btn primary" onClick={onQuickAdd}><Plus size={16} /> Tarefa</button>
      </header>
      {customize && <p className="muted">Arraste os painéis pela alça para reorganizar; use o olho para ocultar/exibir.</p>}
      <div className="dash">
        {panels.filter((p) => customize || p.visible).filter((p) => content[p.id]).map((p) => (
          <section key={p.id} className={`card panel panel-${p.id} ${!p.visible ? 'hidden-panel' : ''}`}
            draggable={customize} onDragStart={() => setDragId(p.id)} onDragOver={(e) => customize && e.preventDefault()}
            onDrop={() => { if (!dragId || dragId === p.id) return; const arr = panels.filter((x) => x.id !== dragId); arr.splice(arr.findIndex((x) => x.id === p.id), 0, panels.find((x) => x.id === dragId)!); save(arr); setDragId(null); }}>
            <h4 className="row">{customize && <GripVertical size={14} className="grip" />}{PANEL_TITLES[p.id]}<span className="grow" />
              {customize && <button className="icon ghost" title={p.visible ? 'Ocultar' : 'Exibir'} onClick={() => save(panels.map((x) => x.id === p.id ? { ...x, visible: !x.visible } : x))}>{p.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>}
            </h4>
            {content[p.id]}
          </section>
        ))}
      </div>
    </div>
  );
}
