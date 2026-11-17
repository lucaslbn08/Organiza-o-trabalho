import { useState } from 'react';
import { FolderOpen, ShieldCheck, RefreshCw } from 'lucide-react';
import type { Settings } from '../../shared/types';
import { api, useQuery } from '../lib/api';
import { useUi } from '../lib/ui';
import { BackupCenter } from '../components/BackupCenter';
import { fmtSize } from '../components/FilePreview';
import { SHORTCUT_ACTIONS, comboFromEvent, comboFor } from '../lib/shortcuts';

const CATS = [['appearance', 'Aparência'], ['interface', 'Interface'], ['data', 'Dados e backup'], ['notifications', 'Notificações'], ['app', 'Aplicativo']] as const;
const ACCENTS = ['#6366f1', '#3b82f6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#a855f7'];
const PANELS: Record<string, string> = { stats: 'Resumo das tarefas', priority: 'Prioritárias', dueSoon: 'Prazos', notes: 'Anotações recentes', drawings: 'Últimos desenhos', boards: 'Quadros infinitos', projects: 'Projetos recentes', shortcuts: 'Atalhos' };

export function SettingsView({ settings }: { settings: Settings }) {
  const ui = useUi();
  const [cat, setCat] = useState<(typeof CATS)[number][0]>(() => { try { return (localStorage.getItem('settingsCat') as 'data') || 'appearance'; } catch { return 'appearance'; } });
  const { data: info } = useQuery(() => api().app.info());
  const { data: workspaces = [] } = useQuery(() => api().workspaces.list());
  const [recording, setRecording] = useState<string | null>(null);
  const [upd, setUpd] = useState<string | null>(null);
  const set = (p: Partial<Settings>) => ui.run(api().settings.set(p));
  const pick = (c: typeof cat) => { setCat(c); try { localStorage.setItem('settingsCat', c); } catch { /* opcional */ } };
  const usedBy = (combo: string, except: string) => SHORTCUT_ACTIONS.find((a) => a.id !== except && comboFor(settings.shortcuts, a.id).toUpperCase() === combo.toUpperCase());

  return (
    <div className="view settings-view">
      <header className="view-h"><h2>Configurações</h2></header>
      <div className="settings-layout">
        <nav className="settings-cats">{CATS.map(([id, l]) => <button key={id} className={`tree-item ${cat === id ? 'active' : ''}`} onClick={() => pick(id)}>{l}</button>)}</nav>
        <div>
          {cat === 'appearance' && <section className="card settings">
            <h4>Aparência</h4>
            <label className="row">Tema <select value={settings.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}><option value="dark">Escuro</option><option value="light">Claro</option></select></label>
            <div className="row">Cor principal <div className="swatches">{ACCENTS.map((c) => <button key={c} className={c === settings.accent ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => set({ accent: c })} aria-label={c} />)}</div></div>
            <label className="row">Escala da interface <input type="range" min={0.8} max={1.3} step={0.05} value={settings.uiScale} onChange={(e) => set({ uiScale: Number(e.target.value) })} /> {Math.round(settings.uiScale * 100)}%</label>
            <label className="row"><input type="checkbox" checked={settings.animations} onChange={(e) => set({ animations: e.target.checked })} /> Animações</label>
          </section>}

          {cat === 'interface' && <>
            <section className="card settings">
              <h4>Página inicial</h4>
              {settings.dashboardPanels.map((p) => <label key={p.id} className="row"><input type="checkbox" checked={p.visible} onChange={(e) => set({ dashboardPanels: settings.dashboardPanels.map((x) => x.id === p.id ? { ...x, visible: e.target.checked } : x) })} /> {PANELS[p.id] ?? p.id}</label>)}
              <small className="muted">A ordem pode ser alterada arrastando os painéis em Início → Personalizar.</small>
            </section>
            <section className="card settings">
              <h4>Abas e painéis</h4>
              <p className="muted">Abas abertas: {settings.tabs.length}{settings.split ? ` · área dividida ${settings.split.dir === 'vertical' ? 'lado a lado' : 'na horizontal'}` : ''}. A organização é restaurada ao reabrir.</p>
              <label className="row"><input type="checkbox" checked={settings.wheelZoom} onChange={(e) => set({ wheelZoom: e.target.checked })} /> Roda do mouse aproxima/afasta nos desenhos e quadros</label>
              <button className="btn" onClick={() => set({ tabs: [{ id: 't1', view: 'home' }], activeTab: 't1', split: null })}>Fechar todas as abas e a divisão</button>
            </section>
            <section className="card settings">
              <h4>Atalhos de teclado</h4>
              <table className="table shortcuts-table"><tbody>{SHORTCUT_ACTIONS.map((a) => (
                <tr key={a.id}><td>{a.label}</td>
                  <td><button className={`btn kbd-btn ${recording === a.id ? 'primary' : ''}`} onClick={() => setRecording(a.id)}
                    onKeyDown={(e) => {
                      if (recording !== a.id) return;
                      e.preventDefault(); e.stopPropagation();
                      if (e.key === 'Escape') { setRecording(null); return; }
                      const combo = comboFromEvent(e); if (!combo) return;
                      if (!e.ctrlKey && !e.altKey) { ui.toast('Use uma combinação com Ctrl ou Alt.', 'error'); return; }
                      const other = usedBy(combo, a.id); if (other) { ui.toast(`${combo} já é usado por “${other.label}”.`, 'error'); return; }
                      set({ shortcuts: { ...settings.shortcuts, [a.id]: combo } }); setRecording(null);
                    }} onBlur={() => setRecording(null)}>{recording === a.id ? 'Pressione a combinação…' : comboFor(settings.shortcuts, a.id)}</button></td>
                  <td>{settings.shortcuts[a.id] && <button className="link" onClick={() => { const s = { ...settings.shortcuts }; delete s[a.id]; set({ shortcuts: s }); }}>restaurar padrão ({a.def})</button>}</td></tr>
              ))}</tbody></table>
              <small className="muted">Atalhos do editor de texto e do editor de desenho (Ctrl+B negrito, Ctrl+Z, Ctrl+D…) continuam valendo enquanto se digita nesses editores.</small>
            </section>
            <section className="card settings">
              <h4>Espaços de trabalho</h4>
              <p className="muted">Cada espaço separa tarefas, projetos, notas, quadros e arquivos.</p>
              <div className="row">
                <select value={settings.activeWorkspaceId} onChange={(e) => set({ activeWorkspaceId: Number(e.target.value) })}>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
                <button className="btn" onClick={async () => { const n = prompt('Nome do novo espaço de trabalho'); if (n?.trim()) { const w = await ui.run(api().workspaces.create(n)); if (w) set({ activeWorkspaceId: w.id }); } }}>Novo espaço</button>
              </div>
            </section>
          </>}

          {cat === 'data' && <>
            <section className="card settings">
              <h4>Armazenamento</h4>
              <p>Pasta de dados (separada da instalação; atualizações não a alteram): <code>{info?.dataDir}</code></p>
              {info && <p className="muted">Banco de dados: {fmtSize(info.dbSize)} · Biblioteca de arquivos: {fmtSize(info.filesSize)}</p>}
              <div className="row">
                <button className="btn" onClick={() => ui.run(api().app.openDataDir())}><FolderOpen size={14} /> Abrir pasta de dados</button>
                <button className="btn" onClick={async () => { const r = await ui.run(api().db.checkIntegrity()); if (r) ui.toast(r.message, r.ok ? 'ok' : 'error'); }}><ShieldCheck size={14} /> Verificar integridade</button>
              </div>
            </section>
            <section className="card settings"><h4>Backup e restauração</h4><BackupCenter /></section>
          </>}

          {cat === 'notifications' && <section className="card settings">
            <h4>Notificações e lembretes</h4>
            <label className="row"><input type="checkbox" checked={settings.notificationsEnabled} onChange={(e) => set({ notificationsEnabled: e.target.checked })} /> Ativar lembretes e avisos de prazo</label>
            <label className="row"><input type="checkbox" disabled={!settings.notificationsEnabled} checked={settings.systemNotifications} onChange={(e) => set({ systemNotifications: e.target.checked })} /> Mostrar também nas notificações do Windows</label>
            <label className="row"><input type="checkbox" disabled={!settings.notificationsEnabled} checked={settings.dueReminderTime !== null} onChange={(e) => set({ dueReminderTime: e.target.checked ? '09:00' : null })} /> Avisar no dia do prazo às
              <input type="time" disabled={!settings.notificationsEnabled || settings.dueReminderTime === null} value={settings.dueReminderTime ?? '09:00'} onChange={(e) => e.target.value && set({ dueReminderTime: e.target.value })} /></label>
            <small className="muted">Tarefas com horário avisam nesse horário. Lembretes específicos são criados em cada tarefa ou na agenda. As notificações do Windows dependem da permissão do sistema (Configurações → Sistema → Notificações).</small>
          </section>}

          {cat === 'app' && <section className="card settings">
            <h4>Aplicativo</h4>
            {info && <table className="table"><tbody>
              <tr><td>Versão instalada</td><td><strong>{info.version}</strong></td></tr>
              <tr><td>Versão do banco de dados</td><td>{info.dbVersion}</td></tr>
              <tr><td>Sistema</td><td>{info.os} · {info.platform} · {info.memory} de RAM</td></tr>
              <tr><td>Componentes</td><td>Electron {info.electron} · Chromium {info.chrome} · Node {info.node}</td></tr>
            </tbody></table>}
            <div className="row">
              <button className="btn" onClick={async () => {
                setUpd('Verificando…');
                const r = await ui.run(api().app.checkUpdates());
                setUpd(!r ? null : r.error ? r.error : r.newer ? `Nova versão disponível: ${r.latest}` : `Você já está na versão mais recente (${r.current}).`);
                if (r?.newer && r.url) void window.openExternal(r.url);
              }}><RefreshCw size={14} /> Verificar atualizações</button>
              {upd && <span className="muted">{upd}</span>}
            </div>
            <small className="muted">A verificação é opcional e só acontece quando você clica; o Workspace funciona totalmente offline. Para atualizar, instale a nova versão por cima: seus dados em %APPDATA%\Workspace são mantidos e migrados automaticamente (com backup preventivo).</small>
          </section>}
        </div>
      </div>
    </div>
  );
}
