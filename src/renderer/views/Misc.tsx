import { RotateCcw, Trash2, FolderOpen, ShieldCheck } from 'lucide-react';
import type { Settings } from '../../shared/types';
import { api, useQuery, fmtDateTime } from '../lib/api';
import { useUi } from '../lib/ui';

export function TrashView() {
  const ui = useUi();
  const { data: items = [] } = useQuery(() => api().trash.list());
  return (
    <div className="view">
      <header className="view-h"><h2>Lixeira</h2><span className="grow" />
        <button className="btn danger" disabled={!items.length} onClick={async () => { if (await ui.confirm(`Excluir permanentemente ${items.length} item(ns)? Esta ação não pode ser desfeita.`, true)) ui.run(api().trash.empty(), 'Lixeira esvaziada'); }}>Esvaziar lixeira</button>
      </header>
      {items.length === 0 ? <div className="empty">A lixeira está vazia.</div> : (
        <table className="table"><thead><tr><th>Tipo</th><th>Item</th><th>Excluído em</th><th /></tr></thead><tbody>
          {items.map((i) => (
            <tr key={i.entity_type + i.id}>
              <td>{({ task: 'Tarefa', project: 'Projeto', note: 'Anotação', canvas: 'Desenho/quadro', attachment: 'Arquivo' } as const)[i.entity_type]}</td><td>{i.title}</td><td>{fmtDateTime(i.deleted_at)}</td>
              <td className="row end">
                <button className="btn" onClick={() => ui.run(api().trash.restore(i.entity_type, i.id), 'Restaurado')}><RotateCcw size={14} /> Restaurar</button>
                <button className="btn danger" onClick={async () => { if (await ui.confirm(`Excluir "${i.title}" permanentemente?`, true)) ui.run(api().trash.purge(i.entity_type, i.id)); }}><Trash2 size={14} /></button>
              </td>
            </tr>))}
        </tbody></table>
      )}
    </div>
  );
}

const ENTITY: Record<string, string> = { task: 'Tarefa', project: 'Projeto', workspace: 'Espaço', trash: 'Lixeira', note: 'Anotação', folder: 'Pasta', drawing: 'Desenho', board: 'Quadro', attachment: 'Arquivo' };
export function HistoryView({ onOpen, openNote, openCanvas }: { onOpen: (id: number) => void; openNote: (id: number) => void; openCanvas: (k: 'drawing' | 'board', id: number) => void }) {
  const { data: h = [] } = useQuery(() => api().history.list(300));
  return (
    <div className="view">
      <header className="view-h"><h2>Histórico de alterações</h2></header>
      <table className="table"><tbody>
        {h.map((e) => (
          <tr key={e.id} className={['task', 'note', 'drawing', 'board'].includes(e.entity_type) ? 'clickable' : ''} onClick={() => { if (e.entity_type === 'task') onOpen(e.entity_id); else if (e.entity_type === 'note') openNote(e.entity_id); else if (e.entity_type === 'drawing' || e.entity_type === 'board') openCanvas(e.entity_type, e.entity_id); }}>
            <td className="muted nowrap">{fmtDateTime(e.created_at)}</td><td>{ENTITY[e.entity_type] ?? e.entity_type} #{e.entity_id}</td><td>{e.action}</td><td className="muted">{e.details}</td>
          </tr>))}
      </tbody></table>
    </div>
  );
}

