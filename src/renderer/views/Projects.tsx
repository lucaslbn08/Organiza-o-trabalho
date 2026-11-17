import { useState } from 'react';
import { Plus, ArrowLeft } from 'lucide-react';
import type { Settings } from '../../shared/types';
import { api, useQuery } from '../lib/api';
import { useUi } from '../lib/ui';
import { TasksView } from './Tasks';

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#64748b'];

export function ProjectsView({ go }: { go: (v: string, arg?: number) => void }) {
  const ui = useUi();
  const { data: projects = [] } = useQuery(() => api().projects.list());
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const create = async () => { if (name.trim() && await ui.run(api().projects.create({ name, color }), 'Projeto criado')) setName(''); };
  return (
    <div className="view">
      <header className="view-h"><h2>Projetos</h2></header>
      <div className="row card">
        <input placeholder="Nome do novo projeto" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <div className="swatches">{COLORS.map((c) => <button key={c} className={c === color ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}</div>
        <button className="btn primary" onClick={create} disabled={!name.trim()}><Plus size={16} /> Criar</button>
      </div>
      <div className="project-grid">
        {projects.map((p) => (
          <button key={p.id} className="card project-card" style={{ borderTopColor: p.color }} onClick={() => go('project', p.id)}
            onContextMenu={(e) => ui.menu(e, [
              { label: 'Renomear', onClick: () => { const n = prompt('Novo nome', p.name); if (n?.trim()) ui.run(api().projects.update(p.id, { name: n })); } },
              ...COLORS.map((c) => ({ label: `Cor ${c}`, onClick: () => ui.run(api().projects.update(p.id, { color: c })) })).slice(0, 4),
              { label: 'Enviar para a lixeira', danger: true, onClick: () => ui.run(api().projects.remove(p.id), 'Projeto enviado para a lixeira') },
            ])}>
            <strong>{p.name}</strong>{p.description && <small>{p.description}</small>}
          </button>
        ))}
        {projects.length === 0 && <p className="muted">Nenhum projeto. Crie o primeiro acima.</p>}
      </div>
    </div>
  );
}

export function ProjectDetailView({ id, settings, go, onOpen, onQuickAdd }: { id: number; settings: Settings; go: (v: string) => void; onOpen: (id: number) => void; onQuickAdd: () => void }) {
  const ui = useUi();
  const { data: projects = [] } = useQuery(() => api().projects.list());
  const p = projects.find((x) => x.id === id);
  if (!p) return <div className="view"><button className="btn" onClick={() => go('projects')}><ArrowLeft size={16} /> Projetos</button></div>;
  return (
    <div>
      <div className="view project-head" style={{ borderLeftColor: p.color }}>
        <button className="btn ghost" onClick={() => go('projects')}><ArrowLeft size={16} /> Projetos</button>
        <h2>{p.name}</h2>
        <textarea rows={2} defaultValue={p.description} placeholder="Descrição do projeto" onBlur={(e) => e.target.value !== p.description && ui.run(api().projects.update(p.id, { description: e.target.value }))} />
        <small className="muted">Notas, desenhos, quadros e arquivos do projeto serão reunidos aqui nas próximas etapas.</small>
      </div>
      <TasksView settings={settings} projectId={p.id} onOpen={onOpen} onQuickAdd={async () => { const t = await ui.run(api().tasks.create({ title: 'Nova tarefa', project_id: p.id })); if (t) onOpen(t.id); }} />
    </div>
  );
}
