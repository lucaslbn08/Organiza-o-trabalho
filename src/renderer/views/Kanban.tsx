import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { TaskStatus } from '../../shared/types';
import { TASK_STATUSES, STATUS_LABEL } from '../../shared/types';
import { api, useQuery } from '../lib/api';
import { useUi } from '../lib/ui';
import { DndGroups } from '../components/DndGroups';
import { PriorityDot, TaskMeta } from '../components/TaskBits';

export function KanbanView({ onOpen }: { onOpen: (id: number) => void }) {
  const ui = useUi();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [editing, setEditing] = useState(false);
  const { data: cols = [] } = useQuery(() => api().kanban.columns());
  const { data: projects = [] } = useQuery(() => api().projects.list());
  const { data: tasks = [] } = useQuery(() => api().tasks.list({ project_id: projectId, sort: 'manual' }), [projectId]);
  const visible = cols.filter((c) => c.visible);
  const hiddenStatuses = TASK_STATUSES.filter((s) => !visible.some((c) => c.status === s));

  return (
    <div className="view wide">
      <header className="view-h">
        <h2>Quadro Kanban</h2><span className="grow" />
        <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : undefined)} aria-label="Filtrar por projeto">
          <option value="">Todos os projetos</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn" onClick={() => setEditing(!editing)}><Settings2 size={16} /> Colunas</button>
      </header>
      {editing && (
        <div className="card col-editor">
          {cols.map((c) => (
            <div key={c.id} className="row">
              <input type="checkbox" checked={!!c.visible} onChange={(e) => ui.run(api().kanban.updateColumn(c.id, { visible: e.target.checked }))} title="Visível" />
              <input type="color" value={c.color} onChange={(e) => ui.run(api().kanban.updateColumn(c.id, { color: e.target.value }))} />
              <input defaultValue={c.title} onBlur={(e) => e.target.value !== c.title && ui.run(api().kanban.updateColumn(c.id, { title: e.target.value }))} />
              <small className="muted">status: {STATUS_LABEL[c.status]}</small>
            </div>
          ))}
          {hiddenStatuses.length > 0 && <small className="muted">Tarefas com status sem coluna visível ({hiddenStatuses.map((s) => STATUS_LABEL[s]).join(', ')}) não aparecem no quadro, mas continuam na lista.</small>}
        </div>
      )}
      <DndGroups layout="columns"
        groups={visible.map((c) => ({
          key: c.status,
          header: <h3 className="kcol-h"><span className="dot" style={{ background: c.color }} />{c.title}<small>{tasks.filter((t) => t.status === c.status).length}</small></h3>,
          items: tasks.filter((t) => t.status === c.status),
        }))}
        renderItem={(t) => (
          <div className="kcard" onClick={() => onOpen(t.id)} onContextMenu={(e) => ui.menu(e, [
            { label: 'Abrir', onClick: () => onOpen(t.id) },
            { label: 'Duplicar', onClick: () => ui.run(api().tasks.duplicate(t.id)) },
            { label: 'Enviar para a lixeira', danger: true, onClick: () => ui.run(api().tasks.remove(t.id)) },
          ])}>
            <div className="row"><PriorityDot p={t.priority} /><span className="task-title">{t.title}</span></div>
            <TaskMeta t={t} />
          </div>
        )}
        onMove={(status, ids) => ui.run(api().tasks.reorder(ids, status as TaskStatus))} />
    </div>
  );
}
