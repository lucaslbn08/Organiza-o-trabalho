import { useState } from 'react';
import { Paperclip, Link2, FileWarning, X } from 'lucide-react';
import type { AttachmentTarget, ImportResult } from '../../shared/types';
import { api, useQuery } from '../lib/api';
import { useUi } from '../lib/ui';
import { fmtSize } from './FilePreview';

/** Arquivos ligados a uma tarefa/nota/projeto/quadro, com arrastar e soltar do Windows. */
export function AttachmentsSection({ target, onPreview, compact }: { target: { type: AttachmentTarget; id: number }; onPreview: (id: number) => void; compact?: boolean }) {
  const ui = useUi();
  const { data: files = [] } = useQuery(() => api().files.list({ target }), [target.type, target.id]);
  const { data: library = [] } = useQuery(() => api().files.list({}));
  const [over, setOver] = useState(false);
  const report = (r: ImportResult | undefined) => {
    if (!r) return;
    if (r.imported.length) ui.toast(`${r.imported.length} arquivo(s) adicionado(s).`);
    r.errors.forEach((e) => ui.toast(`${e.name}: ${e.message}`, 'error'));
  };
  return (
    <section className={`attachments ${over ? 'drop-over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void dropFiles([...e.dataTransfer.files], target, ui).then(report); }}>
      {!compact && <h4>Arquivos anexados</h4>}
      {files.map((f) => (
        <div key={f.id} className="check-row file-row">
          {f.missing ? <FileWarning size={14} className="danger-text" /> : f.mode === 'internal' ? <Paperclip size={14} /> : <Link2 size={14} />}
          <a href="#" onClick={(e) => { e.preventDefault(); onPreview(f.id); }} title={f.mode === 'internal' ? 'Cópia na biblioteca interna' : 'Vínculo com o arquivo original'}>{f.name}</a>
          <small className="muted">{f.missing ? 'ausente' : fmtSize(f.size)}</small>
          <button className="icon ghost" title="Desvincular (o arquivo continua na biblioteca)" onClick={() => ui.run(api().files.unlink(f.id, target.type, target.id))}><X size={12} /></button>
        </div>
      ))}
      <div className="row">
        <button className="btn" title="Copia o arquivo para a biblioteca interna (entra no backup)" onClick={() => ui.run(api().files.pick('internal', target)).then(report)}><Paperclip size={14} /> Copiar arquivo</button>
        <button className="btn" title="Cria só um vínculo com o arquivo original (não é copiado)" onClick={() => ui.run(api().files.pick('link', target)).then(report)}><Link2 size={14} /> Vincular arquivo</button>
        <select value="" onChange={(e) => e.target.value && ui.run(api().files.link(Number(e.target.value), target.type, target.id))}>
          <option value="">Da biblioteca…</option>{library.filter((l) => !files.some((f) => f.id === l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      </div>
      <small className="muted">Arraste arquivos do Windows para cá (são copiados para a biblioteca).</small>
    </section>
  );
}

/** Arquivos soltos na janela: com caminho real → copia pelo processo principal; sem caminho → envia os bytes. */
export async function dropFiles(files: File[], target: { type: AttachmentTarget; id: number } | undefined, ui: ReturnType<typeof useUi>, mode: 'internal' | 'link' = 'internal'): Promise<ImportResult | undefined> {
  const withPath = files.map((f) => ({ f, p: api().files.pathForFile(f) }));
  const paths = withPath.filter((x) => x.p).map((x) => x.p);
  const res: ImportResult = { imported: [], errors: [] };
  if (paths.length) { const r = await ui.run(api().files.importPaths(paths, mode, target)); if (r) { res.imported.push(...r.imported); res.errors.push(...r.errors); } }
  for (const { f } of withPath.filter((x) => !x.p)) {
    try { res.imported.push(await api().files.importBytes(f.name, new Uint8Array(await f.arrayBuffer()), f.type, target)); }
    catch (e) { res.errors.push({ name: f.name, message: (e as Error).message }); }
  }
  return res;
}
