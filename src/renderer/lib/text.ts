/** Snippets do FTS chegam com «termo»: escapa HTML e converte em <mark>. */
export function highlight(s: string): string {
  const esc = s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return esc.replace(/«/g, '<mark>').replace(/»/g, '</mark>');
}
