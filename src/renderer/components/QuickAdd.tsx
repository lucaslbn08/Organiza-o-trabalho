import { useState } from 'react';
import type { TaskPriority } from '../../shared/types';
import { api } from '../lib/api';
import { useUi } from '../lib/ui';
import { PrioritySelect } from './TaskBits';

export function QuickAdd({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: number) => void }) {
  const ui = useUi();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [due, setDue] = useState('');
  const submit = async () => {
    if (!title.trim()) return;
    const t = await ui.run(api().tasks.create({ title, priority, due_date: due || null }), 'Tarefa criada');
    if (t) { onCreated?.(t.id); onClose(); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal">
        <h3>Nova tarefa</h3>
        <input autoFocus placeholder="O que precisa ser feito?" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <div className="row">
          <label>Prioridade<PrioritySelect value={priority} onChange={setPriority} /></label>
          <label>Prazo<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
        <div className="row end">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!title.trim()} onClick={submit}>Criar (Enter)</button>
        </div>
      </div>
    </div>
  );
}
