import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Home, ListTodo, Columns3, StickyNote, PenTool, Infinity as InfIcon, CalendarDays, FolderKanban, Paperclip,
  History, Trash2, Settings as Gear, PanelLeftClose, PanelLeftOpen, Search, Plus, X, Camera, Bell, NotebookPen, Columns2, Rows2,
} from 'lucide-react';
import type { AppTab, Reminder, Settings } from '../shared/types';
import { api, useQuery, flushAll } from './lib/api';
import { useUi } from './lib/ui';
import { HomeView } from './views/Home';
import { TasksView } from './views/Tasks';
import { KanbanView } from './views/Kanban';
import { ProjectsView, ProjectDetailView } from './views/Projects';
import { TrashView, HistoryView } from './views/Misc';
import { SettingsView } from './views/Settings';
import { resolveShortcuts, comboFor, type ShortcutAction } from './lib/shortcuts';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TaskDetailPanel } from './components/TaskDetail';
import { QuickAdd } from './components/QuickAdd';
import { CommandPalette, type Command } from './components/CommandPalette';
import { NotificationCenterPanel } from './components/NotificationCenter';
import { FloatingNotesPanel } from './components/FloatingNotesPanel';
import { CaptureDialog } from './components/CaptureDialog';
import { FilePreview } from './components/FilePreview';
const CanvasesView = lazy(() => import('./views/Canvases').then((m) => ({ default: m.CanvasesView })));
const NotesView = lazy(() => import('./views/Notes').then((m) => ({ default: m.NotesView })));
const AgendaView = lazy(() => import('./views/Agenda').then((m) => ({ default: m.AgendaView })));
const FilesView = lazy(() => import('./views/Files').then((m) => ({ default: m.FilesView })));

