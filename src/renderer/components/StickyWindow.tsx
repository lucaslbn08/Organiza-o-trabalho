import { useEffect, useState } from 'react';
import { Pin, PinOff, Minus, Plus, X, Palette } from 'lucide-react';
import type { FloatingNote } from '../../shared/types';
import { api, useQuery, useAutosave, flushAll } from '../lib/api';

const COLORS = ['#fff3a3', '#ffd8a8', '#ffc9c9', '#d0ebff', '#c3fae8', '#e5dbff', '#f1f3f5'];

/** Janela própria de uma nota flutuante (sem moldura; arrastável pela barra superior). */
export function StickyWindow({ id }: { id: number }) {
  const { data: note, error } = useQuery(() => api().floating.get(id), [id]);
  useEffect(() => { api().onFlushRequest(flushAll); }, []);
  if (error && !note) return <div className="sticky gone">Nota removida.</div>;
  if (!note) return null;
  return <Sticky key={note.id} note={note} />;
}

function Sticky({ note }: { note: FloatingNote }) {
  const [text, setText] = useState(note.content);
  const [palette, setPalette] = useState(false);
  const { data: fresh = note } = useQuery(() => api().floating.get(note.id), [note.id]);
  const { data: tasks = [] } = useQuery(() => api().tasks.list({ showCompleted: false, sort: 'title' }));
  const state = useAutosave(text, (v) => api().floating.update(note.id, { content: v }), 500);
  const upd = (p: Parameters<ReturnType<typeof api>['floating']['update']>[1]) => void api().floating.update(note.id, p);
  useEffect(() => { document.title = text.split('\n')[0] || 'Nota flutuante'; document.body.classList.add('sticky-body'); }, [text]);

  return (
    <div className="sticky" style={{ background: fresh.color }}>
      <header className="sticky-bar">
        <span className="drag grow" title="Arraste para mover">{state === 'pending' ? 'Salvando…' : fresh.task_title ? `↳ ${fresh.task_title}` : ''}</span>
        <button className="sb" title="Cor" onClick={() => setPalette(!palette)}><Palette size={13} /></button>
        <button className="sb" title={fresh.always_on_top ? 'Desafixar (deixa de ficar sobre outras janelas)' : 'Fixar sobre todas as janelas'} onClick={() => upd({ always_on_top: !fresh.always_on_top })}>{fresh.always_on_top ? <Pin size={13} /> : <PinOff size={13} />}</button>
        <button className="sb" title={fresh.minimized ? 'Expandir' : 'Minimizar'} onClick={() => upd({ minimized: !fresh.minimized })}>{fresh.minimized ? <Plus size={13} /> : <Minus size={13} />}</button>
        <button className="sb" title="Fechar (a nota continua salva)" onClick={async () => { await flushAll(); void api().floating.close(note.id); }}><X size={13} /></button>
      </header>
      {palette && <div className="sticky-palette">{COLORS.map((c) => <button key={c} style={{ background: c }} aria-label={c} onClick={() => { upd({ color: c }); setPalette(false); }} />)}</div>}
      {!fresh.minimized && <>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva aqui…" spellCheck />
        <select className="sticky-task" value={fresh.task_id ?? ''} onChange={(e) => upd({ task_id: e.target.value ? Number(e.target.value) : null })} title="Relacionar a uma tarefa">
          <option value="">Sem tarefa relacionada</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
      </>}
    </div>
  );
}
