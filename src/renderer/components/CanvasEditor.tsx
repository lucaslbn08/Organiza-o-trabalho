import { useCallback, useEffect, useRef, useState } from 'react';
import { Excalidraw, exportToBlob, convertToExcalidrawElements, CaptureUpdateAction, getSceneVersion, MainMenu } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI, BinaryFiles, BinaryFileData, AppState } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import { Download, History, Copy, Trash2, Plus, Link2, X, Grid3x3, Mouse, ExternalLink, Save } from 'lucide-react';
import type { Canvas, CanvasKind, Settings, TaskStatus, TaskBrief } from '../../shared/types';
import { STATUS_LABEL, TASK_STATUSES } from '../../shared/types';
import { api, useQuery, registerFlusher, fmtDateTime } from '../lib/api';
import { useUi } from '../lib/ui';
import { dataUrlToBytes, bytesToDataUrl, taskCardLook, titleFromCardText, noteCardText, CHECK_RE, toggleChecklistLine } from '../lib/canvas';

type El = ExcalidrawElement & { customData?: Record<string, unknown> };
type FileMap = Record<string, { hash: string; mimeType: string }>;
interface Scene { elements: El[]; appState: Partial<AppState>; files: FileMap }
interface Nav { onOpenTask: (id: number) => void; onOpenNote: (id: number) => void; onOpenBoard: (id: number) => void }

const KIND_TITLE: Record<CanvasKind, string> = { drawing: 'desenho', board: 'quadro' };
const PERSIST_KEYS = ['scrollX', 'scrollY', 'zoom', 'gridModeEnabled', 'gridSize', 'viewBackgroundColor', 'currentItemStrokeColor', 'currentItemBackgroundColor',
  'currentItemStrokeWidth', 'currentItemFontFamily', 'currentItemFontSize', 'currentItemRoughness', 'objectsSnapModeEnabled'] as const;
const rand = () => Math.floor(Math.random() * 2 ** 31);
const bump = <T extends El>(e: T, patch: Partial<T>): T => ({ ...e, ...patch, version: e.version + 1, versionNonce: rand(), updated: Date.now() });

export function CanvasEditor(props: { id: number; settings: Settings; onClose: () => void } & Nav) {
  const [tick, setTick] = useState(0);
  const { data: canvas, error } = useQuery(() => api().canvases.get(props.id), [props.id, tick]);
  if (error && !canvas) return <div className="empty">Item indisponível (pode estar na lixeira).</div>;
  if (!canvas || canvas.id !== props.id) return <div className="loading">Carregando…</div>;
  return <Inner key={`${canvas.id}-${tick}`} canvas={canvas} {...props} onRestored={() => setTick((t) => t + 1)} />;
}

