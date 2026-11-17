import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, type DB } from '../src/main/db/connection';
import { TaskService } from '../src/main/services/tasks';
import { OrgService, SettingsService } from '../src/main/services/workspace';

export function tmpDir(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-')); }

export async function openApp(file: string) {
  const db: DB = openDatabase(file);
  const report = await migrate(db, path.join(path.dirname(file), 'backups'));
  const ws = () => 1;
  return { db, report, tasks: new TaskService(db, ws), org: new OrgService(db, ws), settings: new SettingsService(db) };
}
