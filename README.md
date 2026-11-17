# Workspace

Aplicativo de produtividade e organização pessoal para Windows 10/11 — offline, sem login, dados locais.

> **Status: Etapas 1 e 2 concluídas.** As seções marcadas como “Etapa N” na barra lateral
> ainda **não estão implementadas** e exibem uma tela informando isso. Veja [Roteiro](#roteiro).

## O que já funciona

### Etapa 1 — base

- Electron + React + TypeScript + Vite, SQLite (better-sqlite3) com migrações versionadas.
- **Tarefas**: criar, editar (salvamento automático), duplicar, lixeira/restaurar, reordenar por arrastar,
  arrastar entre categorias, filtros por status/prioridade, pesquisa (título, descrição, etiquetas),
  ordenação (manual, nome, criação, prazo, prioridade), recorrência (diária/semanal/mensal/anual),
  checklist, subtarefas com progresso, comentários, links, histórico por tarefa, exibir/ocultar concluídas.
- **Kanban**: mesmo registro das tarefas (sem duplicação), arrastar entre colunas muda o status,
  reordenação, filtro por projeto, colunas personalizáveis (título, cor, visibilidade).
- **Início**: contadores, prioritárias, prazos próximos e atrasadas, projetos recentes, atalhos;
  painéis reorganizáveis por arrastar e ocultáveis.
- **Projetos** (cor, descrição, tarefas do projeto), **espaços de trabalho** independentes.
- **Pesquisa/paleta de comandos** (Ctrl+K) para tarefas, projetos e comandos.
- **Histórico** global, **Lixeira** (restaurar, excluir definitivo com confirmação, esvaziar).
- **Configurações**: tema escuro/claro, cor principal, escala, animações, espaço de trabalho,
  pasta de dados, verificação de integridade, versão.
- Sincronização imediata entre telas: toda alteração notifica o renderer (`data:changed`).
- Restauração: tamanho/posição da janela, última seção, barra recolhida, preferências.

### Etapa 2 — anotações e organização

- **Editor rico** (TipTap/ProseMirror): negrito, itálico, sublinhado, tachado, títulos H1–H3, listas numeradas e
  com marcadores, checklists interativos, cor do texto, destaque, links (Ctrl+clique abre no navegador),
  tabelas (inserir/remover linhas e colunas, redimensionar), imagens (botão, **colar captura de tela**, arrastar),
  blocos de código, citações, separadores, desfazer/refazer.
- **Organização**: pastas e subpastas (criar, renomear, mover por arrastar, excluir sem perder notas),
  categorias, etiquetas, fixar, favoritar, duplicar, filtros por pasta/favoritas/etiqueta.
- **Várias notas abertas** em abas e **lado a lado**; as abas abertas são restauradas ao reabrir o app.
- **Salvamento automático** (600 ms após parar de digitar) + gravação forçada de pendências ao fechar a janela.
- **Histórico de versões**: versão automática a cada 10 min de edição, versão manual, pré-visualização e
  restauração (o conteúdo atual é guardado antes de restaurar). Até 100 versões por nota.
- **Vínculos**: nota ↔ tarefas (nos dois painéis), nota → projeto (aparece na página do projeto).
- **Pesquisa de texto completo** (SQLite FTS5, ignora acentos, por prefixo) dentro das notas e na
  **pesquisa universal Ctrl+K**, que agora cobre tarefas, anotações, projetos e etiquetas com filtros por tipo.
- Notas na **lixeira** e no **histórico**; painel “Anotações recentes” no Início.
- Imagens ficam no próprio banco (tabela `media`, deduplicadas por SHA-256) e são servidas pelo protocolo
  interno somente leitura `ws-media://` — entram automaticamente no backup.

Atalhos: `Ctrl+Shift+N` nova anotação · `Ctrl+K` pesquisa · `Ctrl+N` nova tarefa · `Ctrl+B` barra lateral · `Ctrl+1..4` navegação · `Esc` fecha painel.

## Executar em desenvolvimento

Requisitos: Node.js 20+ e (no Windows) as ferramentas de build do Visual Studio, caso o
better-sqlite3 não encontre binário pré-compilado.

```bash
npm install
```

```bash
npm run rebuild:electron
```

```bash
npm run dev
```

`rebuild:electron` compila o SQLite nativo para o Electron. Para rodar os testes (que usam o Node),
recompile para o Node antes: `npm rebuild better-sqlite3`.

## Testes

```bash
npm test
```

Cobrem: Teste 2 (nota com formatação, checklist, tabela e imagem preservada após reabrir), migração v1→v2
com backup preventivo, pesquisa FTS sem acentos, versões, pastas, vínculos, lixeira de notas, mídia; Teste 1 (10 tarefas/status persistem após reabrir), Teste 4 (lista ↔ Kanban no mesmo registro),
Teste 6 (reabrir/atualizar sem perder dados nem reaplicar migrações), Teste 7 (transação interrompida e
processo encerrado sem `close()` preservam apenas dados confirmados), recorrência, duplicação, lixeira,
filtros, ordenação, reordenação com filtros, migração transacional e recusa de banco mais novo.

## Gerar instalador Windows

```bash
npm run dist:win
```

Gera `release/Workspace Setup x.y.z.exe` (NSIS, por usuário, permite escolher a pasta).
Execute no Windows (o módulo nativo precisa ser compilado para Windows).

## Onde ficam os dados / atualizações sem perda

| Item | Local |
|---|---|
| Programa | pasta de instalação (substituída a cada atualização) |
| Banco | `%APPDATA%\Workspace\data\workspace.sqlite` (+ `-wal`) |
| Backups preventivos de migração | `%APPDATA%\Workspace\backups\` |
| Logs | `%APPDATA%\Workspace\logs\workspace.log` |

O instalador está configurado com `deleteAppDataOnUninstall: false`. Para atualizar, basta instalar a
versão nova por cima. Na abertura, o app: verifica `user_version` → se houver migrações pendentes,
cria backup consistente (`db.backup`) → aplica cada migração em transação → verifica chaves estrangeiras
→ registra em log. Se o banco for de versão mais nova que o programa, ele recusa abrir (sem alterar nada).
Migrações publicadas nunca são editadas; mudanças sempre entram como nova versão em `src/main/db/migrations.ts`.

Documentação técnica: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Roteiro

| Etapa | Conteúdo | Status |
|---|---|---|
| 1 | Base, SQLite, interface, navegação, tarefas, Kanban, autosave | **Concluída** |
| 2 | Editor de notas (rich text, versões), pastas, pesquisa em notas, lixeira de notas | **Concluída** |
| 3 | Editor de desenhos, quadro infinito, conectores, tarefas/notas sincronizadas no quadro | Pendente |
| 4 | Arquivos/anexos, captura de tela, notas flutuantes, agenda/lembretes, abas e painéis divididos | Pendente |
| 5 | Backup ZIP (exportar/verificar/restaurar), otimizações, empacotamento final | Pendente |

Ainda **não** existe: abas/divisão para a área de trabalho inteira (hoje há abas e lado a lado só nas notas),
atalhos personalizáveis, anexos de arquivos em tarefas, notas flutuantes (Etapa 4), backup ZIP (Etapa 5).
