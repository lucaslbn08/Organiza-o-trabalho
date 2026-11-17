import { contextBridge, ipcRenderer } from 'electron';
import type { WorkspaceApi } from '../shared/types';

const call = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

const api: WorkspaceApi = {
  app: { info: call('app:info'), openDataDir: call('app:openDataDir') } as WorkspaceApi['app'],
  settings: { get: call('settings:get'), set: call('settings:set') } as WorkspaceApi['settings'],
  workspaces: { list: call('workspaces:list'), create: call('workspaces:create') } as WorkspaceApi['workspaces'],
  projects: { list: call('projects:list'), create: call('projects:create'), update: call('projects:update'), remove: call('projects:remove') } as WorkspaceApi['projects'],
  categories: { list: call('categories:list'), create: call('categories:create'), remove: call('categories:remove') } as WorkspaceApi['categories'],
  tags: { list: call('tags:list') } as WorkspaceApi['tags'],
  tasks: {
    list: call('tasks:list'), get: call('tasks:get'), create: call('tasks:create'), update: call('tasks:update'),
    duplicate: call('tasks:duplicate'), remove: call('tasks:remove'), reorder: call('tasks:reorder'),
    addChecklist: call('tasks:addChecklist'), updateChecklist: call('tasks:updateChecklist'), removeChecklist: call('tasks:removeChecklist'),
    addComment: call('tasks:addComment'), addLink: call('tasks:addLink'), removeLink: call('tasks:removeLink'),
  } as WorkspaceApi['tasks'],
  kanban: { columns: call('kanban:columns'), updateColumn: call('kanban:updateColumn') } as WorkspaceApi['kanban'],
  dashboard: { stats: call('dashboard:stats') } as WorkspaceApi['dashboard'],
  history: { list: call('history:list') } as WorkspaceApi['history'],
  trash: { list: call('trash:list'), restore: call('trash:restore'), purge: call('trash:purge'), empty: call('trash:empty') } as WorkspaceApi['trash'],
  db: { checkIntegrity: call('db:checkIntegrity') } as WorkspaceApi['db'],
  onDataChanged(cb) {
    const l = (_: unknown, scope: string) => cb(scope);
    ipcRenderer.on('data:changed', l);
    return () => ipcRenderer.removeListener('data:changed', l);
  },
};
contextBridge.exposeInMainWorld('workspace', api);
contextBridge.exposeInMainWorld('openExternal', (url: string) => ipcRenderer.invoke('shell:openExternal', url));
