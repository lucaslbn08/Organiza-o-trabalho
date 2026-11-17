import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import {
  Bold, Italic, Underline, Strikethrough, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, Quote, Code2, Minus,
  Link2, Table as TableIcon, ImagePlus, Undo2, Redo2, Highlighter, Palette, Pin, Star, Copy, Trash2, History, X, Save,
} from 'lucide-react';
import type { Note } from '../../shared/types';
import { STATUS_LABEL } from '../../shared/types';
import { api, useQuery, useAutosave, fmtDateTime } from '../lib/api';
import { useUi } from '../lib/ui';

export const editorExtensions = [
  StarterKit.configure({ link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] } }),
  TextStyle, Color, Highlight.configure({ multicolor: true }),
  TableKit.configure({ table: { resizable: true } }),
  Image.configure({ allowBase64: false }),
  TaskList, TaskItem.configure({ nested: true }),
];

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
const HIGHLIGHTS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8'];

async function saveImage(file: File): Promise<string> {
  return api().media.save(new Uint8Array(await file.arrayBuffer()), file.type);
}

type CanvasNav = { openCanvas: (k: 'drawing' | 'board', id: number) => void; newCanvas: (k: 'drawing' | 'board', noteId: number) => void };
export function NoteEditor({ id, onOpenTask, onClose, ...nav }: { id: number; onOpenTask: (id: number) => void; onClose?: () => void } & CanvasNav) {
  const { data: note, error } = useQuery(() => api().notes.get(id), [id]);
  // uma falha ao *recarregar* não desmonta um editor que já tem dados (evita perder o que está sendo digitado)
  if (error && !note) return <div className="note-pane empty">Anotação indisponível (pode estar na lixeira).</div>;
  if (!note) return <div className="note-pane" />;
  return <Inner key={note.id} note={note} onOpenTask={onOpenTask} onClose={onClose} {...nav} />;
}

