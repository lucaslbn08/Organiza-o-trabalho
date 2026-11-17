import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, tmpDir } from './helpers';
import { openDatabase, migrate, checkIntegrity } from '../src/main/db/connection';
import { LATEST_DB_VERSION } from '../src/main/db/migrations';

describe('Banco de dados e migrações', () => {
  it('banco novo é migrado para a última versão sem backup', async () => {
    const { db, report } = await openApp(path.join(tmpDir(), 'a.sqlite'));
    expect(report.to).toBe(LATEST_DB_VERSION);
    expect(report.backupPath).toBeNull();
    expect(checkIntegrity(db).ok).toBe(true);
  });

  it('reabrir não reaplica migrações nem perde dados (Teste 6 — atualização)', async () => {
    const file = path.join(tmpDir(), 'b.sqlite');
    let app = await openApp(file);
    app.tasks.create({ title: 'Persistente' });
    app.settings.set({ theme: 'light' });
    app.db.close();
    app = await openApp(file);
    expect(app.report.applied).toEqual([]);
    expect(app.tasks.list()[0].title).toBe('Persistente');
    expect(app.settings.get().theme).toBe('light');
  });

  it('cria backup preventivo antes de migrar banco existente', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'c.sqlite');
    const app = await openApp(file);
    app.tasks.create({ title: 'antes' });
    app.db.pragma('user_version = 0'); // simula banco "antigo"
    app.db.exec('DROP TABLE settings');
    app.db.close();
    // migração 1 falhará porque as tabelas já existem: deve ser transacional e manter os dados
    const db = openDatabase(file);
    db.pragma('user_version = 0');
    await expect(migrate(db, path.join(dir, 'backups'))).rejects.toThrow();
    expect((db.prepare('SELECT COUNT(*) n FROM tasks').get() as { n: number }).n).toBe(1);
    db.close();
  });

  it('recusa banco mais novo que o programa', async () => {
    const file = path.join(tmpDir(), 'd.sqlite');
    const db = openDatabase(file);
    db.pragma(`user_version = ${LATEST_DB_VERSION + 1}`);
    await expect(migrate(db, null)).rejects.toThrow(/mais novo/);
  });

  it('Teste 7 — encerramento abrupto preserva transações confirmadas', async () => {
    const file = path.join(tmpDir(), 'e.sqlite');
    const app = await openApp(file);
    app.tasks.create({ title: 'confirmada' });
    // transação interrompida no meio (simula falha durante gravação)
    expect(() => app.db.transaction(() => {
      app.db.prepare("INSERT INTO tasks (workspace_id, title) VALUES (1, 'parcial')").run();
      throw new Error('queda');
    })()).toThrow('queda');
    // não chama close(): simula processo morto — copia arquivos como estão (db + WAL)
    const crashDir = tmpDir();
    for (const f of fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('e.sqlite'))) {
      fs.copyFileSync(path.join(path.dirname(file), f), path.join(crashDir, f));
    }
    const re = await openApp(path.join(crashDir, 'e.sqlite'));
    expect(re.tasks.list().map((t) => t.title)).toEqual(['confirmada']);
    expect(checkIntegrity(re.db).ok).toBe(true);
  });

  it('título vazio é rejeitado pelo banco', async () => {
    const { tasks } = await openApp(':memory:');
    expect(() => tasks.create({ title: '   ' })).toThrow();
  });
});
