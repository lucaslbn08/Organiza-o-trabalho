import { CalendarDays, Repeat } from 'lucide-react';
import type { Task, TaskStatus, TaskPriority } from '../../shared/types';
import { STATUS_LABEL, PRIORITY_LABEL, TASK_STATUSES, TASK_PRIORITIES } from '../../shared/types';
import { fmtDate, today } from '../lib/api';

export function StatusSelect({ value, onChange }: { value: TaskStatus; onChange: (s: TaskStatus) => void }) {
  return (
    <select className={`status-select st-${value}`} value={value} onClick={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.value as TaskStatus)} aria-label="Status">
      {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
    </select>
  );
}
export function PrioritySelect({ value, onChange }: { value: TaskPriority; onChange: (p: TaskPriority) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as TaskPriority)} aria-label="Prioridade">
      {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
    </select>
  );
}
export const PriorityDot = ({ p }: { p: TaskPriority }) => <span className={`prio prio-${p}`} title={`Prioridade ${PRIORITY_LABEL[p]}`} />;

export function TaskMeta({ t }: { t: Task }) {
  const overdue = t.due_date && t.due_date < today() && t.status !== 'done' && t.status !== 'cancelled';
  return (
    <span className="task-meta">
      {t.due_date && <span className={overdue ? 'due overdue' : 'due'}><CalendarDays size={12} /> {fmtDate(t.due_date)}</span>}
      {t.recurrence !== 'none' && <Repeat size={12} aria-label="Recorrente" />}
      {t.progress.total > 0 && (
        <span className="progress" title={`${t.progress.done}/${t.progress.total}`}>
          <span className="bar"><span style={{ width: `${(t.progress.done / t.progress.total) * 100}%` }} /></span>{t.progress.done}/{t.progress.total}
        </span>
      )}
      {t.tags.map((g) => <span key={g.id} className="tag">#{g.name}</span>)}
    </span>
  );
}
