import type { DB } from '../db/connection';
import type { HistoryEntry } from '../../shared/types';

export function logHistory(db: DB, ws: number | null, entityType: string, entityId: number, action: string, details = ''): void {
  db.prepare('INSERT INTO history (workspace_id, entity_type, entity_id, action, details) VALUES (?,?,?,?,?)')
    .run(ws, entityType, entityId, action, details);
}

export function listHistory(db: DB, ws: number, limit = 200): HistoryEntry[] {
  return db.prepare('SELECT id, entity_type, entity_id, action, details, created_at FROM history WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY id DESC LIMIT ?')
    .all(ws, Math.min(Math.max(limit, 1), 2000)) as HistoryEntry[];
}
