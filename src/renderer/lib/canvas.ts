import type { TaskBrief, TaskStatus, TaskPriority, NoteBrief } from '../../shared/types';


export async function dataUrlToBytes(dataURL: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const m = /^data:([^;,]+)[^,]*,/.exec(dataURL);
  const res = await fetch(dataURL);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: m?.[1] ?? 'application/octet-stream' };
}
export function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([bytes as BlobPart], { type: mime }));
  });
}

export const STATUS_ICON: Record<TaskStatus, string> = { pending: '○', in_progress: '◐', paused: '‖', done: '✓', cancelled: '✕' };
const STATUS_BG: Record<TaskStatus, string> = { pending: '#e9ecef', in_progress: '#a5d8ff', paused: '#ffec99', done: '#b2f2bb', cancelled: '#dee2e6' };
const PRIORITY_STROKE: Record<TaskPriority, string> = { low: '#868e96', normal: '#1971c2', high: '#f08c00', urgent: '#e03131' };

/** Aparência do cartão de tarefa no quadro, derivada do registro da tarefa (fonte única da verdade). */
export function taskCardLook(t: TaskBrief | undefined) {
  if (!t || t.deleted) return { text: '(tarefa excluída)', backgroundColor: '#f1f3f5', strokeColor: '#adb5bd', strokeStyle: 'dashed' as const };
  return {
    text: `${STATUS_ICON[t.status]} ${t.title}`,
    backgroundColor: STATUS_BG[t.status], strokeColor: PRIORITY_STROKE[t.priority],
    strokeStyle: t.status === 'cancelled' ? ('dashed' as const) : ('solid' as const),
  };
}
/** Título digitado no cartão (sem o ícone de status). */
export function titleFromCardText(text: string): string {
  return text.replace(/^[○◐‖✓✕]\s*/u, '').replace(/\s+/g, ' ').trim();
}
export function noteCardText(n: NoteBrief | undefined): string {
  if (!n || n.deleted) return '(anotação excluída)';
  const ex = n.excerpt.replace(/\s+/g, ' ').trim();
  return `📝 ${n.title || 'Sem título'}${ex ? '\n' + (ex.length > 90 ? ex.slice(0, 90) + '…' : ex) : ''}`;
}

/** Linhas de checklist em caixas de texto: "☐ item" / "☑ item". */
export const CHECK_RE = /^([☐☑])\s?(.*)$/u;
export function toggleChecklistLine(text: string, index: number): string {
  return text.split('\n').map((l, i) => {
    if (i !== index) return l;
    const m = CHECK_RE.exec(l);
    return m ? `${m[1] === '☐' ? '☑' : '☐'} ${m[2]}` : l;
  }).join('\n');
}
