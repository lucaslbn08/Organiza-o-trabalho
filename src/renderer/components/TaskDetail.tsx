import { useEffect, useState } from 'react';
import { X, Copy, Trash2, Plus, ExternalLink } from 'lucide-react';
import type { TaskDetail as TD, Recurrence } from '../../shared/types';
import { RECURRENCE_LABEL, RECURRENCES } from '../../shared/types';
import { api, useQuery, useAutosave, fmtDateTime } from '../lib/api';
import { useUi } from '../lib/ui';
import { StatusSelect, PrioritySelect } from './TaskBits';

export function TaskDetailPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: t } = useQuery(() => api().tasks.get(id), [id]);
  if (!t) return <aside className="detail" />;
  return <Editor key={t.id} t={t} onClose={onClose} />;
}

function Editor({ t, onClose }: { t: TD; onClose: () => void }) {
  const ui = useUi();
  const { data: projects = [] } = useQuery(() => api().projects.list());
  const { data: categories = [] } = useQuery(() => api().categories.list());
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
        <label>Prazo<input type="date" value={t.due_date ?? ''} onChange={(e) => upd({ due_date: e.target.value || null })} /></label>
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
