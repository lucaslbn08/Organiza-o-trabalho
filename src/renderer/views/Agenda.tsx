import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Bell, Plus, X } from 'lucide-react';
import type { Task, Reminder } from '../../shared/types';
import { STATUS_LABEL } from '../../shared/types';
import { api, useQuery } from '../lib/api';
import { useUi } from '../lib/ui';
import { PriorityDot } from '../components/TaskBits';

type Mode = 'month' | 'week' | 'day';
const WD = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const localKey = (isoDT: string) => iso(new Date(isoDT));
const hm = (isoDT: string) => new Date(isoDT).toTimeString().slice(0, 5);

export function AgendaView({ onOpenTask }: { onOpenTask: (id: number) => void }) {
  const ui = useUi();
  const [mode, setMode] = useState<Mode>(() => { try { return (localStorage.getItem('agendaMode') as Mode) || 'month'; } catch { return 'month'; } });
  const [ref, setRef] = useState(() => new Date());
  const [newRem, setNewRem] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const days = useMemo(() => {
    if (mode === 'day') return [new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())];
    if (mode === 'week') { const s = startOfWeek(ref); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
    const s = startOfWeek(new Date(ref.getFullYear(), ref.getMonth(), 1));
    return Array.from({ length: 42 }, (_, i) => addDays(s, i));
  }, [mode, ref]);
  const from = iso(days[0]), to = iso(days[days.length - 1]);
  const { data } = useQuery(() => api().agenda.range(from, to), [from, to]);
  const byDay = useMemo(() => {
    const m = new Map<string, { tasks: Task[]; reminders: Reminder[] }>();
    const get = (k: string) => m.get(k) ?? m.set(k, { tasks: [], reminders: [] }).get(k)!;
    data?.tasks.forEach((t) => get(t.due_date!).tasks.push(t));
    data?.reminders.forEach((r) => get(localKey(r.remind_at)).reminders.push(r));
    m.forEach((v) => v.tasks.sort((a, b) => (a.due_time ?? '99').localeCompare(b.due_time ?? '99')));
    return m;
  }, [data]);

  const setModeP = (m: Mode) => { setMode(m); try { localStorage.setItem('agendaMode', m); } catch { /* opcional */ } };
  const step = (n: number) => setRef((r) => (mode === 'month' ? new Date(r.getFullYear(), r.getMonth() + n, 1) : addDays(r, n * (mode === 'week' ? 7 : 1))));
  const today = iso(new Date());
  const title = mode === 'month' ? ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : mode === 'week' ? `${days[0].toLocaleDateString('pt-BR')} – ${days[6].toLocaleDateString('pt-BR')}` : ref.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const quickTask = async (day: string) => {
    const t = prompt(`Nova tarefa para ${new Date(day + 'T12:00').toLocaleDateString('pt-BR')}`);
    if (t?.trim()) ui.run(api().tasks.create({ title: t, due_date: day }), 'Tarefa criada');
  };
  const dropOn = (day: string) => { if (drag) ui.run(api().tasks.update(drag, { due_date: day })); setDrag(null); };

  const taskChip = (t: Task) => (
    <div key={t.id} className={`agenda-item st-${t.status}`} draggable onDragStart={(e) => { e.stopPropagation(); setDrag(t.id); }}
      onClick={(e) => { e.stopPropagation(); onOpenTask(t.id); }} title={`${t.title} · ${STATUS_LABEL[t.status]}`}
      onContextMenu={(e) => ui.menu(e, [
        { label: 'Abrir', onClick: () => onOpenTask(t.id) },
        { label: 'Marcar como concluída', onClick: () => ui.run(api().tasks.update(t.id, { status: 'done' })) },
        { label: 'Adiar 1 dia', onClick: () => ui.run(api().tasks.update(t.id, { due_date: iso(addDays(new Date(t.due_date + 'T12:00'), 1)) })) },
        { label: 'Remover prazo', onClick: () => ui.run(api().tasks.update(t.id, { due_date: null, due_time: null })) },
      ])}>
      <PriorityDot p={t.priority} />{t.due_time && <small>{t.due_time}</small>}<span className="ellipsis">{t.title}</span>
    </div>
  );
  const remChip = (r: Reminder) => (
    <div key={'r' + r.id} className={`agenda-item reminder ${r.dismissed_at ? 'dismissed' : ''}`} title={r.title} onClick={(e) => { e.stopPropagation(); if (r.task_id) onOpenTask(r.task_id); }}>
      <Bell size={11} /><small>{hm(r.remind_at)}</small><span className="ellipsis">{r.title}</span>
      <button className="icon ghost" title="Excluir lembrete" onClick={(e) => { e.stopPropagation(); ui.run(api().reminders.remove(r.id)); }}><X size={10} /></button>
    </div>
  );

  return (
    <div className="view wide agenda">
      <header className="view-h">
        <h2>Agenda</h2>
        <button className="icon" onClick={() => step(-1)} aria-label="Anterior"><ChevronLeft size={18} /></button>
        <button className="btn" onClick={() => setRef(new Date())}>Hoje</button>
        <button className="icon" onClick={() => step(1)} aria-label="Próximo"><ChevronRight size={18} /></button>
        <strong className="agenda-title">{title}</strong>
        <span className="grow" />
        <div className="seg">{(['day', 'week', 'month'] as Mode[]).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setModeP(m)}>{m === 'day' ? 'Dia' : m === 'week' ? 'Semana' : 'Mês'}</button>)}</div>
        <button className="btn" onClick={() => setNewRem(iso(ref) + 'T09:00')}><Bell size={14} /> Novo lembrete</button>
      </header>
      {mode !== 'day' && <div className={`agenda-grid ${mode}`}>
        {WD.map((w) => <div key={w} className="wd">{w}</div>)}
        {days.map((d) => {
          const k = iso(d); const items = byDay.get(k);
          const out = mode === 'month' && d.getMonth() !== ref.getMonth();
          return (
            <div key={k} className={`day ${k === today ? 'today' : ''} ${out ? 'out' : ''}`} onDoubleClick={() => quickTask(k)}
              onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(k)}>
              <div className="day-h"><button className="link" onClick={() => { setRef(d); setModeP('day'); }}>{d.getDate()}</button>
                <button className="icon ghost add" title="Nova tarefa neste dia" onClick={() => quickTask(k)}><Plus size={12} /></button></div>
              {items?.reminders.map(remChip)}
              {items?.tasks.slice(0, mode === 'month' ? 4 : 50).map(taskChip)}
              {mode === 'month' && (items?.tasks.length ?? 0) > 4 && <button className="link more" onClick={() => { setRef(d); setModeP('day'); }}>+{items!.tasks.length - 4} mais</button>}
            </div>
          );
        })}
      </div>}
      {mode === 'day' && (() => {
        const k = iso(days[0]); const items = byDay.get(k);
        const timed = items?.tasks.filter((t) => t.due_time) ?? []; const untimed = items?.tasks.filter((t) => !t.due_time) ?? [];
        return (
          <div className="agenda-day" onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(k)}>
            <section className="card"><h4>Lembretes</h4>{items?.reminders.length ? items.reminders.map(remChip) : <p className="muted">Nenhum lembrete.</p>}</section>
            <section className="card"><h4>Com horário</h4>{timed.length ? timed.map(taskChip) : <p className="muted">Nenhuma tarefa com horário.</p>}</section>
            <section className="card"><h4>Sem horário</h4>{untimed.length ? untimed.map(taskChip) : <p className="muted">Nenhuma tarefa.</p>}
              <button className="btn" onClick={() => quickTask(k)}><Plus size={14} /> Nova tarefa para este dia</button></section>
          </div>
        );
      })()}
      <small className="muted">Arraste uma tarefa para outro dia para mudar o prazo. Clique duas vezes num dia para criar uma tarefa.</small>
      {newRem && <ReminderModal initial={newRem} onClose={() => setNewRem(null)} />}
    </div>
  );
}

function ReminderModal({ initial, onClose }: { initial: string; onClose: () => void }) {
  const ui = useUi();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(initial);
  const [taskId, setTaskId] = useState('');
  const { data: tasks = [] } = useQuery(() => api().tasks.list({ showCompleted: false, sort: 'title' }));
  const save = async () => {
    const t = tasks.find((x) => x.id === Number(taskId));
    const name = title.trim() || t?.title; if (!name || !when) return;
    if (await ui.run(api().reminders.create({ title: name, remind_at: new Date(when).toISOString(), task_id: t?.id ?? null }), 'Lembrete criado')) onClose();
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal">
        <h3>Novo lembrete</h3>
        <label>Descrição<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: enviar relatório" /></label>
        <label>Quando<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
        <label>Tarefa relacionada (opcional)<select value={taskId} onChange={(e) => setTaskId(e.target.value)}><option value="">Nenhuma</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
        <div className="row end"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save}>Criar</button></div>
      </div>
    </div>
  );
}
