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
    services/notes.ts      anotações, pastas, versões, vínculos, mídia, extração de texto
    services/search.ts     pesquisa universal
    services/canvases.ts   desenhos e quadros: cenas, versões, vínculos, dados atuais de tarefas/notas
    services/attachments.ts biblioteca de arquivos (cópia com hash, vínculos, ausentes, exclusão segura)
    services/planning.ts   agenda, lembretes, central de notificações, notas flutuantes
    services/capture.ts    inserir capturas em notas e quadros
  main/windows.ts          janelas seguras, protocolo app://, notas flutuantes, captura de tela
  main/backup/backup.ts    backup ZIP, verificação, restauração em duas fases
  preload/index.ts         ponte segura
  renderer/
    App.tsx                shell: barra lateral, barra superior, atalhos, painel de detalhes
    views/                 Início, Tarefas, Kanban, Anotações (lazy), Projetos, Histórico, Lixeira, Configurações
    components/            TaskDetail, NoteEditor, CanvasEditor (lazy), MediaImg, QuickAdd, CommandPalette, DndGroups, TaskBits
    lib/                   api/hooks, UI (toasts, confirmação, menu de contexto)
    styles/app.css         tokens de tema claro/escuro
tests/                     testes Vitest das funções críticas
tests/e2e/                 testes de ponta a ponta no Electron real (Playwright)
build/                     ícones do aplicativo/instalador
scripts/                   cópia das fontes do editor para uso offline
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
| `settings` | preferências em JSON por chave (inclui abas de notas abertas) |
| `note_folders` | pastas e subpastas (árvore por `parent_id`) — v2 |
| `notes` | `content_json` (documento ProseMirror), `content_text` (texto para busca), fixada, favorita, `revision` — v2 |
| `notes_fts` | índice FTS5 externo (`unicode61 remove_diacritics 2`) mantido por gatilhos — v2 |
| `note_tags`, `note_tasks` | etiquetas e vínculo nota ↔ tarefa — v2 |
| `note_versions` | versões anteriores (auto/manual/antes de restaurar), máx. 100 por nota — v2 |
| `media` | imagens deduplicadas por SHA-256 (BLOB), servidas via `ws-media://` — v2 |
| `canvases` | desenhos e quadros (`kind`): `scene_json` = elementos editáveis + câmera/zoom + mapa de imagens → `media`; miniatura; texto para busca — v3 |
| `canvas_versions` | versões anteriores da cena (máx. 50) — v3 |
| `attachments`, `attachment_links` | biblioteca: `mode` internal (caminho relativo em `files/`) ou link (caminho absoluto); vínculos com tarefa/nota/projeto/quadro — v4 |
| `reminders`, `notification_log` | lembretes e controle de avisos de prazo já enviados — v4 |
| `floating_notes` | notas flutuantes: conteúdo, cor, posição, tamanho, fixação, aberta/fechada — v4 |
| `tasks.due_time` | horário opcional do prazo — v4 |
| `backup_log` | histórico de exportações, cópias de segurança e restaurações — v5 |
| `canvas_links` | vínculos desenho/quadro ↔ tarefa/nota (limpos por gatilho ao excluir o alvo) — v3 |

Todas as FKs têm `ON DELETE` explícito; exclusão de usuário é sempre lógica (`deleted_at`) até a lixeira
ser esvaziada. `PRAGMA user_version` guarda a versão do esquema.

As abas e a divisão da área de trabalho ficam em `settings` (`tabs`, `activeTab`, `split`).

## Sincronização do editor

O editor grava com debounce. Ao receber `data:changed`, ele só aplica a versão do banco se ela for mais nova
**e** não houver edição local pendente nem gravação em andamento (comparação com o último estado sincronizado).
Assim, restaurar uma versão atualiza o editor, mas nada sobrescreve o que está sendo digitado.
Uma falha transitória ao recarregar não desmonta o editor. Ao fechar a janela, o processo principal pede ao
renderer que grave as pendências (`app:flush`, limite de 2,5 s) antes de encerrar.

## Quadro infinito: sincronização sem duplicação

Um cartão de tarefa é um retângulo com `customData = { kind: 'task', taskId }` e um texto vinculado.
Ao abrir o quadro e a cada `data:changed` de tarefas/notas, o editor busca os dados atuais (`briefs:*`) e
reescreve texto/cores dos cartões fora do histórico de desfazer. O painel de seleção altera o registro real
(`tasks:update`). Os vínculos `canvas_links` do quadro são derivados dos cartões presentes a cada gravação.

## Protocolos

- `app://workspace/` serve a interface (em produção) a partir de `dist/renderer`, com validação de caminho. Diferente de
  `file://`, permite `fetch` de recursos locais (fontes do editor) e um CSP `'self'` restrito.
- `ws-media://<sha256>` serve imagens guardadas no banco (somente leitura).

## Backup

Ver [BACKUP.md](BACKUP.md). Código em `src/main/backup/backup.ts`.

## Janelas

- **Principal** (`#`), **notas flutuantes** (`#sticky/ID`, sem moldura, `alwaysOnTop` opcional) e **sobreposição de
  captura** (`#capture`, tela cheia) carregam a mesma página com as mesmas preferências seguras (`windows.ts`).
- O agendador (30 s) no processo principal dispara lembretes/avisos de prazo; usa `Notification` do Electron
  (requer `app.setAppUserModelId` no Windows) e envia `app:event` para o app.
- Ao fechar a janela principal, o app grava pendências, fecha as notas flutuantes mantendo-as marcadas como
  abertas e as reabre na próxima execução.

## Durabilidade

- `journal_mode=WAL` + `synchronous=FULL`: cada transação confirmada sobrevive a queda de energia.
- Toda operação composta roda em `db.transaction` — sem registros parciais.
- Checkpoint `TRUNCATE` ao sair; integridade verificada na abertura e sob demanda.
- Backup consistente com a API de backup online do SQLite (usada nas migrações; será usada no ZIP).
