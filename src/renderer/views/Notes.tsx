import { highlight } from '../lib/text';
import { useState } from 'react';
import { Plus, Search, Folder, FolderPlus, Star, FileText, Pin, X, Columns2, ChevronRight, ChevronDown } from 'lucide-react';
import type { NoteFolder, Settings, NoteQuery } from '../../shared/types';
import { api, useQuery, fmtDateTime } from '../lib/api';
import { useUi } from '../lib/ui';
import { NoteEditor } from '../components/NoteEditor';

type Filter = { kind: 'all' } | { kind: 'fav' } | { kind: 'root' } | { kind: 'folder'; id: number } | { kind: 'tag'; name: string };

export function NotesView({ settings, openNote, closeNote, onOpenTask }: {
  settings: Settings; openNote: (id: number) => void; closeNote: (id: number) => void; onOpenTask: (id: number) => void;
}) {
  const ui = useUi();
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [split, setSplit] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const q: NoteQuery = { search: search || undefined };
  if (filter.kind === 'fav') q.favorites = true;
  if (filter.kind === 'root') q.folder_id = null;
  if (filter.kind === 'folder') q.folder_id = filter.id;
  if (filter.kind === 'tag') q.tag = filter.name;
  const { data: notes = [] } = useQuery(() => api().notes.list(q), [JSON.stringify(q)]);
  const { data: folders = [] } = useQuery(() => api().notes.folders());
  const { data: tags = [] } = useQuery(() => api().tags.list());
  const { data: titles = [] } = useQuery(() => api().notes.list({}));
  const open = settings.openNotes.filter((id) => titles.some((n) => n.id === id));
  const active = settings.activeNote && open.includes(settings.activeNote) ? settings.activeNote : open[open.length - 1] ?? null;
  const second = split ? open.filter((x) => x !== active).at(-1) : undefined;

  const create = async () => {
    const n = await ui.run(api().notes.create({ folder_id: filter.kind === 'folder' ? filter.id : null }));
    if (n) openNote(n.id);
  };
  const newFolder = async (parent: number | null) => {
    const name = prompt(parent ? 'Nome da subpasta' : 'Nome da pasta');
    if (name?.trim()) ui.run(api().notes.createFolder(name, parent));
  };

  const tree = (parent: number | null, depth: number): React.ReactNode =>
    folders.filter((f) => f.parent_id === parent).map((f) => {
      const kids = folders.some((x) => x.parent_id === f.id);
      return (
        <div key={f.id}>
          <button className={`tree-item ${filter.kind === 'folder' && filter.id === f.id ? 'active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => setFilter({ kind: 'folder', id: f.id })}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { const nid = Number(e.dataTransfer.getData('note')); const fid = Number(e.dataTransfer.getData('folder'));
              if (nid) ui.run(api().notes.update(nid, { folder_id: f.id })); else if (fid && fid !== f.id) ui.run(api().notes.moveFolder(fid, f.id)); }}
            draggable onDragStart={(e) => e.dataTransfer.setData('folder', String(f.id))}
            onContextMenu={(e) => ui.menu(e, folderMenu(f))}>
            <span className="chev" onClick={(e) => { e.stopPropagation(); const s = new Set(collapsed); s.has(f.id) ? s.delete(f.id) : s.add(f.id); setCollapsed(s); }}>
              {kids ? (collapsed.has(f.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />) : null}</span>
            <Folder size={14} /> <span>{f.name}</span>
          </button>
          {!collapsed.has(f.id) && tree(f.id, depth + 1)}
        </div>
      );
    });
  const folderMenu = (f: NoteFolder) => [
    { label: 'Nova subpasta', onClick: () => newFolder(f.id) },
    { label: 'Renomear', onClick: () => { const n = prompt('Novo nome', f.name); if (n?.trim()) ui.run(api().notes.renameFolder(f.id, n)); } },
    ...(f.parent_id ? [{ label: 'Mover para a raiz', onClick: () => ui.run(api().notes.moveFolder(f.id, null)) }] : []),
    { label: 'Excluir pasta (mantém as notas)', danger: true, onClick: async () => {
      if (await ui.confirm(`Excluir a pasta "${f.name}"? As notas e subpastas serão movidas para a pasta acima.`, true)) { await ui.run(api().notes.removeFolder(f.id)); setFilter({ kind: 'all' }); }
    } },
  ];

  return (
    <div className="notes-layout">
      <aside className="notes-nav">
        <button className="btn primary block" onClick={create}><Plus size={16} /> Nova anotação</button>
        <button className={`tree-item ${filter.kind === 'all' ? 'active' : ''}`} onClick={() => setFilter({ kind: 'all' })}><FileText size={14} /> Todas</button>
        <button className={`tree-item ${filter.kind === 'fav' ? 'active' : ''}`} onClick={() => setFilter({ kind: 'fav' })}><Star size={14} /> Favoritas</button>
        <button className={`tree-item ${filter.kind === 'root' ? 'active' : ''}`} onClick={() => setFilter({ kind: 'root' })}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const nid = Number(e.dataTransfer.getData('note')); const fid = Number(e.dataTransfer.getData('folder'));
            if (nid) ui.run(api().notes.update(nid, { folder_id: null })); else if (fid) ui.run(api().notes.moveFolder(fid, null)); }}><FileText size={14} /> Sem pasta</button>
        <div className="row nav-h"><small>PASTAS</small><span className="grow" /><button className="icon" title="Nova pasta" onClick={() => newFolder(null)}><FolderPlus size={14} /></button></div>
        {tree(null, 0)}
        {folders.length === 0 && <small className="muted pad">Nenhuma pasta.</small>}
        {tags.length > 0 && <div className="nav-h"><small>ETIQUETAS</small></div>}
        <div className="tag-cloud">{tags.map((t) => <button key={t.id} className={`chip ${filter.kind === 'tag' && filter.name === t.name ? 'on' : ''}`} onClick={() => setFilter({ kind: 'tag', name: t.name })}>#{t.name}</button>)}</div>
      </aside>

      <section className="notes-list">
        <div className="search"><Search size={14} /><input placeholder="Pesquisar no conteúdo das notas…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="list-scroll">
          {notes.length === 0 && <div className="empty small">Nenhuma anotação. <button className="link" onClick={create}>Criar</button></div>}
          {notes.map((n) => (
            <div key={n.id} className={`note-item ${n.id === active ? 'active' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData('note', String(n.id))}
              onClick={() => openNote(n.id)} onContextMenu={(e) => ui.menu(e, [
                { label: 'Abrir', onClick: () => openNote(n.id) },
                { label: n.pinned ? 'Desafixar' : 'Fixar', onClick: () => ui.run(api().notes.update(n.id, { pinned: !n.pinned })) },
                { label: n.favorite ? 'Remover dos favoritos' : 'Favoritar', onClick: () => ui.run(api().notes.update(n.id, { favorite: !n.favorite })) },
                { label: 'Duplicar', onClick: () => ui.run(api().notes.duplicate(n.id), 'Anotação duplicada') },
                { label: 'Enviar para a lixeira', danger: true, onClick: async () => { await ui.run(api().notes.remove(n.id)); closeNote(n.id); } },
              ])}>
              <div className="row">{n.pinned ? <Pin size={12} className="accent" /> : null}{n.favorite ? <Star size={12} className="accent" /> : null}
                <strong className="grow ellipsis">{n.title || 'Sem título'}</strong></div>
              <small className="excerpt" dangerouslySetInnerHTML={{ __html: highlight(n.excerpt) }} />
              <small className="muted">{fmtDateTime(n.updated_at)}{n.tags.map((t) => ` #${t.name}`).join('')}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="notes-editor">
        <div className="note-tabs">
          {open.map((id) => {
            const t = titles.find((n) => n.id === id);
            return (
              <div key={id} className={`note-tab ${id === active ? 'active' : ''} ${id === second ? 'second' : ''}`} onClick={() => openNote(id)}
                onAuxClick={(e) => e.button === 1 && closeNote(id)}>
                <span className="ellipsis">{t?.title || 'Sem título'}</span>
                <button className="icon ghost" title="Fechar" onClick={(e) => { e.stopPropagation(); closeNote(id); }}><X size={12} /></button>
              </div>
            );
          })}
          <span className="grow" />
          <button className={`icon ${split ? 'active' : ''}`} title="Lado a lado (mostra as duas últimas abas)" disabled={open.length < 2} onClick={() => setSplit(!split)}><Columns2 size={16} /></button>
        </div>
        <div className={`editors ${second ? 'split' : ''}`}>
          {active ? <NoteEditor id={active} onOpenTask={onOpenTask} onClose={() => closeNote(active)} /> :
            <div className="empty">Selecione uma anotação ou <button className="link" onClick={create}>crie uma nova</button>.</div>}
          {second && <NoteEditor id={second} onOpenTask={onOpenTask} onClose={() => closeNote(second)} />}
        </div>
      </section>
    </div>
  );
}