function Inner({ canvas, settings, onClose, onOpenTask, onOpenNote, onOpenBoard, onRestored }: { canvas: Canvas; settings: Settings; onClose: () => void; onRestored: () => void } & Nav) {
  const ui = useUi();
  const [xapi, setXapi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [title, setTitle] = useState(canvas.title);
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'error'>('saved');
  const [sel, setSel] = useState<El | null>(null);
  const [panel, setPanel] = useState<'none' | 'export' | 'versions' | 'links' | 'insert'>('none');
  const wrapRef = useRef<HTMLDivElement>(null);
  const initial = useRef<Scene>(JSON.parse(canvas.scene_json));
  const r = useRef({
    files: { ...(initial.current.files ?? {}) } as FileMap, sig: '', loaded: false, timer: 0 as unknown as ReturnType<typeof setTimeout>,
    dirty: false, saving: null as Promise<void> | null, lastThumb: 0, expected: new Map<string, string>(), titles: new Map<number, string>(),
    selKey: '', derived: new Set<string>(),
  });
  const { data: projects = [] } = useQuery(() => api().projects.list());
  const isBoard = canvas.kind === 'board';

  // ---------- gravação ----------
  const save = useCallback(async (withThumb = false) => {
    if (!xapi) return;
    clearTimeout(r.current.timer);
    if (r.current.saving) await r.current.saving;
    const run = (async () => {
      r.current.dirty = false;
      const elements = xapi.getSceneElements() as readonly El[];
      const st = xapi.getAppState(); const files = xapi.getFiles();
      // imagens novas vão para a biblioteca interna (deduplicadas por hash)
      for (const e of elements) {
        const fid = (e as { fileId?: string }).fileId;
        if (e.type === 'image' && fid && !r.current.files[fid] && files[fid]) {
          const { bytes, mime } = await dataUrlToBytes(files[fid].dataURL);
          const src = await api().media.save(bytes, mime);
          r.current.files[fid] = { hash: src.slice('ws-media://'.length), mimeType: mime };
        }
      }
      const used = new Set(elements.map((e) => (e as { fileId?: string }).fileId).filter(Boolean));
      const fileMap = Object.fromEntries(Object.entries(r.current.files).filter(([k]) => used.has(k)));
      const appState = Object.fromEntries(PERSIST_KEYS.map((k) => [k, st[k]]));
      if (isBoard) await syncTitlesFromCards(elements);
      let thumbnail: string | undefined;
      if (withThumb || Date.now() - r.current.lastThumb > 20000) {
        r.current.lastThumb = Date.now();
        thumbnail = elements.length ? await makeThumb(elements, st, files) : undefined;
      }
      await api().canvases.update(canvas.id, { scene_json: JSON.stringify({ elements, appState, files: fileMap }), ...(thumbnail ? { thumbnail } : {}) });
      if (isBoard) await syncLinks(elements);
      setSaveState('saved');
    })().catch((e) => { setSaveState('error'); r.current.dirty = true; ui.toast('Erro ao salvar: ' + (e as Error).message, 'error'); });
    r.current.saving = run; await run; r.current.saving = null;
  }, [xapi]); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = useCallback(() => {
    r.current.dirty = true; setSaveState('pending');
    clearTimeout(r.current.timer);
    r.current.timer = setTimeout(() => void save(), 800);
  }, [save]);

  useEffect(() => registerFlusher(async () => { if (r.current.dirty) await save(true); }), [save]);
  useEffect(() => () => { if (r.current.dirty) void save(true); }, [save]);
  useEffect(() => { void api().canvases.touch(canvas.id); }, [canvas.id]);

  async function makeThumb(elements: readonly El[], st: AppState, files: BinaryFiles): Promise<string | undefined> {
    try {
      const blob = await exportToBlob({ elements, appState: { ...st, exportBackground: true, exportWithDarkMode: false }, files, mimeType: 'image/png', maxWidthOrHeight: 360, exportPadding: 16 });
      return await api().media.save(new Uint8Array(await blob.arrayBuffer()), 'image/png');
    } catch { return undefined; }
  }

  // ---------- carregamento das imagens ----------
  useEffect(() => {
    if (!xapi) return;
    (async () => {
      const toAdd: BinaryFileData[] = [];
      for (const [id, f] of Object.entries(r.current.files)) {
        const m = await api().media.get(f.hash).catch(() => null);
        if (m) toAdd.push({ id: id as BinaryFileData['id'], mimeType: f.mimeType as BinaryFileData['mimeType'], dataURL: (await bytesToDataUrl(m.bytes, m.mime)) as BinaryFileData['dataURL'], created: Date.now() });
      }
      if (toAdd.length) xapi.addFiles(toAdd);
      initial.current.elements.forEach((e) => {
        const k = e.customData?.kind; if (k === 'task') r.current.derived.add('task:' + e.customData!.taskId); if (k === 'note') r.current.derived.add('note:' + e.customData!.noteId);
      });
      await refreshLinked();
      r.current.loaded = true;
    })();
  }, [xapi]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- sincronização com tarefas e notas (fonte única: o registro) ----------
  const boundText = (els: readonly El[], c: El) => els.find((e) => e.type === 'text' && (e as { containerId?: string }).containerId === c.id) as (El & { text: string }) | undefined;

  const refreshLinked = useCallback(async () => {
    if (!xapi) return;
    const els = xapi.getSceneElements() as readonly El[];
    const taskIds = els.filter((e) => e.customData?.kind === 'task').map((e) => Number(e.customData!.taskId));
    const noteIds = els.filter((e) => e.customData?.kind === 'note').map((e) => Number(e.customData!.noteId));
    if (!taskIds.length && !noteIds.length) return;
    const [tasks, notes] = await Promise.all([api().briefs.tasks(taskIds), api().briefs.notes(noteIds)]);
    const tMap = new Map(tasks.map((t) => [t.id, t])); const nMap = new Map(notes.map((n) => [n.id, n]));
    const editing = xapi.getAppState().editingTextElement?.id;
    const cur = xapi.getSceneElementsIncludingDeleted() as readonly El[];
    let changed = false;
    const patches = new Map<string, El>();
    for (const c of cur) {
      if (c.isDeleted || (c.customData?.kind !== 'task' && c.customData?.kind !== 'note')) continue;
      const t = boundText(cur, c); if (!t || t.id === editing) continue;
      let text: string; let style: Partial<El> = {};
      if (c.customData.kind === 'task') {
        const brief = tMap.get(Number(c.customData.taskId));
        const look = taskCardLook(brief); text = look.text;
        style = { backgroundColor: look.backgroundColor, strokeColor: look.strokeColor, strokeStyle: look.strokeStyle };
        if (brief) r.current.titles.set(brief.id, brief.title);
      } else text = noteCardText(nMap.get(Number(c.customData.noteId)));
      r.current.expected.set(c.id, text);
      if (t.text !== text) { patches.set(t.id, bump(t, { text, originalText: text } as Partial<El>)); changed = true; }
      if (Object.entries(style).some(([k, v]) => (c as unknown as Record<string, unknown>)[k] !== v)) { patches.set(c.id, bump(c, style)); changed = true; }
    }
    if (changed) xapi.updateScene({ elements: cur.map((e) => patches.get(e.id) ?? e), captureUpdate: CaptureUpdateAction.NEVER });
  }, [xapi]);

  /** Se o usuário editou o texto de um cartão de tarefa no quadro, o título da tarefa é atualizado. */
  async function syncTitlesFromCards(els: readonly El[]) {
    for (const c of els) {
      if (c.customData?.kind !== 'task') continue;
      const t = boundText(els, c); if (!t) continue;
      if (t.text === r.current.expected.get(c.id)) continue;
      const id = Number(c.customData.taskId); const title = titleFromCardText(t.text);
      if (title && title !== r.current.titles.get(id)) { await api().tasks.update(id, { title }).catch(() => undefined); r.current.titles.set(id, title); }
    }
  }
  async function syncLinks(els: readonly El[]) {
    const now = new Set<string>();
    els.forEach((e) => { if (e.customData?.kind === 'task') now.add('task:' + e.customData.taskId); if (e.customData?.kind === 'note') now.add('note:' + e.customData.noteId); });
    for (const k of now) if (!r.current.derived.has(k)) { const [t, i] = k.split(':'); await api().canvases.link(canvas.id, t as 'task', Number(i)).catch(() => undefined); }
    for (const k of r.current.derived) if (!now.has(k)) { const [t, i] = k.split(':'); await api().canvases.unlink(canvas.id, t as 'task', Number(i)).catch(() => undefined); }
    r.current.derived = now;
  }

  useEffect(() => api().onDataChanged((scope) => { if (['tasks', 'notes', 'trash'].includes(scope)) void refreshLinked(); }), [refreshLinked]);

  // ---------- zoom pela roda do mouse (quadros) ----------
  useEffect(() => {
    const el = wrapRef.current; if (!el || !settings.wheelZoom) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.isTrusted || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (!(e.target as HTMLElement).closest('.excalidraw canvas, .excalidraw .excalidraw__canvas')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      e.target!.dispatchEvent(new WheelEvent('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY, ctrlKey: true, bubbles: true, cancelable: true }));
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [settings.wheelZoom]);

  // ---------- onChange: seleção + autosave ----------
  const onChange = (elements: readonly El[], st: AppState) => {
    const ids = Object.keys(st.selectedElementIds ?? {}).filter((k) => st.selectedElementIds[k]);
    let one: El | null = null;
    if (ids.length) {
      const picked = new Set(ids.map((id) => { const e = elements.find((x) => x.id === id); const cid = (e as { containerId?: string } | undefined)?.containerId; return cid ?? id; }));
      if (picked.size === 1) one = elements.find((e) => e.id === [...picked][0]) ?? null;
    }
    const key = one ? `${one.id}:${one.version}` : '';
    if (key !== r.current.selKey) { r.current.selKey = key; setSel(one); }
    const sig = `${getSceneVersion(elements)}|${Math.round(st.scrollX)}|${Math.round(st.scrollY)}|${st.zoom.value}|${st.gridModeEnabled}|${st.viewBackgroundColor}`;
    if (!r.current.sig) { r.current.sig = sig; return; }
    if (sig !== r.current.sig) { r.current.sig = sig; if (r.current.loaded) schedule(); }
  };

  // ---------- inserção ----------
  const center = () => {
    const st = xapi!.getAppState(); const z = st.zoom.value;
    return { x: -st.scrollX + st.width / 2 / z, y: -st.scrollY + st.height / 2 / z };
  };
  const addSkeletons = (sk: ExcalidrawElementSkeleton[]) => {
    if (!xapi) return;
    const els = convertToExcalidrawElements(sk, { regenerateIds: true });
    xapi.updateScene({
      elements: [...xapi.getSceneElementsIncludingDeleted(), ...els],
      appState: { selectedElementIds: { [els[0].id]: true } } as AppState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setPanel('none');
    setTimeout(() => void refreshLinked(), 0);
  };
  /** Posição livre perto do centro da tela: desloca em cascata se já houver um elemento começando ali. */
  const freeSpot = (w: number, h: number) => {
    const c = center(); let x = c.x - w / 2; let y = c.y - h / 2;
    const els = xapi!.getSceneElements();
    for (let i = 0; i < 40 && els.some((e) => Math.abs(e.x - x) < 24 && Math.abs(e.y - y) < 24); i++) { x += 40; y += 40; }
    return { x, y };
  };
  const card = (text: string, extra: Partial<ExcalidrawElementSkeleton>, w = 280, h = 90): ExcalidrawElementSkeleton => {
    const { x, y } = freeSpot(w, h);
    return { type: 'rectangle', x, y, width: w, height: h, roundness: { type: 3 }, strokeWidth: 2, fillStyle: 'solid',
      label: { text, fontSize: 18, textAlign: 'left', verticalAlign: 'middle' }, ...extra } as ExcalidrawElementSkeleton;
  };
  const insertTask = (t: TaskBrief) => { const look = taskCardLook(t); addSkeletons([card(look.text, { backgroundColor: look.backgroundColor, strokeColor: look.strokeColor, customData: { kind: 'task', taskId: t.id } } as Partial<ExcalidrawElementSkeleton>)]); };
  const newTask = async () => {
    const titleIn = prompt('Título da nova tarefa'); if (!titleIn?.trim()) return;
    const t = await ui.run(api().tasks.create({ title: titleIn, project_id: canvas.project_id }));
    if (t) insertTask({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, deleted: false });
  };
  const insertNote = (id: number, text: string) => addSkeletons([card(text, { backgroundColor: '#fff9db', strokeColor: '#f08c00', customData: { kind: 'note', noteId: id } } as Partial<ExcalidrawElementSkeleton>, 300, 120)]);
  const newNote = async () => {
    const n = await ui.run(api().notes.create({ title: prompt('Título da nova anotação') ?? '', project_id: canvas.project_id }));
    if (n) insertNote(n.id, noteCardText({ id: n.id, title: n.title, excerpt: '', deleted: false }));
  };
  const textAt = (text: string, fontSize = 20): ExcalidrawElementSkeleton => { const { x, y } = freeSpot(200, 40); return { type: 'text', x, y, text, fontSize } as ExcalidrawElementSkeleton; };

  // ---------- painel da seleção (elementos interativos) ----------
  const setTaskStatus = async (status: TaskStatus) => { if (sel?.customData?.kind === 'task') await ui.run(api().tasks.update(Number(sel.customData.taskId), { status })); };
  const selText = sel && xapi ? (sel.type === 'text' ? (sel as El & { text: string }) : boundText(xapi.getSceneElements() as readonly El[], sel)) : undefined;
  const checklistLines = sel?.type === 'text' && selText ? selText.text.split('\n') : [];
  const isChecklist = checklistLines.some((l) => CHECK_RE.test(l));
  const [selTask, setSelTask] = useState<TaskBrief | null>(null);
  useEffect(() => {
    if (sel?.customData?.kind !== 'task') { setSelTask(null); return; }
    const id = Number(sel.customData.taskId); let alive = true;
    const load = () => api().briefs.tasks([id]).then(([t]) => alive && setSelTask(t ?? null));
    load(); const off = api().onDataChanged((s) => s === 'tasks' && load());
    return () => { alive = false; off(); };
  }, [sel?.id, sel?.customData?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleLine = (i: number) => {
    if (!xapi || !selText) return;
    const text = toggleChecklistLine(selText.text, i);
    xapi.updateScene({ elements: xapi.getSceneElementsIncludingDeleted().map((e) => (e.id === selText.id ? bump(e as El, { text, originalText: text } as Partial<El>) : e)), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  };

  const titleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onTitle = (v: string) => {
    setTitle(v); setSaveState('pending'); clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => ui.run(api().canvases.update(canvas.id, { title: v })).then(() => setSaveState('saved')), 500);
  };

  return (
    <div className="canvas-editor">
      <header className="canvas-head">
        <button className="btn ghost" onClick={async () => { await save(true); onClose(); }} title="Voltar para a lista">←</button>
        <input className="canvas-title" value={title} placeholder={`Sem título`} onChange={(e) => onTitle(e.target.value)} aria-label={`Título do ${KIND_TITLE[canvas.kind]}`} />
        <span className={`save-state ${saveState}`}>{saveState === 'saved' ? 'Salvo' : saveState === 'pending' ? 'Salvando…' : 'Erro ao salvar'}</span>
        <span className="grow" />
        <select value={canvas.project_id ?? ''} onChange={(e) => ui.run(api().canvases.update(canvas.id, { project_id: e.target.value ? Number(e.target.value) : null }))} title="Projeto">
          <option value="">Sem projeto</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        {isBoard && <button className={`btn ${panel === 'insert' ? 'primary' : ''}`} onClick={() => setPanel(panel === 'insert' ? 'none' : 'insert')}><Plus size={14} /> Inserir</button>}
        <button className="icon" title="Grade (Ctrl+')" onClick={() => xapi?.updateScene({ appState: { gridModeEnabled: !xapi.getAppState().gridModeEnabled } as AppState })}><Grid3x3 size={16} /></button>
        <button className={`icon ${settings.wheelZoom ? 'active' : ''}`} title={settings.wheelZoom ? 'Roda do mouse: zoom (clique para rolar)' : 'Roda do mouse: rolar (clique para zoom)'} onClick={() => ui.run(api().settings.set({ wheelZoom: !settings.wheelZoom }))}><Mouse size={16} /></button>
        <button className="icon" title="Vínculos" onClick={() => setPanel(panel === 'links' ? 'none' : 'links')}><Link2 size={16} /></button>
        <button className="icon" title="Histórico de versões" onClick={() => setPanel(panel === 'versions' ? 'none' : 'versions')}><History size={16} /></button>
        <button className="icon" title="Exportar PNG/PDF" onClick={() => setPanel(panel === 'export' ? 'none' : 'export')}><Download size={16} /></button>
        <button className="icon" title="Duplicar" onClick={async () => { await save(true); await ui.run(api().canvases.duplicate(canvas.id), 'Duplicado'); }}><Copy size={16} /></button>
        <button className="icon" title="Enviar para a lixeira" onClick={async () => { await save(); await ui.run(api().canvases.remove(canvas.id), 'Enviado para a lixeira'); onClose(); }}><Trash2 size={16} /></button>
      </header>

      <div className="canvas-body" ref={wrapRef}>
        <Excalidraw
          excalidrawAPI={setXapi}
          initialData={{ elements: initial.current.elements, appState: { ...initial.current.appState, theme: settings.theme } as AppState, scrollToContent: false }}
          theme={settings.theme}
          langCode="pt-BR"
          onChange={onChange as never}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>

        {sel && (sel.customData?.kind || isChecklist) && (
          <div className="sel-panel" onPointerDown={(e) => e.stopPropagation()}>
            {sel.customData?.kind === 'task' && (selTask && !selTask.deleted ? <>
              <label className="row"><input type="checkbox" checked={selTask.status === 'done'} onChange={(e) => setTaskStatus(e.target.checked ? 'done' : 'pending')} /> <strong className="ellipsis">{selTask.title}</strong></label>
              <select value={selTask.status} onChange={(e) => setTaskStatus(e.target.value as TaskStatus)} aria-label="Status da tarefa">
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
              <button className="btn" onClick={() => onOpenTask(selTask.id)}><ExternalLink size={14} /> Abrir tarefa</button>
            </> : <span className="muted">Tarefa excluída</span>)}
            {sel.customData?.kind === 'note' && <button className="btn" onClick={() => onOpenNote(Number(sel.customData!.noteId))}><ExternalLink size={14} /> Abrir anotação</button>}
            {sel.customData?.kind === 'board' && <button className="btn" onClick={() => onOpenBoard(Number(sel.customData!.boardId))}><ExternalLink size={14} /> Abrir quadro</button>}
            {isChecklist && <div className="sel-check">{checklistLines.map((l, i) => { const m = CHECK_RE.exec(l); return m ? (
              <label key={i} className="row"><input type="checkbox" checked={m[1] === '☑'} onChange={() => toggleLine(i)} /> <span className={m[1] === '☑' ? 'done-text' : ''}>{m[2]}</span></label>) : null; })}</div>}
          </div>
        )}

        {panel === 'insert' && xapi && <InsertPanel canvasId={canvas.id} onClose={() => setPanel('none')}
          onNewTask={newTask} onTask={insertTask} onNewNote={newNote}
          onNote={(n) => insertNote(n.id, noteCardText(n))}
          onSticky={() => addSkeletons([card('Nota adesiva', { backgroundColor: '#ffec99', strokeColor: '#f59f00' } as Partial<ExcalidrawElementSkeleton>, 220, 160)])}
          onText={() => addSkeletons([textAt('Texto')])}
          onChecklist={() => addSkeletons([textAt('☐ Primeiro item\n☐ Segundo item\n☐ Terceiro item', 18)])}
          onBoard={(b) => addSkeletons([card(`↗ ${b.title || 'Quadro sem título'}`, { backgroundColor: '#e7f5ff', strokeColor: '#1c7ed6', customData: { kind: 'board', boardId: b.id } } as Partial<ExcalidrawElementSkeleton>, 260, 70)])}
          onFrame={() => { const { x, y } = center(); addSkeletons([{ type: 'frame', x: x - 300, y: y - 200, width: 600, height: 400, children: [], name: 'Grupo' } as unknown as ExcalidrawElementSkeleton]); }}
        />}
        {panel === 'export' && xapi && <ExportPanel xapi={xapi} name={title || 'sem-titulo'} onClose={() => setPanel('none')} />}
        {panel === 'versions' && <VersionsPanel canvasId={canvas.id} onClose={() => setPanel('none')} beforeRestore={() => save()} onRestored={onRestored} />}
        {panel === 'links' && <LinksPanel canvas={canvas} onClose={() => setPanel('none')} onOpenTask={onOpenTask} onOpenNote={onOpenNote} />}
      </div>
    </div>
  );
}

function Floating({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="float-panel" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
      <div className="row"><strong>{title}</strong><span className="grow" /><button className="icon" onClick={onClose}><X size={14} /></button></div>
      {children}
    </div>
  );
}

function InsertPanel(p: { canvasId: number; onClose: () => void; onNewTask: () => void; onTask: (t: TaskBrief) => void; onNewNote: () => void;
  onNote: (n: { id: number; title: string; excerpt: string; deleted: boolean }) => void; onSticky: () => void; onText: () => void; onChecklist: () => void;
  onBoard: (b: { id: number; title: string }) => void; onFrame: () => void }) {
  const { data: tasks = [] } = useQuery(() => api().tasks.list({ showCompleted: true, sort: 'title' }));
  const { data: notes = [] } = useQuery(() => api().notes.list({}));
  const { data: boards = [] } = useQuery(() => api().canvases.list('board'));
  return (
    <Floating title="Inserir no quadro" onClose={p.onClose}>
      <div className="insert-grid">
        <button className="btn" onClick={p.onNewTask}>+ Nova tarefa</button>
        <button className="btn" onClick={p.onNewNote}>+ Nova anotação</button>
        <button className="btn" onClick={p.onSticky}>Nota adesiva</button>
        <button className="btn" onClick={p.onText}>Caixa de texto</button>
        <button className="btn" onClick={p.onChecklist}>Checklist</button>
        <button className="btn" onClick={p.onFrame}>Quadro/agrupamento</button>
      </div>
      <select value="" onChange={(e) => { const t = tasks.find((x) => x.id === Number(e.target.value)); if (t) p.onTask({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, deleted: false }); }}>
        <option value="">Tarefa existente…</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
      <select value="" onChange={(e) => { const n = notes.find((x) => x.id === Number(e.target.value)); if (n) p.onNote({ id: n.id, title: n.title, excerpt: n.excerpt, deleted: false }); }}>
        <option value="">Anotação existente…</option>{notes.map((n) => <option key={n.id} value={n.id}>{n.title || 'Sem título'}</option>)}</select>
      <select value="" onChange={(e) => { const b = boards.find((x) => x.id === Number(e.target.value)); if (b) p.onBoard(b); }}>
        <option value="">Link para outro quadro…</option>{boards.filter((b) => b.id !== p.canvasId).map((b) => <option key={b.id} value={b.id}>{b.title || 'Sem título'}</option>)}</select>
      <small className="muted">Formas, setas, conectores, desenho livre e imagens ficam na barra de ferramentas. Imagens e capturas também podem ser coladas (Ctrl+V).</small>
    </Floating>
  );
}

function ExportPanel({ xapi, name, onClose }: { xapi: ExcalidrawImperativeAPI; name: string; onClose: () => void }) {
  const ui = useUi();
  const [format, setFormat] = useState<'png' | 'pdf'>('png');
  const [scope, setScope] = useState<'all' | 'selection'>('all');
  const [bg, setBg] = useState(true);
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const all = xapi.getSceneElements() as readonly El[];
      const st = xapi.getAppState();
      let els = all;
      if (scope === 'selection') {
        const ids = new Set(Object.keys(st.selectedElementIds).filter((k) => st.selectedElementIds[k]));
        els = all.filter((e) => ids.has(e.id) || ids.has((e as { containerId?: string }).containerId ?? ''));
        if (!els.length) { ui.toast('Nada selecionado.', 'error'); return; }
      }
      if (!els.length) { ui.toast('Não há conteúdo para exportar.', 'error'); return; }
      // a exportação é ajustada automaticamente aos limites do conteúdo (+ margem)
      const blob = await exportToBlob({ elements: els, appState: { ...st, exportBackground: bg, exportWithDarkMode: false, exportScale: scale }, files: xapi.getFiles(), mimeType: 'image/png', exportPadding: 24 });
      let bytes = new Uint8Array(await blob.arrayBuffer());
      if (format === 'pdf') {
        const { jsPDF } = await import('jspdf');
        const bmp = await createImageBitmap(blob);
        const w = bmp.width / scale, h = bmp.height / scale;
        const pdf = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'px', format: [w, h], hotfixes: ['px_scaling'], compress: true });
        pdf.addImage(bytes, 'PNG', 0, 0, w, h);
        bytes = new Uint8Array(pdf.output('arraybuffer'));
      }
      const path = await api().files.saveAs(bytes, name, format);
      if (path) { ui.toast(`Exportado: ${path}`); onClose(); }
    } catch (e) { ui.toast('Falha na exportação: ' + (e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Floating title="Exportar" onClose={onClose}>
      <label className="row">Formato <select value={format} onChange={(e) => setFormat(e.target.value as 'png')}><option value="png">PNG</option><option value="pdf">PDF</option></select></label>
      <label className="row">Conteúdo <select value={scope} onChange={(e) => setScope(e.target.value as 'all')}><option value="all">Tudo (ajustado ao conteúdo)</option><option value="selection">Somente a seleção</option></select></label>
      <label className="row">Resolução <select value={scale} onChange={(e) => setScale(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option></select></label>
      <label className="row"><input type="checkbox" checked={bg} onChange={(e) => setBg(e.target.checked)} /> Incluir fundo</label>
      <button className="btn primary" disabled={busy} onClick={run}><Download size={14} /> {busy ? 'Exportando…' : 'Exportar…'}</button>
    </Floating>
  );
}

function VersionsPanel({ canvasId, onClose, beforeRestore, onRestored }: { canvasId: number; onClose: () => void; beforeRestore: () => Promise<void>; onRestored: () => void }) {
  const ui = useUi();
  const { data: versions = [] } = useQuery(() => api().canvases.versions(canvasId), [canvasId]);
  const REASON: Record<string, string> = { auto: 'automática', manual: 'manual', 'antes de restaurar': 'antes de restaurar' };
  return (
    <Floating title="Versões" onClose={onClose}>
      <button className="btn" onClick={async () => { await beforeRestore(); await ui.run(api().canvases.snapshot(canvasId), 'Versão salva'); }}><Save size={14} /> Salvar versão agora</button>
      <small className="muted">Automáticas a cada 10 min de edição (até 50).</small>
      <ul className="vlist">
        {versions.length === 0 && <li className="muted">Nenhuma versão anterior.</li>}
        {versions.map((v) => (
          <li key={v.id} className="row">{fmtDateTime(v.created_at)} <small className="muted">· {REASON[v.reason] ?? v.reason} · {Math.ceil(v.size / 1024)} KB</small><span className="grow" />
            <button className="btn" onClick={async () => {
              if (!(await ui.confirm('Restaurar esta versão? O estado atual será guardado como nova versão.'))) return;
              await beforeRestore();
              if (await ui.run(api().canvases.restoreVersion(v.id).then(() => true), 'Versão restaurada')) onRestored();
            }}>Restaurar</button></li>
        ))}
      </ul>
    </Floating>
  );
}

function LinksPanel({ canvas, onClose, onOpenTask, onOpenNote }: { canvas: Canvas; onClose: () => void } & Pick<Nav, 'onOpenTask' | 'onOpenNote'>) {
  const ui = useUi();
  const { data: fresh } = useQuery(() => api().canvases.get(canvas.id), [canvas.id]);
  const { data: tasks = [] } = useQuery(() => api().tasks.list({ showCompleted: true, sort: 'title' }));
  const { data: notes = [] } = useQuery(() => api().notes.list({}));
  const links = fresh?.links ?? canvas.links;
  return (
    <Floating title="Vínculos" onClose={onClose}>
      {links.length === 0 && <small className="muted">Nenhuma tarefa ou anotação vinculada.</small>}
      {links.map((l) => (
        <div key={l.type + l.id} className="check-row">
          <small className="muted">{l.type === 'task' ? 'Tarefa' : 'Anotação'}</small>
          <a href="#" onClick={(e) => { e.preventDefault(); if (l.type === 'task') onOpenTask(l.id); else onOpenNote(l.id); }}>{l.title}</a>
          <button className="icon ghost" title="Desvincular" onClick={() => ui.run(api().canvases.unlink(canvas.id, l.type, l.id))}><X size={12} /></button>
        </div>
      ))}
      <select value="" onChange={(e) => e.target.value && ui.run(api().canvases.link(canvas.id, 'task', Number(e.target.value)))}>
        <option value="">Vincular tarefa…</option>{tasks.filter((t) => !links.some((l) => l.type === 'task' && l.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
      <select value="" onChange={(e) => e.target.value && ui.run(api().canvases.link(canvas.id, 'note', Number(e.target.value)))}>
        <option value="">Vincular anotação…</option>{notes.filter((n) => !links.some((l) => l.type === 'note' && l.id === n.id)).map((n) => <option key={n.id} value={n.id}>{n.title || 'Sem título'}</option>)}</select>
    </Floating>
  );
}
