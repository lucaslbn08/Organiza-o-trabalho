import { Bell, X } from 'lucide-react';
import type { NotificationCenter, Task } from '../../shared/types';
import { api, fmtDate, fmtDateTime } from '../lib/api';
import { useUi } from '../lib/ui';

export function NotificationCenterPanel({ center, onClose, onOpenTask, goAgenda }: { center: NotificationCenter; onClose: () => void; onOpenTask: (id: number) => void; goAgenda: () => void }) {
  const ui = useUi();
  const list = (title: string, ts: Task[], cls = '') => ts.length > 0 && (
    <><h5 className={cls}>{title} · {ts.length}</h5>
      <ul className="mini-list">{ts.map((t) => <li key={t.id} onClick={() => onOpenTask(t.id)}><span className="task-title">{t.title}</span><small className="muted">{fmtDate(t.due_date)}{t.due_time ? ' ' + t.due_time : ''}</small></li>)}</ul></>
  );
  const empty = !center.overdue.length && !center.today.length && !center.upcoming.length && !center.reminders.length;
  return (
    <div className="popover notif" onMouseDown={(e) => e.stopPropagation()}>
      <div className="row"><strong><Bell size={14} /> Notificações</strong><span className="grow" /><button className="link" onClick={goAgenda}>Abrir agenda</button><button className="icon" onClick={onClose}><X size={14} /></button></div>
      {empty && <p className="muted">Nada pendente. 🎉</p>}
      {list('Atrasadas', center.overdue, 'danger-text')}
      {list('Para hoje', center.today)}
      {list('Próximos 3 dias', center.upcoming)}
      {center.reminders.length > 0 && <><h5>Lembretes</h5>
        <ul className="mini-list">{center.reminders.map((r) => (
          <li key={r.id} className={r.fired_at ? 'fired' : ''}>
            <span className="task-title" onClick={() => r.task_id && onOpenTask(r.task_id)}>{r.title}</span>
            <small className="muted">{fmtDateTime(r.remind_at)}</small>
            {r.fired_at && <button className="btn" onClick={() => ui.run(api().reminders.snooze(r.id, 10))}>+10 min</button>}
            <button className="icon ghost" title="Dispensar" onClick={() => ui.run(api().reminders.dismiss(r.id))}><X size={12} /></button>
          </li>))}</ul></>}
    </div>
  );
}
