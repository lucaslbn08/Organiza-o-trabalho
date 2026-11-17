import { useMemo, useState } from 'react';
import { Search, Paperclip, Link2, FileWarning, Folder, FolderOpen, ExternalLink, Eye } from 'lucide-react';
import type { Attachment, ImportResult } from '../../shared/types';
import { api, useQuery, fmtDateTime } from '../lib/api';
import { useUi } from '../lib/ui';
import { fmtSize } from '../components/FilePreview';
import { dropFiles } from '../components/Attachments';

export function FilesView({ onPreview }: { onPreview: (id: number) => void }) {
  const ui = useUi();
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const [missingOnly, setMissingOnly] = useState(false);
  const [dropMode, setDropMode] = useState<'internal' | 'link'>('internal');
  const [over, setOver] = useState(false);
  const q = { search: search || undefined, folder, missingOnly };
  const { data: files = [] } = useQuery(() => api().files.list(q), [JSON.stringify(q)]);
  const { data: all = [] } = useQuery(() => api().files.list({}));
  const folders = useMemo(() => {
    const s = new Set<string>();
    all.forEach((f) => { const parts = f.folder.split('/').filter(Boolean); parts.forEach((_, i) => s.add(parts.slice(0, i + 1).join('/'))); });
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [all]);
  const missingCount = all.filter((f) => f.missing).length;
  const report = (r: ImportResult | undefined) => {
    if (!r) return;
    if (r.imported.length) ui.toast(`${r.imported.length} arquivo(s) adicionado(s).`);
    r.errors.forEach((e) => ui.toast(`${e.name}: ${e.message}`, 'error'));
  };
  const menu = (f: Attachment) => [
    { label: 'Visualizar', onClick: () => onPreview(f.id) },
    { label: 'Abrir com o aplicativo padrão', onClick: () => ui.run(api().files.open(f.id)) },
    { label: 'Mostrar na pasta', onClick: () => ui.run(api().files.reveal(f.id)) },
    { label: 'Renomear identificação', onClick: () => { const n = prompt('Novo nome', f.name); if (n?.trim()) ui.run(api().files.rename(f.id, n)); } },
    { label: 'Mover para pasta…', onClick: () => { const n = prompt('Pasta (use / para subpastas; vazio = raiz)', f.folder); if (n !== null) ui.run(api().files.setFolder(f.id, n)); } },
    ...(f.mode === 'link' ? [{ label: 'Incorporar à biblioteca (copiar)', onClick: () => ui.run(api().files.embed(f.id), 'Arquivo copiado para a biblioteca; agora entra no backup.') }] : []),
    ...(f.missing && f.mode === 'link' ? [{ label: 'Localizar arquivo…', onClick: () => ui.run(api().files.relink(f.id)) }] : []),
    { label: 'Enviar para a lixeira', danger: true, onClick: async () => {
      const msg = f.mode === 'internal' ? `Enviar "${f.name}" para a lixeira? A cópia interna só é apagada ao esvaziar a lixeira.` : `Remover o vínculo "${f.name}"? O arquivo original NÃO será apagado.`;
      if (await ui.confirm(msg, true)) ui.run(api().files.remove(f.id), 'Enviado para a lixeira');
    } },
  ];

  return (
    <div className={`view wide files-view ${over ? 'drop-over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void dropFiles([...e.dataTransfer.files], undefined, ui, dropMode).then(report); }}>
      <header className="view-h"><h2>Arquivos</h2><span className="grow" />
        <button className="btn primary" title="O arquivo é copiado para a pasta de dados do Workspace e entra no backup" onClick={() => ui.run(api().files.pick('internal')).then(report)}><Paperclip size={16} /> Copiar para a biblioteca</button>
        <button className="btn" title="Apenas um atalho para o arquivo original; não é copiado nem incluído no backup" onClick={() => ui.run(api().files.pick('link')).then(report)}><Link2 size={16} /> Vincular arquivo original</button>
      </header>
      <div className="mode-help card">
        <span><Paperclip size={14} /> <strong>Biblioteca interna</strong>: cópia segura dentro dos dados do Workspace (incluída no backup).</span>
        <span><Link2 size={14} /> <strong>Vínculo</strong>: aponta para o arquivo original; se ele for movido, aparece como ausente.</span>
        <label className="row">Ao arrastar do Windows: <select value={dropMode} onChange={(e) => setDropMode(e.target.value as 'internal')}><option value="internal">copiar</option><option value="link">vincular</option></select></label>
      </div>
      <div className="files-layout">
        <aside className="files-folders">
          <button className={`tree-item ${folder === undefined && !missingOnly ? 'active' : ''}`} onClick={() => { setFolder(undefined); setMissingOnly(false); }}><Folder size={14} /> Todos <small className="muted">{all.length}</small></button>
          <button className={`tree-item ${folder === '' ? 'active' : ''}`} onClick={() => { setFolder(''); setMissingOnly(false); }}><Folder size={14} /> Sem pasta</button>
          {folders.map((f) => <button key={f} className={`tree-item ${folder === f ? 'active' : ''}`} style={{ paddingLeft: 8 + (f.split('/').length - 1) * 14 }} onClick={() => { setFolder(f); setMissingOnly(false); }}><FolderOpen size={14} /> {f.split('/').at(-1)}</button>)}
          {missingCount > 0 && <button className={`tree-item ${missingOnly ? 'active' : ''}`} onClick={() => { setMissingOnly(true); setFolder(undefined); }}><FileWarning size={14} className="danger-text" /> Ausentes <small className="muted">{missingCount}</small></button>}
        </aside>
        <section>
          <div className="toolbar"><div className="search"><Search size={14} /><input placeholder="Pesquisar por nome ou pasta…" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
          {files.length === 0 ? <div className="empty">{all.length ? 'Nenhum arquivo encontrado.' : 'Nenhum arquivo ainda. Arraste arquivos do Windows para esta tela ou use os botões acima.'}</div> : (
            <table className="table files-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Tamanho</th><th>Pasta</th><th>Vínculos</th><th>Adicionado</th><th /></tr></thead><tbody>
              {files.map((f) => (
                <tr key={f.id} className={`clickable ${f.missing ? 'missing' : ''}`} onDoubleClick={() => onPreview(f.id)} onContextMenu={(e) => ui.menu(e, menu(f))}>
                  <td><span className="row nowrap">{f.missing ? <FileWarning size={14} className="danger-text" /> : f.mode === 'internal' ? <Paperclip size={14} /> : <Link2 size={14} />}<span className="ellipsis" title={f.stored_path}>{f.name}</span></span></td>
                  <td><span className={`badge-mode ${f.mode}`}>{f.mode === 'internal' ? 'Biblioteca' : 'Vínculo'}</span>{f.missing && <small className="danger-text"> ausente</small>}</td>
                  <td className="nowrap">{fmtSize(f.size)}</td><td className="muted">{f.folder || '—'}</td><td>{f.link_count || ''}</td>
                  <td className="muted nowrap">{fmtDateTime(f.created_at)}</td>
                  <td className="row nowrap end">
                    <button className="icon" title="Visualizar" onClick={() => onPreview(f.id)}><Eye size={14} /></button>
                    <button className="icon" title="Abrir" disabled={f.missing} onClick={() => ui.run(api().files.open(f.id))}><ExternalLink size={14} /></button>
                    {f.missing && f.mode === 'link' && <button className="btn" onClick={() => ui.run(api().files.relink(f.id))}>Localizar…</button>}
                  </td>
                </tr>
              ))}
            </tbody></table>
          )}
        </section>
      </div>
    </div>
  );
}