export const NAV = [
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
const newTabId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const FILL_VIEWS = new Set(['notes']);

export function App() {
  const ui = useUi();
  const { data: settings } = useQuery(() => api().settings.get());
  const { data: projects = [] } = useQuery(() => api().projects.list());
  const { data: center } = useQuery(() => api().reminders.center());
  const [tabs, setTabs] = useState<AppTab[] | null>(null);
  const [active, setActive] = useState('');
  const [split, setSplit] = useState<Settings['split']>(null);
  const [focusPane, setFocusPane] = useState<'main' | 'split'>('main');
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [quick, setQuick] = useState(false);
  const [palette, setPalette] = useState(false);
  const [popover, setPopover] = useState<'none' | 'bell' | 'floating'>('none');
  const [capture, setCapture] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [fired, setFired] = useState<Reminder[]>([]);
  const [dragTab, setDragTab] = useState<string | null>(null);
  const [panelW, setPanelW] = useState(() => { try { return Number(localStorage.getItem('detailW')) || 440; } catch { return 440; } });
  const resizing = useRef(false);

  // estado inicial das abas vem das preferências (restauração da sessão)
  useEffect(() => {
    if (!settings || tabs) return;
    const t = settings.tabs?.length ? settings.tabs : [{ id: 't1', view: settings.lastView || 'home' }];
    setTabs(t); setActive(t.some((x) => x.id === settings.activeTab) ? settings.activeTab : t[0].id);
    setSplit(settings.split && t.some((x) => x.id === settings.split!.tabId) ? settings.split : null);
  }, [settings, tabs]);
  // persiste a organização das abas/painéis
  useEffect(() => {
    if (!tabs) return;
    const h = setTimeout(() => { void api().settings.set({ tabs, activeTab: active, split }).catch(() => undefined); }, 300);
    return () => clearTimeout(h);
  }, [tabs, active, split]);

  useEffect(() => { api().onFlushRequest(flushAll); }, []);
  // resultado de uma restauração aplicada na inicialização
  useEffect(() => { api().backup.lastResult().then((r) => { if (r) ui.toast(r.message + (r.previousDir ? ` Dados anteriores guardados em: ${r.previousDir}` : ''), r.ok ? 'ok' : 'error'); }).catch(() => undefined); }, [ui]);
  useEffect(() => {
    if (!settings) return;
    const r = document.documentElement;
    r.dataset.theme = settings.theme;
    r.style.setProperty('--accent', settings.accent);
    r.style.fontSize = `${14 * settings.uiScale}px`;
    r.classList.toggle('no-anim', !settings.animations);
  }, [settings]);

  const go = useCallback((view: string, arg?: number) => {
    const target = focusPane === 'split' && split ? split.tabId : active;
    setTabs((ts) => ts!.map((t) => (t.id === target ? { id: t.id, view, ...(arg ? { arg } : {}) } : t)));
  }, [active, split, focusPane]);
  const openInNewTab = useCallback((view: string, arg?: number) => {
    const id = newTabId();
    setTabs((ts) => [...ts!, { id, view, ...(arg ? { arg } : {}) }].slice(-20)); setActive(id); setFocusPane('main');
  }, []);
  const closeTab = (id: string) => {
    setTabs((ts) => {
      if (ts!.length === 1) return [{ id: ts![0].id, view: 'home' }];
      const i = ts!.findIndex((t) => t.id === id); const rest = ts!.filter((t) => t.id !== id);
      if (id === active) setActive((split && rest.find((t) => t.id !== split.tabId)?.id) || rest[Math.max(0, i - 1)].id);
      return rest;
    });
    if (split?.tabId === id) setSplit(null);
  };
  const splitWith = (id: string, dir: 'vertical' | 'horizontal') => {
    if (id === active) { const other = tabs!.find((t) => t.id !== id); if (!other) { const nid = newTabId(); setTabs((ts) => [...ts!, { id: nid, view: 'home' }]); setSplit({ tabId: nid, dir }); return; } setActive(other.id); }
    setSplit({ tabId: id, dir });
  };

  const set = (p: Partial<Settings>) => ui.run(api().settings.set(p));
  const openNote = useCallback((id: number) => {
    if (!settings) return;
    const list = settings.openNotes.includes(id) ? settings.openNotes : [...settings.openNotes, id].slice(-12);
    ui.run(api().settings.set({ openNotes: list, activeNote: id }));
    go('notes');
  }, [settings, ui, go]);
  const closeNote = useCallback((id: number) => {
    if (!settings) return;
    const list = settings.openNotes.filter((x) => x !== id);
    ui.run(api().settings.set({ openNotes: list, activeNote: settings.activeNote === id ? list.at(-1) ?? null : settings.activeNote }));
  }, [settings, ui]);
  const openCanvas = useCallback((kind: 'drawing' | 'board', id: number | null) => {
    if (!settings) return;
    ui.run(api().settings.set({ openCanvas: { ...settings.openCanvas, [kind]: id } }));
    go(kind === 'drawing' ? 'drawings' : 'boards');
  }, [settings, ui, go]);
  const newCanvas = async (kind: 'drawing' | 'board', extra: { project_id?: number; task_id?: number; note_id?: number } = {}) => {
    const c = await ui.run(api().canvases.create({ kind, ...extra })); if (c) openCanvas(kind, c.id);
  };
  const newNote = async (extra: { project_id?: number; task_id?: number } = {}) => { const n = await ui.run(api().notes.create(extra)); if (n) openNote(n.id); };
  const newFloating = () => ui.run(api().floating.create({}), 'Nota flutuante aberta');

  // eventos do processo principal: lembretes e cliques em notificações do Windows
  useEffect(() => api().onEvent((e) => {
    if (e.type === 'reminder') setFired((f) => [...f.filter((x) => x.id !== e.reminder.id), e.reminder]);
    else if (e.type === 'notice') ui.toast(`${e.title}: ${e.body}`);
    else if (e.type === 'navigate') { if (e.view === 'task' && e.id) setOpenTask(e.id); else go(e.view); }
  }), [ui, go]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.altKey) return;
      const t = e.target as HTMLElement;
      if (e.ctrlKey && e.key === 'Tab' && tabs) { e.preventDefault(); const i = tabs.findIndex((x) => x.id === active); setActive(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id); return; }
      if (t.closest?.('.kbd-btn')) return; // gravando um atalho nas configurações
      const combo = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join('+').toUpperCase();
      const action = settings ? resolveShortcuts(settings.shortcuts)[combo] : undefined;
      if (!action) return;
      const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      // enquanto se digita, só atalhos globais "seguros"; Ctrl+B, Ctrl+1… pertencem ao editor
      if (typing && !(['palette', 'quickTask', 'newNote', 'capture', 'newFloating'] as ShortcutAction[]).includes(action)) return;
      e.preventDefault();
      const run: Record<ShortcutAction, () => void> = {
        palette: () => setPalette(true), quickTask: () => setQuick(true), newNote: () => void newNote(), newFloating: () => void newFloating(),
        capture: () => setCapture(true), newTab: () => openInNewTab('home'), closeTab: () => closeTab(active),
        sidebar: () => settings && set({ sidebarCollapsed: !settings.sidebarCollapsed }),
        goHome: () => go('home'), goTasks: () => go('tasks'), goKanban: () => go('kanban'), goProjects: () => go('projects'), goAgenda: () => go('agenda'),
      };
      run[action]();
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  });

  useEffect(() => {
    const move = (e: MouseEvent) => { if (resizing.current) setPanelW(Math.min(Math.max(innerWidth - e.clientX, 340), innerWidth * 0.7)); };
    const up = () => { if (resizing.current) { resizing.current = false; try { localStorage.setItem('detailW', String(panelW)); } catch { /* opcional */ } } };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
    return () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
  }, [panelW]);

  const tabLabel = useMemo(() => (t: AppTab) => {
    if (t.view === 'project') return projects.find((p) => p.id === t.arg)?.name ?? 'Projeto';
    return NAV.find((n) => n.id === t.view)?.label ?? t.view;
  }, [projects]);

  if (!settings || !tabs) return <div className="loading">Carregando…</div>;
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0];
  const splitTab = split ? tabs.find((t) => t.id === split.tabId) : undefined;
  const focusedView = (focusPane === 'split' && splitTab ? splitTab : activeTab).view;

  const commands: Command[] = [
    { id: 'new-task', label: 'Criar tarefa', hint: comboFor(settings.shortcuts, 'quickTask'), run: () => setQuick(true) },
    { id: 'new-note', label: 'Criar anotação', hint: comboFor(settings.shortcuts, 'newNote'), run: () => newNote() },
    { id: 'new-floating', label: 'Nova nota flutuante', hint: comboFor(settings.shortcuts, 'newFloating'), run: newFloating },
    { id: 'backup', label: 'Backup e restauração', run: () => { try { localStorage.setItem('settingsCat', 'data'); } catch { /* opcional */ } go('settings'); } },
    { id: 'new-drawing', label: 'Criar desenho', run: () => newCanvas('drawing') },
    { id: 'new-board', label: 'Criar quadro infinito', run: () => newCanvas('board') },
    { id: 'capture', label: 'Capturar tela', hint: comboFor(settings.shortcuts, 'capture'), run: () => setCapture(true) },
    { id: 'attach', label: 'Adicionar arquivos à biblioteca', run: () => ui.run(api().files.pick('internal')).then(() => go('files')) },
    { id: 'new-tab', label: 'Nova aba', hint: comboFor(settings.shortcuts, 'newTab'), run: () => openInNewTab('home') },
    { id: 'split-v', label: 'Dividir área de trabalho lado a lado', run: () => splitWith(newSplitTarget(), 'vertical') },
    { id: 'split-h', label: 'Dividir área de trabalho na horizontal', run: () => splitWith(newSplitTarget(), 'horizontal') },
    ...(split ? [{ id: 'unsplit', label: 'Fechar divisão', run: () => setSplit(null) }] : []),
    ...NAV.map((n) => ({ id: 'go-' + n.id, label: `Ir para ${n.label}`, run: () => go(n.id) })),
    { id: 'theme', label: `Alternar para tema ${settings.theme === 'dark' ? 'claro' : 'escuro'}`, run: () => set({ theme: settings.theme === 'dark' ? 'light' : 'dark' }) },
    { id: 'sidebar', label: 'Recolher/expandir barra lateral', hint: comboFor(settings.shortcuts, 'sidebar'), run: () => set({ sidebarCollapsed: !settings.sidebarCollapsed }) },
  ];
  function newSplitTarget() {
    const other = tabs!.find((t) => t.id !== active);
    if (other) return other.id;
    const nid = newTabId(); setTabs((ts) => [...ts!, { id: nid, view: 'home' }]); return nid;
  }

  const renderView = (t: AppTab) => {
    switch (t.view) {
      case 'home': return <HomeView settings={settings} onOpen={setOpenTask} onQuickAdd={() => setQuick(true)} go={go} openNote={openNote} newNote={() => newNote()} openCanvas={openCanvas} />;
      case 'drawings': case 'boards': {
        const kind = t.view === 'drawings' ? 'drawing' : 'board';
        return <CanvasesView kind={kind} settings={settings} openId={settings.openCanvas[kind]} setOpen={(id) => openCanvas(kind, id)}
          onOpenTask={setOpenTask} onOpenNote={openNote} onOpenBoard={(id) => openCanvas('board', id)} onOpenFile={setPreview} />;
      }
      case 'notes': return <NotesView settings={settings} openNote={openNote} closeNote={closeNote} onOpenTask={setOpenTask} openCanvas={openCanvas} newCanvas={(k, nid) => newCanvas(k, { note_id: nid })} onOpenFile={setPreview} />;
      case 'tasks': return <TasksView settings={settings} onOpen={setOpenTask} onQuickAdd={() => setQuick(true)} />;
      case 'kanban': return <KanbanView onOpen={setOpenTask} />;
      case 'agenda': return <AgendaView onOpenTask={setOpenTask} />;
      case 'files': return <FilesView onPreview={setPreview} />;
      case 'projects': return <ProjectsView go={go} />;
      case 'project': return <ProjectDetailView id={t.arg!} settings={settings} go={go} onOpen={setOpenTask} onQuickAdd={() => setQuick(true)} openNote={openNote} newNote={(pid) => newNote({ project_id: pid })} openCanvas={openCanvas} newCanvas={(k, extra) => newCanvas(k, extra)} onOpenFile={setPreview} />;
      case 'history': return <HistoryView onOpen={setOpenTask} openNote={openNote} openCanvas={openCanvas} />;
      case 'trash': return <TrashView />;
      case 'settings': return <SettingsView settings={settings} />;
      default: return null;
    }
  };
  const isFill = (t: AppTab) => FILL_VIEWS.has(t.view) || ((t.view === 'drawings' || t.view === 'boards') && !!settings.openCanvas[t.view === 'drawings' ? 'drawing' : 'board']);
  const pane = (t: AppTab, which: 'main' | 'split') => (
    <main key={which + t.id} className={`pane ${isFill(t) ? 'fill' : 'scroll'} ${split && focusPane === which ? 'focused' : ''}`} onMouseDownCapture={() => setFocusPane(which)}>
      <ErrorBoundary key={t.view + (t.arg ?? '')} label={t.view}><Suspense fallback={<div className="loading">Carregando…</div>}>{renderView(t)}</Suspense></ErrorBoundary>
    </main>
  );
  const navClick = (e: React.MouseEvent, id: string) => { if (e.ctrlKey || e.button === 1) openInNewTab(id); else go(id); };

  return (
    <div className={`app ${settings.sidebarCollapsed ? 'collapsed' : ''}`}>
      <nav className="sidebar">
        <div className="brand"><span className="logo">W</span>{!settings.sidebarCollapsed && <span>Workspace</span>}</div>
        {NAV.map((n) => (
          <button key={n.id} title={`${n.label} (Ctrl+clique: nova aba)`} className={`nav ${focusedView === n.id || (focusedView === 'project' && n.id === 'projects') ? 'active' : ''}`}
            onClick={(e) => navClick(e, n.id)} onAuxClick={(e) => e.button === 1 && navClick(e, n.id)}
            onContextMenu={(e) => ui.menu(e, [{ label: 'Abrir em nova aba', onClick: () => openInNewTab(n.id) }, { label: 'Abrir ao lado', onClick: () => { const id = newTabId(); setTabs((ts) => [...ts!, { id, view: n.id }]); setSplit({ tabId: id, dir: 'vertical' }); } }])}>
            <n.icon size={18} />{!settings.sidebarCollapsed && <span>{n.label}</span>}
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
          <button className="icon" title="Capturar tela" onClick={() => setCapture(true)}><Camera size={18} /></button>
          <div className="pop-anchor">
            <button className="icon" title="Notas flutuantes" onClick={() => setPopover(popover === 'floating' ? 'none' : 'floating')}><NotebookPen size={18} /></button>
            {popover === 'floating' && <FloatingNotesPanel onClose={() => setPopover('none')} />}
          </div>
          <div className="pop-anchor">
            <button className={`icon bell ${center?.count ? 'has' : ''}`} title="Central de notificações" onClick={() => setPopover(popover === 'bell' ? 'none' : 'bell')}>
              <Bell size={18} />{!!center?.count && <span className="badge">{center.count > 99 ? '99+' : center.count}</span>}
            </button>
            {popover === 'bell' && center && <NotificationCenterPanel center={center} onClose={() => setPopover('none')} onOpenTask={(id) => { setOpenTask(id); setPopover('none'); }} goAgenda={() => { go('agenda'); setPopover('none'); }} />}
          </div>
          <button className="btn primary" onClick={() => setQuick(true)} title="Adição rápida (Ctrl+N)"><Plus size={16} /> Adicionar</button>
        </header>
        <div className="tabbar" role="tablist">
          {tabs.map((t) => (
            <div key={t.id} role="tab" aria-selected={t.id === active} draggable
              className={`apptab ${t.id === active ? 'active' : ''} ${split?.tabId === t.id ? 'in-split' : ''}`}
              onClick={() => { if (split?.tabId === t.id) setFocusPane('split'); else { setActive(t.id); setFocusPane('main'); } }}
              onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
              onDragStart={() => setDragTab(t.id)} onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (!dragTab || dragTab === t.id) return; setTabs((ts) => { const a = ts!.filter((x) => x.id !== dragTab); a.splice(a.findIndex((x) => x.id === t.id), 0, ts!.find((x) => x.id === dragTab)!); return a; }); setDragTab(null); }}
              onContextMenu={(e) => ui.menu(e, [
                { label: 'Dividir lado a lado', onClick: () => splitWith(t.id, 'vertical') },
                { label: 'Dividir na horizontal', onClick: () => splitWith(t.id, 'horizontal') },
                ...(split ? [{ label: 'Fechar divisão', onClick: () => setSplit(null) }] : []),
                { label: 'Duplicar aba', onClick: () => openInNewTab(t.view, t.arg) },
                { label: 'Fechar outras abas', onClick: () => { setTabs([t]); setActive(t.id); setSplit(null); } },
                { label: 'Fechar', danger: true, onClick: () => closeTab(t.id) },
              ])}>
              <span className="ellipsis">{tabLabel(t)}</span>
              <button className="icon ghost" title="Fechar aba (Ctrl+W)" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><X size={12} /></button>
            </div>
          ))}
          <button className="icon" title="Nova aba (Ctrl+T)" onClick={() => openInNewTab('home')}><Plus size={14} /></button>
          <span className="grow" />
          {split ? <button className="icon" title="Fechar divisão" onClick={() => setSplit(null)}><X size={14} /></button> : <>
            <button className="icon" title="Dividir lado a lado" onClick={() => splitWith(newSplitTarget(), 'vertical')}><Columns2 size={15} /></button>
            <button className="icon" title="Dividir na horizontal" onClick={() => splitWith(newSplitTarget(), 'horizontal')}><Rows2 size={15} /></button></>}
        </div>
        <div className="content">
          <div className={`panes ${split ? 'split-' + split.dir : ''}`}>
            {pane(activeTab, 'main')}
            {splitTab && splitTab.id !== activeTab.id && pane(splitTab, 'split')}
          </div>
          {openTask && (
            <div className="detail-wrap" style={{ width: panelW }}>
              <div className="resizer" onMouseDown={() => { resizing.current = true; }} title="Arraste para redimensionar" />
              <ErrorBoundary key={openTask} label="tarefa"><TaskDetailPanel id={openTask} onClose={() => setOpenTask(null)} openNote={openNote} newNote={(tid) => newNote({ task_id: tid })} openCanvas={openCanvas} newCanvas={(k, tid) => newCanvas(k, { task_id: tid })} onOpenFile={setPreview} /></ErrorBoundary>
            </div>
          )}
        </div>
      </div>
      {fired.length > 0 && (
        <div className="reminder-stack">
          {fired.map((r) => (
            <div key={r.id} className="reminder-toast" role="alert">
              <strong><Bell size={14} /> {r.title}</strong>
              {r.task_title && r.task_title !== r.title && <small className="muted">{r.task_title}</small>}
              <div className="row">
                {r.task_id && <button className="btn" onClick={() => setOpenTask(r.task_id)}>Abrir</button>}
                <button className="btn" onClick={() => { ui.run(api().reminders.snooze(r.id, 10)); setFired((f) => f.filter((x) => x.id !== r.id)); }}>Adiar 10 min</button>
                <button className="btn primary" onClick={() => { ui.run(api().reminders.dismiss(r.id)); setFired((f) => f.filter((x) => x.id !== r.id)); }}>Dispensar</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {quick && <QuickAdd onClose={() => setQuick(false)} onCreated={(id) => activeTab.view !== 'home' && setOpenTask(id)} />}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} openTask={setOpenTask} openProject={(id) => go('project', id)} openNote={openNote} openCanvas={openCanvas} openFile={setPreview} />}
      {capture && <CaptureDialog onClose={() => setCapture(false)} onDone={(msg) => { if (msg.startsWith('note:')) openNote(Number(msg.slice(5))); else ui.toast(msg); }} />}
      {preview && <FilePreview id={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

