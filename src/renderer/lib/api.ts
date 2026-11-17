import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceApi } from '../../shared/types';

declare global { interface Window { workspace: WorkspaceApi; openExternal(url: string): Promise<void> } }
export const api = (): WorkspaceApi => window.workspace;

/** Carrega dados e recarrega automaticamente quando o processo principal anuncia alterações. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; reload: () => void; error: string | null } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn); fnRef.current = fn;
  const reload = useCallback(() => {
    fnRef.current().then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => { reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => api().onDataChanged(() => reload()), [reload]);
  return { data, reload, error };
}

/** Registro global de gravações pendentes: o processo principal pede `flushAll` antes de fechar a janela. */
const flushers = new Set<() => Promise<void>>();
export function registerFlusher(f: () => Promise<void>): () => void { flushers.add(f); return () => { flushers.delete(f); }; }
export async function flushAll(): Promise<void> { await Promise.allSettled([...flushers].map((f) => f())); }

/** Salvamento automático com debounce; descarrega pendências ao desmontar e ao fechar o app. */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, delay = 500): 'saved' | 'pending' | 'error' {
  const [state, setState] = useState<'saved' | 'pending' | 'error'>('saved');
  const first = useRef(true); const pending = useRef<T | null>(null);
  const saveRef = useRef(save); saveRef.current = save;
  const flush = useCallback(async () => {
    if (pending.current === null) return;
    const v = pending.current; pending.current = null;
    try { await saveRef.current(v); setState('saved'); } catch { setState('error'); }
  }, []);
  useEffect(() => { flushers.add(flush); return () => { flushers.delete(flush); }; }, [flush]);
  // compara pelo conteúdo serializado: re-renderizações com o mesmo valor não disparam gravação
  const key = JSON.stringify(value);
  const valueRef = useRef(value); valueRef.current = value;
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    pending.current = valueRef.current; setState('pending');
    const t = setTimeout(flush, delay);
    return () => clearTimeout(t);
  }, [key, delay, flush]);
  useEffect(() => () => { void flush(); }, [flush]);
  return state;
}

export const fmtDate = (d: string | null) => d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '';
export const fmtDateTime = (d: string) => new Date(d).toLocaleString('pt-BR');
export const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
