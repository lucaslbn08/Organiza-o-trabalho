import { useEffect, useMemo, useState } from 'react';
import type { Task, Project } from '../../shared/types';
import { STATUS_LABEL } from '../../shared/types';
import { api } from '../lib/api';

export interface Command { id: string; label: string; hint?: string; run: () => void }
type Result = { kind: 'cmd'; c: Command } | { kind: 'task'; t: Task } | { kind: 'project'; p: Project };

export function CommandPalette({ commands, onClose, openTask, openProject }: {
  commands: Command[]; onClose: () => void; openTask: (id: number) => void; openProject: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'task' | 'project' | 'cmd'>('all');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    let alive = true;
    const h = setTimeout(async () => {
      const [t, p] = await Promise.all([q.trim() ? api().tasks.list({ search: q, sort: 'manual' }) : api().tasks.list({ showCompleted: false, sort: 'created' }), api().projects.list()]);
      if (alive) { setTasks(t.slice(0, 30)); setProjects(p.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()))); setSel(0); }
    }, 80);
    return () => { alive = false; clearTimeout(h); };
  }, [q]);

  const results = useMemo<Result[]>(() => {
    const ql = q.toLowerCase();
    const r: Result[] = [];
    if (filter === 'all' || filter === 'cmd') r.push(...commands.filter((c) => c.label.toLowerCase().includes(ql)).map((c) => ({ kind: 'cmd' as const, c })));
    if (filter === 'all' || filter === 'task') r.push(...tasks.map((t) => ({ kind: 'task' as const, t })));
    if (filter === 'all' || filter === 'project') r.push(...projects.map((p) => ({ kind: 'project' as const, p })));
    return r;
  }, [q, filter, tasks, projects, commands]);

  const exec = (r: Result) => {
    onClose();
    if (r.kind === 'cmd') r.c.run(); else if (r.kind === 'task') openTask(r.t.id); else openProject(r.p.id);
  };
  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette" onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
        else if (e.key === 'Enter' && results[sel]) exec(results[sel]);
      }}>
        <input autoFocus placeholder="Pesquisar tarefas, projetos ou comandos…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          {([['all', 'Tudo'], ['task', 'Tarefas'], ['project', 'Projetos'], ['cmd', 'Comandos']] as const).map(([k, l]) =>
            <button key={k} className={filter === k ? 'chip on' : 'chip'} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
        <ul className="results">
          {results.length === 0 && <li className="muted">Nenhum resultado.</li>}
          {results.map((r, i) => (
            <li key={r.kind + (r.kind === 'cmd' ? r.c.id : r.kind === 'task' ? r.t.id : r.p.id)} className={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => exec(r)}>
              {r.kind === 'cmd' && <><span className="kind">Comando</span>{r.c.label}{r.c.hint && <kbd>{r.c.hint}</kbd>}</>}
              {r.kind === 'task' && <><span className="kind">Tarefa</span>{r.t.title}<small className="muted"> · {STATUS_LABEL[r.t.status]}</small></>}
              {r.kind === 'project' && <><span className="kind">Projeto</span><span className="dot" style={{ background: r.p.color }} />{r.p.name}</>}
            </li>
          ))}
        </ul>
        <small className="muted">Notas, arquivos, quadros e desenhos entrarão na pesquisa nas próximas etapas.</small>
      </div>
    </div>
  );
}
