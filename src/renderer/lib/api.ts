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

/** Salvamento automático com debounce; descarrega pendências ao desmontar. */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, delay = 500): 'saved' | 'pending' | 'error' {
  const [state, setState] = useState<'saved' | 'pending' | 'error'>('saved');
  const first = useRef(true); const pending = useRef<T | null>(null);
  const saveRef = useRef(save); saveRef.current = save;
  const flush = useCallback(() => {
    if (pending.current === null) return;
    const v = pending.current; pending.current = null;
    saveRef.current(v).then(() => setState('saved')).catch(() => setState('error'));
  }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    pending.current = value; setState('pending');
    const t = setTimeout(flush, delay);
    return () => clearTimeout(t);
  }, [value, delay, flush]);
  useEffect(() => () => flush(), [flush]);
  return state;
}

export const fmtDate = (d: string | null) => d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '';
export const fmtDateTime = (d: string) => new Date(d).toLocaleString('pt-BR');
export const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
