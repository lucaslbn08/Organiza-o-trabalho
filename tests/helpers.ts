import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrate, type DB } from '../src/main/db/connection';
import { TaskService } from '../src/main/services/tasks';
import { OrgService, SettingsService } from '../src/main/services/workspace';
import { NoteService, MediaService } from '../src/main/services/notes';
import { CanvasService } from '../src/main/services/canvases';
import { AttachmentService } from '../src/main/services/attachments';
import { PlanningService, FloatingService } from '../src/main/services/planning';

export function tmpDir(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-')); }

export async function openApp(file: string, filesDirOverride?: string) {
  const db: DB = openDatabase(file);
  const report = await migrate(db, path.join(path.dirname(file), 'backups'));
  const ws = () => 1;
  const notes = new NoteService(db, ws); const tasks = new TaskService(db, ws); const canvases = new CanvasService(db, ws);
  const filesDir = filesDirOverride ?? path.join(file === ':memory:' ? tmpDir() : path.dirname(file), 'files');
  const attachments = new AttachmentService(db, ws, filesDir);
  const svc = { tasks, notes, canvases, attachments };
  const planning = new PlanningService(db, ws, tasks); const floating = new FloatingService(db, ws);
  return { filesDir, attachments, planning, floating, svc, canvases, db, report, tasks, org: new OrgService(db, ws), settings: new SettingsService(db), notes, media: new MediaService(db) };
}
