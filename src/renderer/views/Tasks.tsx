import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { Task, TaskStatus, TaskPriority, TaskSort, Settings } from '../../shared/types';
import { STATUS_LABEL, PRIORITY_LABEL, TASK_STATUSES, TASK_PRIORITIES } from '../../shared/types';
import { api, useQuery } from '../lib/api';
import { useUi } from '../lib/ui';
import { StatusSelect, PriorityDot, TaskMeta } from '../components/TaskBits';
import { DndGroups } from '../components/DndGroups';

export function TaskRow({ t, onOpen }: { t: Task; onOpen: (id: number) => void }) {
  const ui = useUi();
  return (
    <div className={`task-row st-${t.status}`} onClick={() => onOpen(t.id)} onContextMenu={(e) => ui.menu(e, [
      { label: 'Abrir', onClick: () => onOpen(t.id) },
      ...TASK_STATUSES.filter((s) => s !== t.status).map((s) => ({ label: `Marcar: ${STATUS_LABEL[s]}`, onClick: () => ui.run(api().tasks.update(t.id, { status: s })) })),
      { label: 'Duplicar', onClick: () => ui.run(api().tasks.duplicate(t.id), 'Tarefa duplicada') },
      { label: 'Enviar para a lixeira', danger: true, onClick: () => ui.run(api().tasks.remove(t.id), 'Enviada para a lixeira') },
    ])}>
      <input type="checkbox" checked={t.status === 'done'} title="Concluir" onClick={(e) => e.stopPropagation()}
        onChange={(e) => ui.run(api().tasks.update(t.id, { status: e.target.checked ? 'done' : 'pending' }))} />
      <PriorityDot p={t.priority} />
      <span className="task-title">{t.title}</span>
      <TaskMeta t={t} />
      <StatusSelect value={t.status} onChange={(status) => ui.run(api().tasks.update(t.id, { status }))} />
    </div>
  );
}

export function TasksView({ settings, onOpen, onQuickAdd, projectId }: { settings: Settings; onOpen: (id: number) => void; onQuickAdd: () => void; projectId?: number }) {
  const ui = useUi();
  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState<TaskStatus[]>([]);
  const [priorities, setPriorities] = useState<TaskPriority[]>([]);
  const [sort, setSort] = useState<TaskSort>('manual');
  const [grouped, setGrouped] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [limit, setLimit] = useState(200);
  const showCompleted = settings.showCompleted;
  const q = { search, statuses, priorities, sort, showCompleted, project_id: projectId };
  const { data: tasks = [] } = useQuery(() => api().tasks.list(q), [JSON.stringify(q)]);
  const { data: categories = [] } = useQuery(() => api().categories.list());
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const canDrag = sort === 'manual';

  const groups = grouped
    ? [{ key: 'c0', id: null as number | null, name: 'Sem categoria', color: '#64748b' }, ...categories.map((c) => ({ key: `c${c.id}`, id: c.id as number | null, name: c.name, color: c.color }))]
        .map((c) => ({
          key: c.key,
          header: <h3 className="group-h" onContextMenu={(e) => c.id && ui.menu(e, [{ label: 'Excluir categoria', danger: true, onClick: async () => { if (await ui.confirm(`Excluir a categoria "${c.name}"? As tarefas ficarão sem categoria.`, true)) ui.run(api().categories.remove(c.id!)); } }])}>
            <span className="dot" style={{ background: c.color }} />{c.name} <small>{tasks.filter((t) => t.category_id === c.id).length}</small></h3>,
          items: tasks.filter((t) => t.category_id === c.id),
        }))
    : [{ key: 'all', header: null, items: tasks.slice(0, limit) }];

  return (
    <div className="view">
      <header className="view-h">
        <h2>{projectId ? 'Tarefas do projeto' : 'Minhas tarefas'}</h2>
        <span className="grow" />
        <button className="btn primary" onClick={onQuickAdd}><Plus size={16} /> Nova tarefa <kbd>Ctrl+N</kbd></button>
      </header>
      <div className="toolbar">
        <div className="search"><Search size={14} /><input placeholder="Pesquisar título, descrição, etiqueta…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select value={sort} onChange={(e) => setSort(e.target.value as TaskSort)} aria-label="Ordenar">
          <option value="manual">Ordem manual</option><option value="title">Nome</option><option value="created">Data de criação</option>
          <option value="due">Prazo</option><option value="priority">Prioridade</option>
        </select>
        <label className="check"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Agrupar por categoria</label>
        <label className="check"><input type="checkbox" checked={showCompleted} onChange={(e) => ui.run(api().settings.set({ showCompleted: e.target.checked }))} /> Exibir concluídas</label>
      </div>
      <div className="chips">
        {TASK_STATUSES.map((s) => <button key={s} className={statuses.includes(s) ? 'chip on' : 'chip'} onClick={() => setStatuses(toggle(statuses, s))}>{STATUS_LABEL[s]}</button>)}
        <span className="sep" />
        {TASK_PRIORITIES.map((p) => <button key={p} className={priorities.includes(p) ? 'chip on' : 'chip'} onClick={() => setPriorities(toggle(priorities, p))}><PriorityDot p={p} /> {PRIORITY_LABEL[p]}</button>)}
      </div>
      {!canDrag && <small className="muted">Arrastar para reordenar fica disponível em “Ordem manual”.</small>}
      {tasks.length === 0 ? <div className="empty">Nenhuma tarefa encontrada. <button className="link" onClick={onQuickAdd}>Criar uma tarefa</button></div> : (
        <DndGroups groups={groups} layout="stack" disabled={!canDrag} renderItem={(t) => <TaskRow t={t} onOpen={onOpen} />}
          onMove={(key, ids) => {
            if (key === 'all') return ui.run(api().tasks.reorder(ids));
            const catId = key === 'c0' ? null : Number(key.slice(1));
            ui.run(api().tasks.reorder(ids, undefined, catId));
          }} />
      )}
      {!grouped && tasks.length > limit && <button className="btn more-btn" onClick={() => setLimit(limit + 200)}>Mostrar mais ({tasks.length - limit} restantes)</button>}
      {grouped && (
        <div className="row" style={{ marginTop: 12 }}>
          <input placeholder="Nova categoria" value={newCat} onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newCat.trim()) { ui.run(api().categories.create(newCat)); setNewCat(''); } }} />
        </div>
      )}
    </div>
  );
}