const ACCENTS = ['#6366f1', '#3b82f6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#a855f7'];
export function SettingsView({ settings }: { settings: Settings }) {
  const ui = useUi();
  const { data: info } = useQuery(() => api().app.info());
  const { data: workspaces = [] } = useQuery(() => api().workspaces.list());
  const set = (p: Partial<Settings>) => ui.run(api().settings.set(p));
  return (
    <div className="view">
      <header className="view-h"><h2>Configurações</h2></header>
      <section className="card settings">
        <h4>Aparência</h4>
        <label className="row">Tema
          <select value={settings.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}><option value="dark">Escuro</option><option value="light">Claro</option></select></label>
        <div className="row">Cor principal <div className="swatches">{ACCENTS.map((c) => <button key={c} className={c === settings.accent ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => set({ accent: c })} aria-label={c} />)}</div></div>
        <label className="row">Escala da interface
          <input type="range" min={0.8} max={1.3} step={0.05} value={settings.uiScale} onChange={(e) => set({ uiScale: Number(e.target.value) })} /> {Math.round(settings.uiScale * 100)}%</label>
        <label className="row"><input type="checkbox" checked={settings.animations} onChange={(e) => set({ animations: e.target.checked })} /> Animações</label>
      </section>
      <section className="card settings">
        <h4>Notificações e lembretes</h4>
        <label className="row"><input type="checkbox" checked={settings.notificationsEnabled} onChange={(e) => set({ notificationsEnabled: e.target.checked })} /> Ativar lembretes e avisos de prazo</label>
        <label className="row"><input type="checkbox" disabled={!settings.notificationsEnabled} checked={settings.systemNotifications} onChange={(e) => set({ systemNotifications: e.target.checked })} /> Mostrar também nas notificações do Windows</label>
        <label className="row"><input type="checkbox" disabled={!settings.notificationsEnabled} checked={settings.dueReminderTime !== null} onChange={(e) => set({ dueReminderTime: e.target.checked ? '09:00' : null })} /> Avisar no dia do prazo às
          <input type="time" disabled={!settings.notificationsEnabled || settings.dueReminderTime === null} value={settings.dueReminderTime ?? '09:00'} onChange={(e) => e.target.value && set({ dueReminderTime: e.target.value })} /></label>
        <small className="muted">Tarefas com horário definido avisam nesse horário. Lembretes específicos são criados no painel de cada tarefa ou na agenda. As notificações do Windows dependem da permissão do sistema (Configurações → Sistema → Notificações).</small>
      </section>
      <section className="card settings">
        <h4>Espaços de trabalho</h4>
        <p className="muted">Cada espaço separa tarefas, projetos, categorias e colunas do Kanban.</p>
        <div className="row">
          <select value={settings.activeWorkspaceId} onChange={(e) => set({ activeWorkspaceId: Number(e.target.value) })}>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          <button className="btn" onClick={async () => { const n = prompt('Nome do novo espaço de trabalho'); if (n?.trim()) { const w = await ui.run(api().workspaces.create(n)); if (w) set({ activeWorkspaceId: w.id }); } }}>Novo espaço</button>
        </div>
      </section>
      <section className="card settings">
        <h4>Dados</h4>
        <p>Local de armazenamento: <code>{info?.dataDir}</code></p>
        <div className="row">
          <button className="btn" onClick={() => ui.run(api().app.openDataDir())}><FolderOpen size={14} /> Abrir pasta de dados</button>
          <button className="btn" onClick={async () => { const r = await ui.run(api().db.checkIntegrity()); if (r) ui.toast(r.message, r.ok ? 'ok' : 'error'); }}><ShieldCheck size={14} /> Verificar integridade</button>
        </div>
        <p className="muted">Backup completo em ZIP e restauração: implementação prevista na Etapa 5 (ainda não disponível nesta versão). Backups preventivos automáticos já são criados antes de cada migração do banco.</p>
      </section>
      <section className="card settings">
        <h4>Aplicativo</h4>
        <p>Versão {info?.version} · Banco de dados v{info?.dbVersion} · Electron {info?.electron} · {info?.platform}</p>
      </section>
    </div>
  );
}

export function UpcomingView({ title, stage, items }: { title: string; stage: number; items: string[] }) {
  return (
    <div className="view">
      <header className="view-h"><h2>{title}</h2></header>
      <div className="card upcoming">
        <p><strong>Ainda não implementado.</strong> Este módulo faz parte da Etapa {stage} do plano de desenvolvimento.</p>
        <p className="muted">Escopo previsto:</p>
        <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
      </div>
    </div>
  );
}
