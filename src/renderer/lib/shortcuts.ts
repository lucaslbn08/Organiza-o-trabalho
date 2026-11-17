/** Atalhos personalizáveis: ação → combinação (ex.: "Ctrl+K", "Ctrl+Shift+N"). */
export const SHORTCUT_ACTIONS = [
  { id: 'palette', label: 'Pesquisa e comandos', def: 'Ctrl+K' },
  { id: 'quickTask', label: 'Nova tarefa', def: 'Ctrl+N' },
  { id: 'newNote', label: 'Nova anotação', def: 'Ctrl+Shift+N' },
  { id: 'newFloating', label: 'Nova nota flutuante', def: 'Ctrl+Shift+F' },
  { id: 'capture', label: 'Capturar tela', def: 'Ctrl+Shift+S' },
  { id: 'newTab', label: 'Nova aba', def: 'Ctrl+T' },
  { id: 'closeTab', label: 'Fechar aba', def: 'Ctrl+W' },
  { id: 'sidebar', label: 'Recolher barra lateral', def: 'Ctrl+B' },
  { id: 'goHome', label: 'Ir para Início', def: 'Ctrl+1' },
  { id: 'goTasks', label: 'Ir para Minhas tarefas', def: 'Ctrl+2' },
  { id: 'goKanban', label: 'Ir para Kanban', def: 'Ctrl+3' },
  { id: 'goProjects', label: 'Ir para Projetos', def: 'Ctrl+4' },
  { id: 'goAgenda', label: 'Ir para Agenda', def: 'Ctrl+5' },
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]['id'];

export function comboFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
}
export function resolveShortcuts(custom: Record<string, string>): Record<string, ShortcutAction> {
  const map: Record<string, ShortcutAction> = {};
  for (const a of SHORTCUT_ACTIONS) map[(custom[a.id] ?? a.def).toUpperCase()] = a.id;
  return map;
}
export const comboFor = (custom: Record<string, string>, id: ShortcutAction) => custom[id] ?? SHORTCUT_ACTIONS.find((a) => a.id === id)!.def;