function B({ on, title, act, children }: { on?: boolean; title: string; act: () => void; children: React.ReactNode }) {
  return <button className={`tb ${on ? 'on' : ''}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={act}>{children}</button>;
}

function Inner({ note, onOpenTask, onClose, openCanvas, newCanvas }: { note: Note; onOpenTask: (id: number) => void; onClose?: () => void } & CanvasNav) {
  const ui = useUi();
  const [title, setTitle] = useState(note.title);
  const [json, setJson] = useState(note.content_json);
  const [tags, setTags] = useState(note.tags.map((t) => t.name).join(', '));
  const [showVersions, setShowVersions] = useState(false);
  const known = useRef({ rev: note.revision, sent: note.content_json, base: '', inflight: 0 });
  const { data: projects = [] } = useQuery(() => api().projects.list());
  const { data: folders = [] } = useQuery(() => api().notes.folders());
  const { data: categories = [] } = useQuery(() => api().categories.list());
  const { data: fresh } = useQuery(() => api().notes.get(note.id), [note.id]);
  const { data: allTasks = [] } = useQuery(() => api().tasks.list({ showCompleted: true, sort: 'title' }));
  const { data: drawings = [] } = useQuery(() => api().canvases.list('drawing', { note_id: note.id }), [note.id]);
  const { data: boards = [] } = useQuery(() => api().canvases.list('board', { note_id: note.id }), [note.id]);

  const insertFiles = (ed: Editor, files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    imgs.forEach(async (f) => { const src = await ui.run(saveImage(f)); if (src) ed.chain().focus().setImage({ src, alt: f.name }).run(); });
    return imgs.length > 0;
  };

  const edRef = useRef<Editor | null>(null);
  const editor: Editor | null = useEditor({
    extensions: editorExtensions,
    content: JSON.parse(note.content_json),
    shouldRerenderOnTransaction: true,
    onCreate: ({ editor: e }) => { known.current.base = JSON.stringify(e.getJSON()); },
    onUpdate: ({ editor: e }) => setJson(JSON.stringify(e.getJSON())),
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true' },
      handlePaste: (_v, ev) => (edRef.current && ev.clipboardData ? insertFiles(edRef.current, [...ev.clipboardData.files]) : false),
      handleDrop: (_v, ev) => (edRef.current && (ev as DragEvent).dataTransfer ? insertFiles(edRef.current, [...(ev as DragEvent).dataTransfer!.files]) : false),
      handleClick: (_v, _p, ev) => {
        const a = (ev.target as HTMLElement).closest('a');
        if (a && (ev.ctrlKey || ev.metaKey)) { ui.run(window.openExternal(a.href)); return true; }
        return false;
      },
    },
  });

  edRef.current = editor;
  const saveState = useAutosave({ title, json, tags }, async (v) => {
    known.current.inflight++; known.current.sent = v.json; known.current.base = v.json;
    try {
      const r = await api().notes.update(note.id, { title: v.title, content_json: v.json, tags: v.tags.split(',') });
      known.current.rev = Math.max(known.current.rev, r.revision);
    } finally { known.current.inflight--; }
  }, 600);

  // alterações vindas de fora (restaurar versão, outra janela): recarrega se não houver edição local pendente
  useEffect(() => {
    if (!fresh || !editor || fresh.revision <= known.current.rev) return;
    if (fresh.content_json === known.current.sent) { known.current.rev = fresh.revision; return; }
    // só aplica se não houver edição local ainda não enviada nem gravação em andamento
    if (known.current.inflight || JSON.stringify(editor.getJSON()) !== known.current.base) return;
    known.current.rev = fresh.revision; known.current.sent = fresh.content_json;
    editor.commands.setContent(JSON.parse(fresh.content_json), { emitUpdate: false });
    known.current.base = JSON.stringify(editor.getJSON());
    setTitle(fresh.title);
  }, [fresh, editor]);

  const meta = fresh ?? note;
  const upd = (p: Parameters<ReturnType<typeof api>['notes']['update']>[1]) => ui.run(api().notes.update(note.id, p));
  const fileRef = useRef<HTMLInputElement>(null);
  if (!editor) return null;

  const c = () => editor.chain().focus();

  return (
    <div className="note-pane">
      <div className="note-top row">
        <span className={`save-state ${saveState}`}>{saveState === 'saved' ? `Salvo · ${fmtDateTime(meta.updated_at)}` : saveState === 'pending' ? 'Salvando…' : 'Erro ao salvar'}</span>
        <span className="grow" />
        <button className={`icon ${meta.pinned ? 'active' : ''}`} title={meta.pinned ? 'Desafixar' : 'Fixar'} onClick={() => upd({ pinned: !meta.pinned })}><Pin size={16} /></button>
        <button className={`icon ${meta.favorite ? 'active' : ''}`} title={meta.favorite ? 'Remover dos favoritos' : 'Favoritar'} onClick={() => upd({ favorite: !meta.favorite })}><Star size={16} /></button>
        <button className="icon" title="Histórico de versões" onClick={() => setShowVersions(!showVersions)}><History size={16} /></button>
        <button className="icon" title="Duplicar" onClick={() => ui.run(api().notes.duplicate(note.id), 'Anotação duplicada')}><Copy size={16} /></button>
        <button className="icon" title="Enviar para a lixeira" onClick={async () => { await ui.run(api().notes.remove(note.id), 'Anotação enviada para a lixeira'); onClose?.(); }}><Trash2 size={16} /></button>
      </div>
      <input className="title-input" placeholder="Sem título" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="note-meta">
        <select value={meta.folder_id ?? ''} onChange={(e) => upd({ folder_id: e.target.value ? Number(e.target.value) : null })} title="Pasta">
          <option value="">Sem pasta</option>{folders.map((f) => <option key={f.id} value={f.id}>{folderPath(folders, f.id)}</option>)}</select>
        <select value={meta.project_id ?? ''} onChange={(e) => upd({ project_id: e.target.value ? Number(e.target.value) : null })} title="Projeto">
          <option value="">Sem projeto</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select value={meta.category_id ?? ''} onChange={(e) => upd({ category_id: e.target.value ? Number(e.target.value) : null })} title="Categoria">
          <option value="">Sem categoria</option>{categories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <input className="grow" placeholder="Etiquetas, separadas por vírgula" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <div className="note-meta">
        <small className="muted">Tarefas:</small>
        {(fresh?.tasks ?? note.tasks).map((t) => (
          <span key={t.id} className="pill"><button className="link" onClick={() => onOpenTask(t.id)}>{t.title}</button> <small className="muted">{STATUS_LABEL[t.status]}</small>
            <button className="icon ghost" title="Desvincular" onClick={() => ui.run(api().notes.unlinkTask(note.id, t.id))}><X size={11} /></button></span>
        ))}
        <select value="" onChange={(e) => e.target.value && ui.run(api().notes.linkTask(note.id, Number(e.target.value)))} title="Vincular tarefa">
          <option value="">+ vincular tarefa</option>{allTasks.filter((t) => !(fresh?.tasks ?? []).some((x) => x.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
      </div>

      <div className="note-meta">
        <small className="muted">Desenhos:</small>
        {[...drawings, ...boards].map((c) => <span key={c.kind + c.id} className="pill"><button className="link" onClick={() => openCanvas(c.kind, c.id)}>{c.title || 'Sem título'}</button>&nbsp;</span>)}
        <button className="btn" style={{ padding: '1px 8px', fontSize: '.85em' }} onClick={() => newCanvas('drawing', note.id)}>+ desenho</button>
      </div>
      <div className="toolbar-ed" role="toolbar" aria-label="Formatação">
        <B title="Desfazer (Ctrl+Z)" act={() => c().undo().run()}><Undo2 size={15} /></B>
        <B title="Refazer (Ctrl+Y)" act={() => c().redo().run()}><Redo2 size={15} /></B><span className="sep" />
        <B on={editor.isActive('heading', { level: 1 })} title="Título" act={() => c().toggleHeading({ level: 1 }).run()}><Heading1 size={15} /></B>
        <B on={editor.isActive('heading', { level: 2 })} title="Subtítulo" act={() => c().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></B>
        <B on={editor.isActive('heading', { level: 3 })} title="Seção" act={() => c().toggleHeading({ level: 3 }).run()}><Heading3 size={15} /></B><span className="sep" />
        <B on={editor.isActive('bold')} title="Negrito (Ctrl+B)" act={() => c().toggleBold().run()}><Bold size={15} /></B>
        <B on={editor.isActive('italic')} title="Itálico (Ctrl+I)" act={() => c().toggleItalic().run()}><Italic size={15} /></B>
        <B on={editor.isActive('underline')} title="Sublinhado (Ctrl+U)" act={() => c().toggleUnderline().run()}><Underline size={15} /></B>
        <B on={editor.isActive('strike')} title="Tachado" act={() => c().toggleStrike().run()}><Strikethrough size={15} /></B>
        <span className="tb-pop" title="Cor do texto"><Palette size={15} />
          <span className="pop">{COLORS.map((x) => <button key={x} style={{ background: x }} onMouseDown={(e) => e.preventDefault()} onClick={() => c().setColor(x).run()} aria-label={x} />)}
            <button className="clear" onMouseDown={(e) => e.preventDefault()} onClick={() => c().unsetColor().run()}>×</button></span></span>
        <span className="tb-pop" title="Destaque"><Highlighter size={15} />
          <span className="pop">{HIGHLIGHTS.map((x) => <button key={x} style={{ background: x }} onMouseDown={(e) => e.preventDefault()} onClick={() => c().toggleHighlight({ color: x }).run()} aria-label={x} />)}
            <button className="clear" onMouseDown={(e) => e.preventDefault()} onClick={() => c().unsetHighlight().run()}>×</button></span></span>
        <span className="sep" />
        <B on={editor.isActive('bulletList')} title="Lista com marcadores" act={() => c().toggleBulletList().run()}><List size={15} /></B>
        <B on={editor.isActive('orderedList')} title="Lista numerada" act={() => c().toggleOrderedList().run()}><ListOrdered size={15} /></B>
        <B on={editor.isActive('taskList')} title="Checklist" act={() => c().toggleTaskList().run()}><ListChecks size={15} /></B>
        <B on={editor.isActive('blockquote')} title="Citação" act={() => c().toggleBlockquote().run()}><Quote size={15} /></B>
        <B on={editor.isActive('codeBlock')} title="Bloco de código" act={() => c().toggleCodeBlock().run()}><Code2 size={15} /></B>
        <B title="Separador" act={() => c().setHorizontalRule().run()}><Minus size={15} /></B><span className="sep" />
        <B on={editor.isActive('link')} title="Link (Ctrl+clique abre)" act={() => {
          const prev = editor.getAttributes('link').href as string | undefined;
          const url = prompt('Endereço do link (vazio remove)', prev ?? 'https://');
          if (url === null) return;
          if (!url.trim()) c().unsetLink().run();
          else if (/^(https?:|mailto:)/i.test(url.trim())) c().extendMarkRange('link').setLink({ href: url.trim() }).run();
          else ui.toast('Use um endereço http(s) ou mailto.', 'error');
        }}><Link2 size={15} /></B>
        <B title="Inserir tabela 3×3" act={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={15} /></B>
        <B title="Inserir imagem (ou cole/arraste)" act={() => fileRef.current?.click()}><ImagePlus size={15} /></B>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden multiple onChange={(e) => { insertFiles(editor, [...(e.target.files ?? [])]); e.target.value = ''; }} />
        {editor.isActive('table') && <>
          <span className="sep" />
          <button className="tb txt" onClick={() => c().addRowAfter().run()}>+ linha</button>
          <button className="tb txt" onClick={() => c().addColumnAfter().run()}>+ coluna</button>
          <button className="tb txt" onClick={() => c().deleteRow().run()}>− linha</button>
          <button className="tb txt" onClick={() => c().deleteColumn().run()}>− coluna</button>
          <button className="tb txt" onClick={() => c().deleteTable().run()}>excluir tabela</button>
        </>}
      </div>
      <div className="note-body">
        <EditorContent editor={editor} className="editor" />
        {showVersions && <Versions noteId={note.id} onClose={() => setShowVersions(false)} />}
      </div>
    </div>
  );
}

export function folderPath(folders: { id: number; parent_id: number | null; name: string }[], id: number): string {
  const parts: string[] = []; let cur = folders.find((f) => f.id === id); let guard = 0;
  while (cur && guard++ < 50) { parts.unshift(cur.name); cur = folders.find((f) => f.id === cur!.parent_id); }
  return parts.join(' / ');
}

function Versions({ noteId, onClose }: { noteId: number; onClose: () => void }) {
  const ui = useUi();
  const { data: versions = [] } = useQuery(() => api().notes.versions(noteId), [noteId]);
  const [sel, setSel] = useState<number | null>(null);
  const { data: preview } = useQuery(() => (sel ? api().notes.versionContent(sel) : Promise.resolve(null)), [sel]);
  const viewer = useEditor({ extensions: editorExtensions, editable: false, content: '' });
  useEffect(() => { if (viewer && preview) viewer.commands.setContent(JSON.parse(preview.content_json)); }, [viewer, preview]);
  const REASON: Record<string, string> = { auto: 'automática', manual: 'manual', 'antes de restaurar': 'antes de restaurar' };
  return (
    <aside className="versions">
      <div className="row"><strong>Versões</strong><span className="grow" />
        <button className="btn" title="Salvar uma versão agora" onClick={() => ui.run(api().notes.snapshot(noteId), 'Versão salva')}><Save size={14} /> Salvar versão</button>
        <button className="icon" onClick={onClose}><X size={14} /></button></div>
      <small className="muted">Versões automáticas são criadas a cada 10 minutos de edição (até 100 por nota).</small>
      <ul>
        {versions.length === 0 && <li className="muted">Nenhuma versão anterior ainda.</li>}
        {versions.map((v) => (
          <li key={v.id} className={sel === v.id ? 'sel' : ''} onClick={() => setSel(v.id)}>
            {fmtDateTime(v.created_at)} <small className="muted">· {REASON[v.reason] ?? v.reason}</small>
          </li>
        ))}
      </ul>
      {sel && preview && (
        <>
          <div className="row"><strong className="grow">{preview.title || 'Sem título'}</strong>
            <button className="btn primary" onClick={async () => { if (await ui.confirm('Restaurar esta versão? O conteúdo atual será guardado como uma nova versão.')) { await ui.run(api().notes.restoreVersion(sel), 'Versão restaurada'); setSel(null); } }}>Restaurar</button></div>
          <EditorContent editor={viewer} className="editor preview" />
        </>
      )}
    </aside>
  );
}
