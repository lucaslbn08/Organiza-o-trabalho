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
  notes: {
    list: call('notes:list'), get: call('notes:get'), create: call('notes:create'), update: call('notes:update'),
    duplicate: call('notes:duplicate'), remove: call('notes:remove'), linkTask: call('notes:linkTask'), unlinkTask: call('notes:unlinkTask'),
    versions: call('notes:versions'), versionContent: call('notes:versionContent'), snapshot: call('notes:snapshot'), restoreVersion: call('notes:restoreVersion'),
    folders: call('notes:folders'), createFolder: call('notes:createFolder'), renameFolder: call('notes:renameFolder'),
    moveFolder: call('notes:moveFolder'), removeFolder: call('notes:removeFolder'),
  } as WorkspaceApi['notes'],
  media: { save: call('media:save'), get: call('media:get') } as WorkspaceApi['media'],
  canvases: {
    list: call('canvases:list'), get: call('canvases:get'), create: call('canvases:create'), update: call('canvases:update'),
    duplicate: call('canvases:duplicate'), remove: call('canvases:remove'), touch: call('canvases:touch'),
    link: call('canvases:link'), unlink: call('canvases:unlink'), versions: call('canvases:versions'),
    snapshot: call('canvases:snapshot'), restoreVersion: call('canvases:restoreVersion'),
  } as WorkspaceApi['canvases'],
  briefs: { tasks: call('briefs:tasks'), notes: call('briefs:notes') } as WorkspaceApi['briefs'],
  files: { saveAs: call('files:saveAs') } as WorkspaceApi['files'],
  search: { query: call('search:query') } as WorkspaceApi['search'],
  trash: { list: call('trash:list'), restore: call('trash:restore'), purge: call('trash:purge'), empty: call('trash:empty') } as WorkspaceApi['trash'],
  db: { checkIntegrity: call('db:checkIntegrity') } as WorkspaceApi['db'],
  onDataChanged(cb) {
    const l = (_: unknown, scope: string) => cb(scope);
    ipcRenderer.on('data:changed', l);
    return () => ipcRenderer.removeListener('data:changed', l);
  },
  onFlushRequest(cb) {
    ipcRenderer.removeAllListeners('app:flush');
    ipcRenderer.on('app:flush', () => { cb().catch(() => undefined).finally(() => ipcRenderer.send('app:flushed')); });
  },
};
contextBridge.exposeInMainWorld('workspace', api);
contextBridge.exposeInMainWorld('openExternal', (url: string) => ipcRenderer.invoke('shell:openExternal', url));
