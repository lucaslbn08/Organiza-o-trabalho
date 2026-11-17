// Teste de ponta a ponta no Electron real (preload, IPC, CSP, protocolo ws-media, janelas).
// Uso: npm run build && xvfb-run -a node tests/e2e/electron.e2e.mjs   (no Windows: node tests/e2e/electron.e2e.mjs)
import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function launch(dataDir) {
  const app = await electron.launch({
    executablePath: require('electron'), args: [ROOT, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    env: { ...process.env, WORKSPACE_DATA_DIR: dataDir, ELECTRON_ENABLE_LOGGING: '0' },
  });
  // janela principal (as notas flutuantes reabertas usam #sticky/ID)
  let win = null;
  for (let i = 0; i < 300 && !win; i++) { win = app.windows().find((w) => !w.url().includes('#')) ?? null; if (!win) await new Promise((r) => setTimeout(r, 100)); }
  if (!win) throw new Error('Janela principal não abriu');
  const issues = [];
  // o editor de desenho declara cada fonte como "url(local), url(CDN)"; o CSP bloqueia a CDN (desejado: offline) e a fonte local é usada
  const expected = (t) => /esm\.sh\/@excalidraw\/.*\/fonts\//.test(t);
  win.on('console', (m) => { if ((m.type() === 'error' || /Content Security Policy/i.test(m.text())) && !expected(m.text())) issues.push(m.text()); });
  win.on('pageerror', (e) => issues.push(e.message));
  await win.waitForSelector('.tabbar', { timeout: 30000 });
  return { app, win, issues };
}
const api = (win, fn, ...args) => win.evaluate(([f, a]) => (0, eval)(f)(...a), [fn.toString(), args]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ws-e2e-'));

// ---------------------------------------------------------------- Teste 6: atualização sobre dados antigos
{
  const dir = tmp(); fs.mkdirSync(path.join(dir, 'data'));
  const { MIGRATIONS } = await import(path.join(ROOT, 'dist/main/main/db/migrations.js'));
  const db = new Database(path.join(dir, 'data', 'workspace.sqlite'));
  db.exec(MIGRATIONS[0].up); db.pragma('user_version = 1');
  db.prepare("INSERT INTO tasks (workspace_id, title, status) VALUES (1, 'Tarefa da versão antiga', 'in_progress')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('theme', '\"light\"')").run();
  db.close();
  const { app, win, issues } = await launch(dir);
  const tasks = await api(win, () => window.workspace.tasks.list({}));
  const info = await api(win, () => window.workspace.app.info());
  const settings = await api(win, () => window.workspace.settings.get());
  const backups = fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')) : [];
  check('Teste 6 — atualização preserva dados e preferências', tasks.length === 1 && tasks[0].status === 'in_progress' && settings.theme === 'light', `banco v1 → v${info.dbVersion}`);
  check('Teste 6 — backup preventivo criado antes da migração', backups.some((f) => f.startsWith('pre-migracao-v1')), backups.join(', '));
  check('Sem erros/violações de CSP (atualização)', issues.length === 0, issues.slice(0, 3).join(' | '));
  await app.close();
}

const dir = tmp();
// ---------------------------------------------------------------- Testes 1, 2, 3 + janelas
{
  const { app, win, issues } = await launch(dir);
  check('Janela principal abre com título', (await win.title()) === 'Workspace');
  check('Interface servida pelo protocolo seguro app://', win.url().startsWith('app://workspace/'));
  await win.locator('.content').click({ position: { x: 500, y: 500 } });
  for (let i = 1; i <= 10; i++) {
    await win.keyboard.press('Control+n'); await win.getByPlaceholder('O que precisa ser feito?').fill(`Tarefa ${i}`);
    await win.keyboard.press('Enter'); await win.waitForSelector('.modal', { state: 'detached' }); await win.keyboard.press('Escape');
  }
  await win.locator('.sidebar .nav', { hasText: 'Minhas tarefas' }).click(); await win.waitForSelector('.task-row');
  const rows = win.locator('.task-row');
  for (let i = 0; i < 3; i++) await rows.nth(i).locator('select').selectOption('done');
  for (let i = 3; i < 7; i++) await rows.nth(i).locator('select').selectOption('in_progress');
  // Teste 2: nota com formatação, checklist e imagem colada (protocolo ws-media real)
  await win.locator('.sidebar .nav', { hasText: 'Anotações' }).click();
  await win.getByRole('button', { name: 'Nova anotação' }).click(); await win.waitForSelector('.ProseMirror');
  await win.locator('.title-input').fill('Nota do teste');
  await win.locator('.ProseMirror').click();
  await win.keyboard.type('# Título'); await win.keyboard.press('Enter');
  await win.keyboard.press('Control+b'); await win.keyboard.type('negrito'); await win.keyboard.press('Control+b'); await win.keyboard.press('Enter');
  await win.getByTitle('Checklist').click(); await win.keyboard.type('item feito');
  await win.locator('.ProseMirror li input[type=checkbox]').first().check();
  await win.evaluate((b64) => {
    const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'cap.png', { type: 'image/png' }));
    document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG.toString('base64'));
  await win.waitForSelector('.ProseMirror img');
  await win.waitForFunction(() => document.querySelector('.ProseMirror img')?.naturalWidth > 0, null, { timeout: 10000 }).catch(() => {});
  check('Imagem colada é servida pelo protocolo ws-media://', await win.evaluate(() => { const i = document.querySelector('.ProseMirror img'); return i.src.startsWith('ws-media://') && i.naturalWidth > 0; }));
  // Teste 3: quadro com tarefa, retângulo e zoom
  const board = await api(win, () => window.workspace.canvases.create({ kind: 'board', title: 'Quadro E2E' }));
  const s = await api(win, () => window.workspace.settings.get());
  await api(win, (id, oc) => window.workspace.settings.set({ openCanvas: { ...oc, board: id } }), board.id, s.openCanvas);
  await win.locator('.sidebar .nav', { hasText: 'Quadro infinito' }).click(); await win.waitForSelector('.excalidraw canvas.interactive'); await win.waitForTimeout(1000);
  await win.getByRole('button', { name: 'Inserir' }).click();
  await win.locator('.float-panel select').first().selectOption({ label: 'Tarefa 8' }); await win.waitForTimeout(500);
  const box = await win.locator('.excalidraw canvas.interactive').boundingBox();
  await win.keyboard.press('Escape');
  await win.locator('.excalidraw [data-testid="toolbar-rectangle"]').check({ force: true });
  await win.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6); await win.mouse.down(); await win.mouse.move(box.x + box.width * 0.7 + 160, box.y + box.height * 0.6 + 110, { steps: 8 }); await win.mouse.up();
  await win.keyboard.press('Escape');
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 3; i++) { await win.mouse.wheel(0, 120); await win.waitForTimeout(80); }
  await win.waitForTimeout(1500);
  check('Fontes do editor de desenho carregadas localmente (offline)', await win.evaluate(() => [...document.fonts].some((f) => /Excalifont|Virgil/i.test(f.family) && f.status === 'loaded')));
  const zoomBefore = (await win.locator('.excalidraw .zoom-actions').innerText()).trim();
  // nota flutuante = janela própria
  const before = app.windows().length;
  await api(win, () => window.workspace.floating.create({ content: 'Flutuante E2E' }));
  await app.waitForEvent('window', { timeout: 10000 }).catch(() => null);
  check('Nota flutuante abre em janela própria', app.windows().length === before + 1);
  check('Sem erros/violações de CSP (sessão 1)', issues.length === 0, issues.slice(0, 3).join(' | '));
  await app.close();

  const r = await launch(dir);
  const all = await api(r.win, () => window.workspace.tasks.list({}));
  const by = (st) => all.filter((t) => t.status === st).length;
  check('Teste 1 — 10 tarefas e status preservados após reabrir', all.length === 10 && by('done') === 3 && by('in_progress') === 4 && by('pending') === 3);
  const notes = await api(r.win, () => window.workspace.notes.list({}));
  const note = await api(r.win, (id) => window.workspace.notes.get(id), notes[0].id);
  check('Teste 2 — nota com título, negrito, checklist marcado e imagem preservada',
    /"heading"/.test(note.content_json) && /"bold"/.test(note.content_json) && /"checked":true/.test(note.content_json) && /ws-media:\/\//.test(note.content_json));
  await r.win.waitForSelector('.excalidraw canvas.interactive', { timeout: 15000 }); await r.win.waitForTimeout(1500);
  const zoomAfter = (await r.win.locator('.excalidraw .zoom-actions').innerText()).trim();
  const scene = JSON.parse((await api(r.win, (id) => window.workspace.canvases.get(id), board.id)).scene_json);
  const types = scene.elements.map((e) => e.type + (e.customData ? ':' + e.customData.kind : ''));
  check('Teste 3 — quadro reabre com a mesma disposição e zoom', zoomBefore === zoomAfter && zoomAfter !== '100%' && types.includes('rectangle:task') && types.filter((t) => t === 'rectangle').length >= 1, `zoom ${zoomBefore} → ${zoomAfter}; elementos ${types.join(',')}`);
  await r.win.waitForTimeout(500);
  check('Notas flutuantes reabertas automaticamente', r.app.windows().length >= 2);
  // Teste 4 no app real: status mudado pelo painel do quadro aparece na lista
  const t8 = all.find((t) => t.title === 'Tarefa 8');
  await api(r.win, (id) => window.workspace.tasks.update(id, { status: 'paused' }), t8.id);
  await r.win.waitForTimeout(800);
  const cardText = await r.win.evaluate(() => document.querySelector('.excalidraw') ? 'ok' : 'sem quadro');
  check('Teste 4 — mudança de status sincronizada (mesmo registro)', (await api(r.win, (id) => window.workspace.tasks.get(id), t8.id)).status === 'paused' && cardText === 'ok');

  // ---------------------------------------------------------------- Teste 5: backup e restauração
  const zip = path.join(tmp(), 'backup-e2e.zip');
  const exp = await api(r.win, (p) => window.workspace.backup.export(p, false), zip);
  check('Teste 5 — backup exportado e verificado', exp.report.ok && fs.existsSync(zip) && !fs.existsSync(zip + '.parcial'), `${Math.round(exp.size / 1024)} KB, ${exp.report.manifest.files.length} arquivos`);
  await api(r.win, () => window.workspace.tasks.create({ title: 'Criada depois do backup' }));
  const prep = await api(r.win, (p) => window.workspace.backup.restore(p), zip);
  check('Teste 5 — cópia de segurança automática antes de restaurar', fs.existsSync(prep.safetyBackup));
  await r.app.close();
  // restauração em ambiente limpo (outra pasta de dados)
  const clean = tmp();
  const c = await launch(clean);
  const prep2 = await api(c.win, (p) => window.workspace.backup.restore(p), zip);
  await c.app.close();
  const c2 = await launch(clean);
  const restored = await api(c2.win, () => window.workspace.tasks.list({}));
  const rnotes = await api(c2.win, () => window.workspace.notes.list({}));
  const rboard = await api(c2.win, () => window.workspace.canvases.list('board'));
  check('Teste 5 — restaurado em ambiente limpo com tarefas, notas e quadros', restored.length === 10 && rnotes.length === 1 && rboard.length === 1 && !!prep2);
  await c2.app.close();
  const d2 = await launch(dir);
  const back = await api(d2.win, () => window.workspace.tasks.list({}));
  check('Teste 5 — restauração no mesmo computador volta ao estado do backup', back.length === 10 && !back.some((t) => t.title === 'Criada depois do backup'));
  check('Dados anteriores à restauração foram guardados', fs.readdirSync(dir).some((f) => f.startsWith('dados-anteriores-')));
  await d2.app.close();
}

// ---------------------------------------------------------------- Teste 7: encerramento abrupto
{
  const { app, win } = await launch(dir);
  await api(win, () => window.workspace.tasks.create({ title: 'Salva antes da queda' }));
  const pid = app.process().pid;
  process.kill(pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 1500));
  const db = new Database(path.join(dir, 'data', 'workspace.sqlite'));
  const ic = db.pragma('integrity_check', { simple: true });
  const has = db.prepare("SELECT COUNT(*) n FROM tasks WHERE title = 'Salva antes da queda'").get().n;
  db.close();
  check('Teste 7 — banco íntegro e último dado salvo presente após encerramento abrupto', ic === 'ok' && has === 1);
  const again = await launch(dir);
  check('Teste 7 — app reabre normalmente após a queda', (await api(again.win, () => window.workspace.db.checkIntegrity())).ok);
  await again.app.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.`);
process.exit(failed.length ? 1 : 0);
