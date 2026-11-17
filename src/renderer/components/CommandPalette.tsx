import { useEffect, useMemo, useState } from 'react';
import type { SearchHit, SearchType } from '../../shared/types';
import { api } from '../lib/api';
import { highlight } from '../lib/text';

export interface Command { id: string; label: string; hint?: string; run: () => void }
type Result = { kind: 'cmd'; c: Command } | { kind: 'hit'; h: SearchHit };
const KIND: Record<SearchType, string> = { task: 'Tarefa', note: 'Anotação', project: 'Projeto', tag: 'Etiqueta', drawing: 'Desenho', board: 'Quadro', file: 'Arquivo' };
const FILTERS = [['all', 'Tudo'], ['task', 'Tarefas'], ['note', 'Anotações'], ['project', 'Projetos'], ['tag', 'Etiquetas'], ['drawing', 'Desenhos'], ['board', 'Quadros'], ['file', 'Arquivos'], ['cmd', 'Comandos']] as const;

export function CommandPalette({ commands, onClose, openTask, openProject, openNote, openCanvas, openFile }: {
  commands: Command[]; onClose: () => void; openTask: (id: number) => void; openProject: (id: number) => void; openNote: (id: number) => void; openCanvas: (k: 'drawing' | 'board', id: number) => void; openFile: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    let alive = true;
    const types: SearchType[] = filter === 'all' ? ['task', 'note', 'project', 'tag', 'drawing', 'board', 'file'] : filter === 'cmd' ? [] : [filter];
    const h = setTimeout(async () => {
      const r = q.trim() && filter !== 'cmd' ? await api().search.query(q, types).catch(() => [] as SearchHit[]) : [];
      if (alive) { setHits(r); setSel(0); }
    }, 90);
    return () => { alive = false; clearTimeout(h); };
  }, [q, filter]);

  const results = useMemo<Result[]>(() => {
    const ql = q.toLowerCase();
    const cmds = filter === 'all' || filter === 'cmd' ? commands.filter((c) => c.label.toLowerCase().includes(ql)).map((c) => ({ kind: 'cmd' as const, c })) : [];
    return [...hits.map((h) => ({ kind: 'hit' as const, h })), ...cmds];
  }, [q, filter, hits, commands]);

  const exec = (r: Result) => {
    onClose();
    if (r.kind === 'cmd') return r.c.run();
    const { type, id, title } = r.h;
    if (type === 'task') openTask(id); else if (type === 'note') openNote(id); else if (type === 'project') openProject(id); else if (type === 'drawing' || type === 'board') openCanvas(type, id); else if (type === 'file') openFile(id);
    else { setQ(title); }
  };
  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette" onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
        else if (e.key === 'Enter' && results[sel]) exec(results[sel]);
      }}>
        <input autoFocus placeholder="Pesquisar tarefas, anotações, projetos, etiquetas ou comandos…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">{FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'chip on' : 'chip'} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <ul className="results">
          {results.length === 0 && <li className="muted">{q ? 'Nenhum resultado.' : 'Digite para pesquisar.'}</li>}
          {results.map((r, i) => (
            <li key={r.kind === 'cmd' ? 'c' + r.c.id : r.h.type + r.h.id} className={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => exec(r)}>
              {r.kind === 'cmd' ? <><span className="kind">Comando</span>{r.c.label}{r.c.hint && <kbd>{r.c.hint}</kbd>}</> : <>
                <span className="kind">{KIND[r.h.type]}</span>
                {r.h.type === 'project' && <span className="dot" style={{ background: r.h.extra }} />}
                <span className="hit"><span>{r.h.title}{r.h.type === 'task' && <small className="muted"> · {r.h.extra}</small>}</span>
                  {r.h.snippet && <small className="muted ellipsis" dangerouslySetInnerHTML={{ __html: highlight(r.h.snippet) }} />}</span>
              </>}
            </li>
          ))}
        </ul>
        <small className="muted">Pesquisa em títulos e conteúdo de tarefas, anotações, desenhos e quadros; arquivos pelo nome e pasta.</small>
      </div>
    </div>
  );
}
