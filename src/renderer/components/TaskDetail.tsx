import { useEffect, useState } from 'react';
import { X, Copy, Trash2, Plus, ExternalLink } from 'lucide-react';
import type { TaskDetail as TD, Recurrence } from '../../shared/types';
import { RECURRENCE_LABEL, RECURRENCES } from '../../shared/types';
import { api, useQuery, useAutosave, fmtDateTime } from '../lib/api';
import { useUi } from '../lib/ui';
import { AttachmentsSection } from './Attachments';
import { StatusSelect, PrioritySelect } from './TaskBits';

type NoteNav = { openNote: (id: number) => void; newNote: (taskId: number) => void; openCanvas: (k: 'drawing' | 'board', id: number) => void; newCanvas: (k: 'drawing' | 'board', taskId: number) => void; onOpenFile: (id: number) => void };
export function TaskDetailPanel({ id, onClose, ...nav }: { id: number; onClose: () => void } & NoteNav) {
  const { data: t } = useQuery(() => api().tasks.get(id), [id]);
  if (!t) return <aside className="detail" />;
  return <Editor key={t.id} t={t} onClose={onClose} {...nav} />;
}

function Editor({ t, onClose, openNote, newNote, openCanvas, newCanvas, onOpenFile }: { t: TD; onClose: () => void } & NoteNav) {
  const ui = useUi();
  const { data: projects = [] } = useQuery(() => api().projects.list());
  const { data: categories = [] } = useQuery(() => api().categories.list());
  const { data: notes = [] } = useQuery(() => api().notes.list({ task_id: t.id }), [t.id]);
  const { data: allNotes = [] } = useQuery(() => api().notes.list({}));
  const { data: drawings = [] } = useQuery(() => api().canvases.list('drawing', { task_id: t.id }), [t.id]);
  const { data: boards = [] } = useQuery(() => api().canvases.list('board', { task_id: t.id }), [t.id]);
  const [title, setTitle] = useState(t.title);
  const [desc, setDesc] = useState(t.description);
  const [tags, setTags] = useState(t.tags.map((g) => g.name).join(', '));
  const [newItem, setNewItem] = useState({ checklist: '', subtask: '' });
  const [comment, setComment] = useState('');
  const [link, setLink] = useState('');

  const saveState = useAutosave({ title, desc, tags }, (v) =>
    v.title.trim() ? api().tasks.update(t.id, { title: v.title, description: v.desc, tags: v.tags.split(',') }) : Promise.resolve());
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);

  const upd = (p: Parameters<ReturnType<typeof api>['tasks']['update']>[1]) => ui.run(api().tasks.update(t.id, p));
  const addItem = (kind: 'checklist' | 'subtask') => {
    const text = newItem[kind].trim(); if (!text) return;
    ui.run(api().tasks.addChecklist(t.id, kind, text)); setNewItem({ ...newItem, [kind]: '' });
  };

  return (
    <aside className="detail" aria-label="Detalhes da tarefa">
      <header className="row">
        <span className={`save-state ${saveState}`}>{saveState === 'saved' ? 'Salvo' : saveState === 'pending' ? 'Salvando…' : 'Erro ao salvar'}</span>
        <span className="grow" />
        <button className="icon" title="Duplicar" onClick={() => ui.run(api().tasks.duplicate(t.id), 'Tarefa duplicada')}><Copy size={16} /></button>
        <button className="icon" title="Enviar para a lixeira" onClick={async () => { await ui.run(api().tasks.remove(t.id), 'Tarefa enviada para a lixeira'); onClose(); }}><Trash2 size={16} /></button>
        <button className="icon" title="Fechar (Esc)" onClick={onClose}><X size={16} /></button>
      </header>
      <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título da tarefa" />
      <div className="grid2">
        <label>Status<StatusSelect value={t.status} onChange={(status) => upd({ status })} /></label>
        <label>Prioridade<PrioritySelect value={t.priority} onChange={(priority) => upd({ priority })} /></label>
        <label>Prazo<span className="row nowrap"><input type="date" value={t.due_date ?? ''} onChange={(e) => upd({ due_date: e.target.value || null, ...(e.target.value ? {} : { due_time: null }) })} />
          <input type="time" value={t.due_time ?? ''} disabled={!t.due_date} title="Horário (opcional)" onChange={(e) => upd({ due_time: e.target.value || null })} /></span></label>
        <label>Repetição<select value={t.recurrence} onChange={(e) => upd({ recurrence: e.target.value as Recurrence })}>
          {RECURRENCES.map((r) => <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>)}</select></label>
        <label>Projeto<select value={t.project_id ?? ''} onChange={(e) => upd({ project_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Nenhum</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Categoria<select value={t.category_id ?? ''} onChange={(e) => upd({ category_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Nenhuma</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </div>
      <label>Etiquetas (separadas por vírgula)<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ex.: cliente, revisão" /></label>
      <label>Descrição<textarea rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Detalhes, contexto, referências…" /></label>

      {(['subtask', 'checklist'] as const).map((kind) => {
        const items = t.checklist.filter((c) => c.kind === kind);
        return (
          <section key={kind}>
            <h4>{kind === 'subtask' ? 'Subtarefas' : 'Checklist'} {items.length > 0 && <small>{items.filter((i) => i.done).length}/{items.length}</small>}</h4>
            {items.map((c) => (
              <div key={c.id} className="check-row" onContextMenu={(e) => ui.menu(e, [{ label: 'Remover', danger: true, onClick: () => ui.run(api().tasks.removeChecklist(c.id)) }])}>
                <input type="checkbox" checked={!!c.done} onChange={(e) => ui.run(api().tasks.updateChecklist(c.id, { done: e.target.checked }))} />
                <span className={c.done ? 'done-text' : ''}>{c.text}</span>
                <button className="icon ghost" title="Remover" onClick={() => ui.run(api().tasks.removeChecklist(c.id))}><X size={12} /></button>
              </div>
            ))}
            <div className="row"><input value={newItem[kind]} placeholder={kind === 'subtask' ? 'Nova subtarefa' : 'Novo item'} onChange={(e) => setNewItem({ ...newItem, [kind]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addItem(kind)} />
              <button className="icon" onClick={() => addItem(kind)} title="Adicionar"><Plus size={16} /></button></div>
          </section>
        );
      })}

      <section>
        <h4>Notas associadas</h4>
        {notes.map((n) => (
          <div key={n.id} className="check-row">
            <a href="#" onClick={(e) => { e.preventDefault(); openNote(n.id); }}>{n.title || 'Sem título'}</a>
            <button className="icon ghost" title="Desvincular" onClick={() => ui.run(api().notes.unlinkTask(n.id, t.id))}><X size={12} /></button>
          </div>
        ))}
        <div className="row">
          <button className="btn" onClick={() => newNote(t.id)}><Plus size={14} /> Nova nota</button>
          <select value="" onChange={(e) => e.target.value && ui.run(api().notes.linkTask(Number(e.target.value), t.id))}>
            <option value="">Vincular nota existente…</option>
            {allNotes.filter((n) => !notes.some((x) => x.id === n.id)).map((n) => <option key={n.id} value={n.id}>{n.title || 'Sem título'}</option>)}
          </select>
        </div>
      </section>

      <AttachmentsSection target={{ type: 'task', id: t.id }} onPreview={onOpenFile} />

      <Reminders taskId={t.id} title={t.title} dueDate={t.due_date} />

      <section>
        <h4>Desenhos e quadros</h4>
        {[...drawings, ...boards].map((c) => (
          <div key={c.kind + c.id} className="check-row">
            <small className="muted">{c.kind === 'drawing' ? 'Desenho' : 'Quadro'}</small>
            <a href="#" onClick={(e) => { e.preventDefault(); openCanvas(c.kind, c.id); }}>{c.title || 'Sem título'}</a>
          </div>
        ))}
        <div className="row"><button className="btn" onClick={() => newCanvas('drawing', t.id)}><Plus size={14} /> Novo desenho</button></div>
      </section>

      <section>
        <h4>Links e referências</h4>
        {t.links.map((l) => (
          <div key={l.id} className="check-row">
            <a href="#" onClick={(e) => { e.preventDefault(); ui.run(window.openExternal(l.url)); }}>{l.label} <ExternalLink size={11} /></a>
            <button className="icon ghost" onClick={() => ui.run(api().tasks.removeLink(l.id))}><X size={12} /></button>
          </div>
        ))}
        <div className="row"><input value={link} placeholder="https://…" onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && link.trim()) { ui.run(api().tasks.addLink(t.id, '', link.trim())); setLink(''); } }} /></div>
      </section>

      <section>
        <h4>Comentários e observações</h4>
        {t.comments.map((c) => <div key={c.id} className="comment"><small>{fmtDateTime(c.created_at)}</small><p>{c.body}</p></div>)}
        <textarea rows={2} value={comment} placeholder="Escreva e pressione Ctrl+Enter" onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey && comment.trim()) { ui.run(api().tasks.addComment(t.id, comment)); setComment(''); } }} />
      </section>

      <section>
        <h4>Histórico</h4>
        <ul className="history">{t.history.map((h) => <li key={h.id}><small>{fmtDateTime(h.created_at)}</small> {h.action} {h.details && <em>{h.details}</em>}</li>)}</ul>
        <small className="muted">Criada em {fmtDateTime(t.created_at)}</small>
      </section>
    </aside>
  );
}

function Reminders({ taskId, title, dueDate }: { taskId: number; title: string; dueDate: string | null }) {
  const ui = useUi();
  const { data: all = [] } = useQuery(() => api().reminders.list());
  const mine = all.filter((r) => r.task_id === taskId);
  const [when, setWhen] = useState(() => (dueDate ?? new Date().toISOString().slice(0, 10)) + 'T09:00');
  return (
    <section>
      <h4>Lembretes</h4>
      {mine.map((r) => (
        <div key={r.id} className="check-row"><span>{fmtDateTime(r.remind_at)}</span>{r.fired_at && <small className="muted">disparado</small>}
          <button className="icon ghost" title="Remover" onClick={() => ui.run(api().reminders.remove(r.id))}><X size={12} /></button></div>
      ))}
      <div className="row">
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <button className="btn" onClick={() => when && ui.run(api().reminders.create({ task_id: taskId, title, remind_at: new Date(when).toISOString() }), 'Lembrete criado')}><Plus size={14} /> Lembrar</button>
      </div>
    </section>
  );
}
