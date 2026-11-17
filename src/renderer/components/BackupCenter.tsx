import { useEffect, useState } from 'react';
import { Download, Upload, ShieldCheck, FolderOpen, RotateCcw, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { BackupProgress, BackupVerifyReport } from '../../shared/types';
import { api, useQuery, fmtDateTime } from '../lib/api';
import { useUi } from '../lib/ui';
import { fmtSize } from './FilePreview';

const PHASE: Record<string, string> = { preparando: 'Preparando', banco: 'Copiando o banco de dados', arquivos: 'Compactando arquivos', verificando: 'Verificando o backup', extraindo: 'Extraindo', migrando: 'Atualizando estrutura do banco', 'concluído': 'Concluído' };
const LABEL: Record<string, string> = { tarefas: 'Tarefas', subtarefas: 'Subtarefas e itens de checklist', projetos: 'Projetos', etiquetas: 'Etiquetas', anotacoes: 'Anotações', versoes_de_notas: 'Versões de notas', desenhos: 'Desenhos', quadros: 'Quadros infinitos', imagens: 'Imagens', arquivos: 'Arquivos/anexos', lembretes: 'Lembretes', notas_flutuantes: 'Notas flutuantes', lixeira: 'Itens na lixeira' };

export function BackupCenter() {
  const ui = useUi();
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [busy, setBusy] = useState<'export' | 'verify' | 'restore' | null>(null);
  const [includeLinked, setIncludeLinked] = useState(false);
  const [result, setResult] = useState<{ title: string; ok: boolean; report: BackupVerifyReport; path?: string; size?: number } | null>(null);
  const [restoreReady, setRestoreReady] = useState<{ safety: string } | null>(null);
  const { data: linked } = useQuery(() => api().backup.linkedSummary());
  const { data: history = [] } = useQuery(() => api().backup.history());
  useEffect(() => api().backup.onProgress(setProgress), []);

  const doExport = async () => {
    const dest = await ui.run(api().backup.chooseExport()); if (!dest) return;
    setBusy('export'); setResult(null); setProgress({ phase: 'preparando', done: 0, total: 1 });
    const r = await ui.run(api().backup.export(dest, includeLinked));
    setBusy(null); setProgress(null);
    // a mensagem de sucesso só aparece depois da verificação completa do arquivo gerado
    if (r) { setResult({ title: 'Backup gerado e verificado', ok: true, report: r.report, path: r.path, size: r.size }); ui.toast('Backup concluído e verificado com sucesso.'); }
  };
  const doVerify = async () => {
    const f = await ui.run(api().backup.chooseZip()); if (!f) return;
    setBusy('verify'); setResult(null);
    const r = await ui.run(api().backup.verify(f)); setBusy(null);
    if (r) setResult({ title: r.ok ? 'Backup íntegro' : 'Backup com problemas', ok: r.ok, report: r, path: f });
  };
  const doRestore = async () => {
    const f = await ui.run(api().backup.chooseZip()); if (!f) return;
    setBusy('verify'); setResult(null);
    const r = await ui.run(api().backup.verify(f)); setBusy(null);
    if (!r) return;
    setResult({ title: r.ok ? 'Conteúdo do backup a restaurar' : 'Este backup não pode ser restaurado', ok: r.ok, report: r, path: f });
    if (!r.ok) return;
    const created = r.manifest ? new Date(r.manifest.createdAt).toLocaleString('pt-BR') : '?';
    if (!(await ui.confirm(`Restaurar o backup de ${created}? Os dados atuais serão SUBSTITUÍDOS por este backup. Antes disso, uma cópia de segurança dos dados atuais será criada automaticamente e os dados anteriores também ficam guardados na pasta de dados.`, true))) return;
    setBusy('restore'); setProgress({ phase: 'preparando', done: 0, total: 1 });
    const rr = await ui.run(api().backup.restore(f));
    setBusy(null); setProgress(null);
    if (rr) setRestoreReady({ safety: rr.safetyBackup });
  };

  return (
    <div className="backup-center">
      <p className="muted">O backup é um único arquivo ZIP com banco de dados, anotações, versões, desenhos, quadros, imagens, arquivos da biblioteca interna, preferências e organização da área de trabalho, além de um manifesto com versões e a lista de arquivos (com SHA-256).</p>
      <div className="backup-actions">
        <div className="card">
          <h5><Download size={14} /> Exportar backup completo</h5>
          <label className="row"><input type="checkbox" checked={includeLinked} onChange={(e) => setIncludeLinked(e.target.checked)} disabled={!linked?.count} /> Incluir também os arquivos apenas vinculados</label>
          <small className="muted">{linked?.count ? `${linked.count} arquivo(s) vinculado(s), ${fmtSize(linked.totalSize)}${linked.missing ? `, ${linked.missing} ausente(s)` : ''}. Sem esta opção, só o caminho deles é guardado.` : 'Nenhum arquivo vinculado: todos os anexos estão na biblioteca interna.'}</small>
          <button className="btn primary" disabled={!!busy} onClick={doExport}>Escolher destino e exportar…</button>
        </div>
        <div className="card">
          <h5><ShieldCheck size={14} /> Verificar backup</h5>
          <small className="muted">Confere estrutura, versões, integridade de cada arquivo (SHA-256) e do banco contido, sem alterar nada.</small>
          <button className="btn" disabled={!!busy} onClick={doVerify}>Escolher ZIP e verificar…</button>
        </div>
        <div className="card">
          <h5><Upload size={14} /> Importar e restaurar</h5>
          <small className="muted">Verifica o arquivo, mostra o que será restaurado e pede confirmação. Os dados atuais só são substituídos depois que o backup é validado e preparado.</small>
          <button className="btn danger" disabled={!!busy} onClick={doRestore}><RotateCcw size={14} /> Escolher ZIP e restaurar…</button>
        </div>
      </div>
      {progress && (
        <div className="backup-progress" role="progressbar" aria-valuenow={Math.round((progress.done / Math.max(progress.total, 1)) * 100)}>
          <div className="row"><strong>{PHASE[progress.phase] ?? progress.phase}…</strong><small className="muted ellipsis">{progress.detail}</small></div>
          <div className="bar big"><span style={{ width: `${Math.min(100, (progress.done / Math.max(progress.total, 1)) * 100)}%` }} /></div>
        </div>
      )}
      {restoreReady && (
        <div className="card restore-ready">
          <strong><CheckCircle2 size={16} /> Backup validado e preparado.</strong>
          <p>Para concluir, o Workspace precisa reiniciar. A troca dos dados é feita antes de abrir o banco; se algo falhar, os dados atuais são mantidos.</p>
          <small className="muted">Cópia de segurança dos dados atuais: <code>{restoreReady.safety}</code></small>
          <div className="row end">
            <button className="btn" onClick={async () => { await ui.run(api().backup.cancelPending(), 'Restauração cancelada; nada foi alterado.'); setRestoreReady(null); }}>Cancelar</button>
            <button className="btn primary" onClick={() => ui.run(api().backup.relaunch())}>Reiniciar agora</button>
          </div>
        </div>
      )}
      {result && <ReportView {...result} />}
      <div className="row"><h5 className="grow">Histórico de backups</h5><button className="btn" onClick={() => ui.run(api().backup.openFolder())}><FolderOpen size={14} /> Abrir pasta de backups automáticos</button></div>
      {history.length === 0 ? <p className="muted">Nenhum backup registrado ainda.</p> : (
        <table className="table"><tbody>{history.map((h) => (
          <tr key={h.id}><td className="nowrap muted">{fmtDateTime(h.created_at)}</td>
            <td>{h.kind === 'export' ? 'Exportação' : h.kind === 'safety' ? 'Cópia automática (antes de restaurar)' : 'Restauração preparada'}</td>
            <td className="ellipsis" title={h.path}>{h.path}{!h.exists && <small className="danger-text"> (arquivo não encontrado)</small>}</td>
            <td className="nowrap">{fmtSize(h.size)}</td><td>{h.verified ? <CheckCircle2 size={14} className="ok-text" /> : null}</td></tr>
        ))}</tbody></table>
      )}
    </div>
  );
}

function ReportView({ title, ok, report, path, size }: { title: string; ok: boolean; report: BackupVerifyReport; path?: string; size?: number }) {
  const m = report.manifest;
  return (
    <div className={`card report ${ok ? 'ok' : 'bad'}`}>
      <strong>{ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {title}</strong>
      {path && <small className="muted">{path}{size ? ` · ${fmtSize(size)}` : ''}</small>}
      {m && <small>Criado em {new Date(m.createdAt).toLocaleString('pt-BR')} pela versão {m.appVersion} · banco v{m.dbVersion}{report.needsMigration ? ' (será atualizado automaticamente)' : ''} · {m.files.length} arquivo(s), {fmtSize(report.totalSize)}</small>}
      {Object.keys(report.counts).length > 0 && <ul className="counts">{Object.entries(report.counts).map(([k, v]) => <li key={k}><strong>{v}</strong> {LABEL[k] ?? k}</li>)}</ul>}
      {report.errors.map((e) => <div key={e} className="danger-text">• {e}</div>)}
      {report.warnings.map((w) => <div key={w} className="muted">• {w}</div>)}
      {m && m.linkedNotIncluded.length > 0 && <details><summary>Arquivos vinculados não incluídos ({m.linkedNotIncluded.length})</summary><ul>{m.linkedNotIncluded.map((l) => <li key={l.id}><code>{l.path}</code></li>)}</ul></details>}
    </div>
  );
}
