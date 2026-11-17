import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Home, ListTodo, Columns3, StickyNote, PenTool, Infinity as InfIcon, CalendarDays, FolderKanban, Paperclip,
  History, Trash2, Settings as Gear, PanelLeftClose, PanelLeftOpen, Search, Plus,
} from 'lucide-react';
import type { Settings } from '../shared/types';
import { api, useQuery, flushAll } from './lib/api';
const NotesView = lazy(() => import('./views/Notes').then((m) => ({ default: m.NotesView })));
import { useUi } from './lib/ui';
import { HomeView } from './views/Home';
import { TasksView } from './views/Tasks';
import { KanbanView } from './views/Kanban';
import { ProjectsView, ProjectDetailView } from './views/Projects';
import { TrashView, HistoryView, SettingsView, UpcomingView } from './views/Misc';
import { TaskDetailPanel } from './components/TaskDetail';
import { QuickAdd } from './components/QuickAdd';
import { CommandPalette, type Command } from './components/CommandPalette';

const NAV = [
  { id: 'home', label: 'Início', icon: Home },
  { id: 'tasks', label: 'Minhas tarefas', icon: ListTodo },
  { id: 'kanban', label: 'Quadro Kanban', icon: Columns3 },
  { id: 'notes', label: 'Anotações', icon: StickyNote },
  { id: 'drawings', label: 'Desenhos e esboços', icon: PenTool },
  { id: 'boards', label: 'Quadro infinito', icon: InfIcon },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'projects', label: 'Projetos', icon: FolderKanban },
  { id: 'files', label: 'Arquivos', icon: Paperclip },
  { id: 'history', label: 'Histórico', icon: History },
  { id: 'trash', label: 'Lixeira', icon: Trash2 },
  { id: 'settings', label: 'Configurações', icon: Gear },
];

const UPCOMING: Record<string, { stage: number; items: string[] }> = {
  drawings: { stage: 3, items: ['Ferramentas de desenho vetorial editável', 'Exportação PNG/PDF', 'Vínculo com tarefas e notas'] },
  boards: { stage: 3, items: ['Quadro infinito com notas, tarefas sincronizadas, imagens, PDFs, conectores', 'Persistência de câmera, zoom e objetos', 'Exportação PNG/PDF ajustada ao conteúdo'] },
  agenda: { stage: 4, items: ['Visualização diária, semanal e mensal', 'Lembretes e notificações do Windows', 'Central de notificações'] },
  files: { stage: 4, items: ['Biblioteca interna (cópia) e vínculos externos', 'Visualização de imagens e PDFs', 'Detecção de arquivos ausentes'] },
};

