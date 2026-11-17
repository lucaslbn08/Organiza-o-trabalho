import fs from 'node:fs';
import path from 'node:path';

let logFile: string | null = null;
export function initLogger(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'workspace.log');
  try { if (fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.old'); } catch { /* sem log anterior */ }
}
export function log(level: 'info' | 'warn' | 'error', msg: string, err?: unknown): void {
  const line = `${new Date().toISOString()} [${level}] ${msg}${err ? ' :: ' + (err instanceof Error ? err.stack : String(err)) : ''}\n`;
  if (level === 'error') console.error(line); else console.log(line);
  if (logFile) try { fs.appendFileSync(logFile, line); } catch { /* disco indisponível */ }
}
