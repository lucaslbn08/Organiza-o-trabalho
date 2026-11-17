import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS, LATEST_DB_VERSION } from './migrations';

export type DB = Database.Database;

export interface MigrationReport { from: number; to: number; backupPath: string | null; applied: string[] }

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');      // gravação atômica + leitura concorrente
  db.pragma('synchronous = FULL');      // máxima durabilidade em queda de energia
  db.pragma('foreign_keys = ON');       // integridade referencial
  db.pragma('busy_timeout = 5000');
  return db;
}

export function getUserVersion(db: DB): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/**
 * Aplica migrações pendentes. Antes de alterar um banco existente, cria um
 * backup preventivo consistente em `backupDir`. Cada migração roda em uma
 * transação: se falhar, nada é alterado e o erro é propagado.
 */
export async function migrate(db: DB, backupDir: string | null): Promise<MigrationReport> {
  const from = getUserVersion(db);
  if (from > LATEST_DB_VERSION) {
    throw new Error(`O banco de dados (versão ${from}) é mais novo que este programa (suporta até ${LATEST_DB_VERSION}). Atualize o Workspace.`);
  }
  const pending = MIGRATIONS.filter((m) => m.version > from);
  let backupPath: string | null = null;
  if (pending.length && from > 0 && backupDir) {
    fs.mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `pre-migracao-v${from}-${Date.now()}.sqlite`);
    await db.backup(backupPath);
  }
  const applied: string[] = [];
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
    })();
    applied.push(`${m.version}: ${m.name}`);
  }
  const fk = db.pragma('foreign_key_check') as unknown[];
  if (fk.length) throw new Error(`Falha de integridade referencial após migração (${fk.length} registros).`);
  return { from, to: getUserVersion(db), backupPath, applied };
}

export function checkIntegrity(db: DB): { ok: boolean; message: string } {
  const res = db.pragma('integrity_check', { simple: true }) as string;
  const fk = db.pragma('foreign_key_check') as unknown[];
  const ok = res === 'ok' && fk.length === 0;
  return { ok, message: ok ? 'Banco de dados íntegro.' : `integrity_check: ${res}; chaves estrangeiras inválidas: ${fk.length}` };
}