export function App() {
  const ui = useUi();
  const { data: settings } = useQuery(() => api().settings.get());
  const [view, setView] = useState<{ id: string; arg?: number } | null>(null);
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [quick, setQuick] = useState(false);
  const [palette, setPalette] = useState(false);
  const [panelW, setPanelW] = useState(() => { try { return Number(localStorage.getItem('detailW')) || 440; } catch { return 440; } });
  const resizing = useRef(false);

  useEffect(() => { api().onFlushRequest(flushAll); }, []);
  useEffect(() => { if (settings && !view) setView({ id: settings.lastView || 'home' }); }, [settings, view]);
  useEffect(() => {
    if (!settings) return;
    const r = document.documentElement;
    r.dataset.theme = settings.theme;
    r.style.setProperty('--accent', settings.accent);
    r.style.fontSize = `${14 * settings.uiScale}px`;
    r.classList.toggle('no-anim', !settings.animations);
  }, [settings]);

  const go = useCallback((id: string, arg?: number) => {
    setView({ id, arg });
    if (id !== 'project') ui.run(api().settings.set({ lastView: id }));
  }, [ui]);
  const set = (p: Partial<Settings>) => ui.run(api().settings.set(p));
  const openNote = useCallback((id: number) => {
    if (!settings) return;
    const list = settings.openNotes.includes(id) ? settings.openNotes : [...settings.openNotes, id].slice(-12);
    ui.run(api().settings.set({ openNotes: list, activeNote: id, lastView: 'notes' }));
    setView({ id: 'notes' });
  }, [settings, ui]);
  const closeNote = useCallback((id: number) => {
    if (!settings) return;
    const list = settings.openNotes.filter((x) => x !== id);
    ui.run(api().settings.set({ openNotes: list, activeNote: settings.activeNote === id ? list.at(-1) ?? null : settings.activeNote }));
  }, [settings, ui]);
  const newNote = async (extra: { project_id?: number; task_id?: number } = {}) => { const n = await ui.run(api().notes.create(extra)); if (n) openNote(n.id); };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const key = e.key.toLowerCase();
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      if (typing && key !== 'k' && key !== 'n') return; // Ctrl+B, Ctrl+1… pertencem ao editor quando se está digitando
      if (key === 'k') { e.preventDefault(); setPalette(true); }
      else if (key === 'n' && e.shiftKey) { e.preventDefault(); newNote(); }
      else if (key === 'n') { e.preventDefault(); setQuick(true); }
      else if (key === 'b' && settings) { e.preventDefault(); set({ sidebarCollapsed: !settings.sidebarCollapsed }); }
      else if (['1', '2', '3', '4'].includes(key)) { e.preventDefault(); go(['home', 'tasks', 'kanban', 'projects'][Number(key) - 1]); }
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  });

  useEffect(() => {
    const move = (e: MouseEvent) => { if (resizing.current) setPanelW(Math.min(Math.max(innerWidth - e.clientX, 340), innerWidth * 0.7)); };
    const up = () => { if (resizing.current) { resizing.current = false; try { localStorage.setItem('detailW', String(panelW)); } catch { /* opcional */ } } };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
    return () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
  }, [panelW]);

  if (!settings || !view) return <div className="loading">Carregando…</div>;

  const commands: Command[] = [
    { id: 'new-task', label: 'Criar tarefa', hint: 'Ctrl+N', run: () => setQuick(true) },
    { id: 'new-note', label: 'Criar anotação', hint: 'Ctrl+Shift+N', run: () => newNote() },
    ...NAV.map((n) => ({ id: 'go-' + n.id, label: `Ir para ${n.label}`, run: () => go(n.id) })),
    { id: 'theme', label: `Alternar para tema ${settings.theme === 'dark' ? 'claro' : 'escuro'}`, run: () => set({ theme: settings.theme === 'dark' ? 'light' : 'dark' }) },
    { id: 'sidebar', label: 'Recolher/expandir barra lateral', hint: 'Ctrl+B', run: () => set({ sidebarCollapsed: !settings.sidebarCollapsed }) },
  ];

  let body;
  switch (view.id) {
    case 'home': body = <HomeView settings={settings} onOpen={setOpenTask} onQuickAdd={() => setQuick(true)} go={go} openNote={openNote} newNote={() => newNote()} />; break;
    case 'notes': body = <NotesView settings={settings} openNote={openNote} closeNote={closeNote} onOpenTask={setOpenTask} />; break;
    case 'tasks': body = <TasksView settings={settings} onOpen={setOpenTask} onQuickAdd={() => setQuick(true)} />; break;
    case 'kanban': body = <KanbanView onOpen={setOpenTask} />; break;
    case 'projects': body = <ProjectsView go={go} />; break;
    case 'project': body = <ProjectDetailView id={view.arg!} settings={settings} go={go} onOpen={setOpenTask} onQuickAdd={() => setQuick(true)} openNote={openNote} newNote={(pid) => newNote({ project_id: pid })} />; break;
    case 'history': body = <HistoryView onOpen={setOpenTask} openNote={openNote} />; break;
    case 'trash': body = <TrashView />; break;
    case 'settings': body = <SettingsView settings={settings} />; break;
    default: { const u = UPCOMING[view.id]; body = u ? <UpcomingView title={NAV.find((n) => n.id === view.id)!.label} {...u} /> : null; }
  }

  return (
    <div className={`app ${settings.sidebarCollapsed ? 'collapsed' : ''}`}>
      <nav className="sidebar">
        <div className="brand"><span className="logo">W</span>{!settings.sidebarCollapsed && <span>Workspace</span>}</div>
        {NAV.map((n) => (
          <button key={n.id} title={n.label} className={`nav ${view.id === n.id || (view.id === 'project' && n.id === 'projects') ? 'active' : ''} ${UPCOMING[n.id] ? 'soon' : ''}`} onClick={() => go(n.id)}>
            <n.icon size={18} />{!settings.sidebarCollapsed && <span>{n.label}</span>}
            {!settings.sidebarCollapsed && UPCOMING[n.id] && <small className="soon-badge">Etapa {UPCOMING[n.id].stage}</small>}
          </button>
        ))}
        <span className="grow" />
        <button className="nav" title="Recolher (Ctrl+B)" onClick={() => set({ sidebarCollapsed: !settings.sidebarCollapsed })}>
          {settings.sidebarCollapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={18} /><span>Recolher</span></>}
        </button>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="searchbox" onClick={() => setPalette(true)}><Search size={14} /> Pesquisar ou executar comando… <kbd>Ctrl+K</kbd></button>
          <span className="grow" />
          <button className="btn primary" onClick={() => setQuick(true)} title="Adição rápida (Ctrl+N)"><Plus size={16} /> Adicionar</button>
        </header>
        <div className="content">
          <main className={view.id === 'notes' ? 'fill' : 'scroll'}><Suspense fallback={<div className="loading">Carregando…</div>}>{body}</Suspense></main>
          {openTask && (
            <div className="detail-wrap" style={{ width: panelW }}>
              <div className="resizer" onMouseDown={() => { resizing.current = true; }} title="Arraste para redimensionar" />
              <TaskDetailPanel id={openTask} onClose={() => setOpenTask(null)} openNote={openNote} newNote={(tid) => newNote({ task_id: tid })} />
            </div>
          )}
        </div>
      </div>
      {quick && <QuickAdd onClose={() => setQuick(false)} onCreated={(id) => view.id !== 'home' && setOpenTask(id)} />}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} openTask={setOpenTask} openProject={(id) => go('project', id)} openNote={openNote} />}
    </div>
  );
}
