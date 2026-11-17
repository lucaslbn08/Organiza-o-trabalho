# Arquitetura técnica

## Visão geral

```
┌──────────────── Processo principal (Node/Electron) ───────────────┐
│ index.ts   ciclo de vida, janela, estado da janela, abertura do BD │
│ ipc.ts     canais IPC com validação zod + checagem de origem       │
│ services/  regras de negócio (TaskService, OrgService, Settings)   │
│ db/        conexão (WAL, FULL sync, FK), migrações, integridade    │
└───────────────▲───────────────────────────────┬───────────────────┘
                │ ipcRenderer.invoke             │ 'data:changed'
┌───────────────┴──── preload (contextBridge) ───▼───────────────────┐
│ window.workspace: API tipada (src/shared/types.ts → WorkspaceApi)  │
└───────────────▲────────────────────────────────────────────────────┘
┌───────────────┴──── Renderer (React, sandbox) ─────────────────────┐
│ App (shell) · views/ · components/ · lib/api (useQuery, autosave)  │
└────────────────────────────────────────────────────────────────────┘
```

- Renderer roda com `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP restritiva,
  navegação e `window.open` bloqueados. Toda entrada é validada no processo principal (zod).
- Regras de negócio não dependem do Electron — são testadas com Vitest diretamente sobre SQLite.
- Kanban, lista, painel inicial e (futuramente) quadro infinito leem **o mesmo registro** `tasks`.
  Cada mutação emite `data:changed`, e os hooks `useQuery` recarregam — sincronização imediata.

## Estrutura de pastas

```
src/
  shared/types.ts          tipos de domínio e contrato da API (main ↔ renderer)
  main/
    index.ts               bootstrap, janela, pasta de dados (userData)
    ipc.ts                 handlers IPC validados
    logger.ts              log local com rotação
    db/connection.ts       abrir banco, migrar com backup preventivo, integridade
    db/migrations.ts       migrações versionadas (append-only)
    services/tasks.ts      tarefas, checklist, subtarefas, recorrência, reordenação
    services/workspace.ts  projetos, categorias, etiquetas, kanban, painel, lixeira, configurações
    services/history.ts    registro de alterações
  preload/index.ts         ponte segura
  renderer/
    App.tsx                shell: barra lateral, barra superior, atalhos, painel de detalhes
    views/                 Início, Tarefas, Kanban, Projetos, Histórico, Lixeira, Configurações
    components/            TaskDetail, QuickAdd, CommandPalette, DndGroups, TaskBits
    lib/                   api/hooks, UI (toasts, confirmação, menu de contexto)
    styles/app.css         tokens de tema claro/escuro
tests/                     testes Vitest das funções críticas
```

## Modelo de dados (v1)

| Tabela | Finalidade |
|---|---|
| `workspaces` | espaços de trabalho isolados |
| `projects` | projetos (cor, ícone, descrição, `deleted_at` = lixeira) |
| `categories` | categorias de tarefas por espaço |
| `tags`, `task_tags` | etiquetas (únicas por espaço, sem diferenciar maiúsculas) |
| `tasks` | tarefas; `parent_id` reservado; CHECK em status/prioridade/recorrência; `position` REAL |
| `checklist_items` | itens `checklist` e `subtask` (progresso) |
| `task_comments`, `task_links` | comentários e referências |
| `kanban_columns` | colunas personalizáveis mapeadas a status |
| `history` | alterações relevantes (sem medição de tempo) |
| `settings` | preferências em JSON por chave |

Todas as FKs têm `ON DELETE` explícito; exclusão de usuário é sempre lógica (`deleted_at`) até a lixeira
ser esvaziada. `PRAGMA user_version` guarda a versão do esquema.

Tabelas previstas nas próximas etapas (como novas migrações): `notes`, `note_folders`, `note_versions`,
`drawings`, `drawing_versions`, `boards`, `board_items`, `attachments`, `attachment_links`, `reminders`,
`floating_notes`, `ui_session` (abas/painéis).

## Durabilidade

- `journal_mode=WAL` + `synchronous=FULL`: cada transação confirmada sobrevive a queda de energia.
- Toda operação composta roda em `db.transaction` — sem registros parciais.
- Checkpoint `TRUNCATE` ao sair; integridade verificada na abertura e sob demanda.
- Backup consistente com a API de backup online do SQLite (usada nas migrações; será usada no ZIP).
