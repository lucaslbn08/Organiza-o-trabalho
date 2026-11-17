# Workspace

Aplicativo de produtividade e organização pessoal para Windows 10/11 — offline, sem login, dados locais.

> **Status: Etapas 1 a 4 concluídas.** As seções marcadas como “Etapa N” na barra lateral
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

### Etapa 3 — ferramentas visuais

Motor de desenho: **Excalidraw** (MIT, maduro, offline — fontes copiadas localmente por `npm run assets`).

- **Desenhos e esboços**: lápis/pincel (traço livre com espessura), borracha, linha, seta, retângulo, losango,
  elipse/círculo, texto, seleção, mover, redimensionar, cores, espessura, desfazer/refazer, zoom, grade,
  alinhamento e distribuição, duplicação, agrupamento, bloqueio, camadas, imagens (inserir/colar captura).
  O desenho é salvo **como objetos editáveis** (não como imagem final), com miniatura na galeria.
- **Quadro infinito**: tudo acima + notas adesivas, caixas de texto, **cartões de tarefa interativos**,
  **cartões de anotação**, checklists clicáveis (`☐/☑`), quadros/agrupamentos (frames), setas e conectores
  ligados aos objetos, links para outros quadros, vários quadros independentes.
  Roda do mouse aproxima/afasta (alternável para rolar); arrastar com espaço ou ferramenta mão move a tela.
- **Sincronização**: o quadro guarda só a referência (`taskId`/`noteId`); título, status e prioridade vêm
  sempre do registro. Marcar como concluída no painel do cartão reflete na lista e no Kanban, e vice-versa;
  editar o texto do cartão renomeia a tarefa. Notas mostram título e trecho atualizados.
- **Persistência**: posição, dimensões, conteúdo, cores, conexões, grupos, zoom e posição da câmera;
  imagens na biblioteca interna (deduplicadas). Reabre exatamente como estava, inclusive o último quadro aberto.
- **Exportação PNG ou PDF**, ajustada automaticamente ao conteúdo (ou só a seleção), 1×/2×/3×, com/sem fundo.
  Gravação atômica no destino escolhido; trata falta de espaço em disco.
- **Versões** (automática a cada 10 min de edição, manual, restaurar), duplicar, lixeira, histórico,
  pesquisa pelo título e pelos textos do desenho (Ctrl+K), vínculos com tarefas, notas e projetos.

### Etapa 4 — recursos avançados

- **Arquivos e anexos** (seção *Arquivos* + painel em tarefas, notas, projetos e quadros):
  - duas formas, claramente diferenciadas: **Copiar para a biblioteca interna** (`%APPDATA%\Workspace\files`,
    deduplicada por SHA-256, cópia atômica, entra no backup) ou **Vincular o arquivo original** (só o caminho);
  - arrastar arquivos do Windows para a tela, ou escolher pela janela do sistema;
  - visualização interna de imagens, **PDFs (pdf.js, com páginas)** e texto; abrir com o aplicativo padrão;
  - renomear identificação, pastas/subpastas, pesquisa (também no Ctrl+K), **detecção de arquivos ausentes**,
    “Localizar arquivo…” para reapontar vínculos, “Incorporar à biblioteca” para copiar um vínculo;
  - exclusão com confirmação; ao esvaziar a lixeira só cópias internas são apagadas — **originais externos nunca**;
  - por segurança, executáveis/scripts (.exe, .bat, .ps1, .js, .lnk…) nunca são abertos, apenas exibidos na pasta.
- **Quadro infinito**: PDFs como referência (imagem da 1ª página) e links para arquivos da biblioteca.
- **Captura de tela** (ícone de câmera ou Ctrl+K): região selecionada, janela ou tela inteira (`desktopCapturer`);
  enviar para nova anotação, anotação existente, tarefa (anexo), desenho, quadro, ou copiar para a área de transferência.
- **Notas flutuantes**: janelas pequenas sem moldura, arrastáveis, redimensionáveis, com cor, minimizar,
  **fixar sobre todos os aplicativos**, relacionar a uma tarefa; posição/tamanho salvos e reabertas automaticamente.
- **Agenda** diária, semanal e mensal: tarefas por prazo (com horário opcional), arrastar para outro dia,
  criar tarefa com duplo clique, lembretes (criar, adiar, dispensar).
- **Lembretes e notificações**: dentro do app e pelas **notificações do Windows** (configurável); aviso
  automático no dia do prazo; **central de notificações** (sino) com atrasadas, hoje, próximos 3 dias e lembretes.
- **Área de trabalho**: **abas** independentes (Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+clique/botão do meio para nova aba,
  arrastar para reordenar) e **divisão lado a lado ou horizontal**; abas, divisão, notas e quadros abertos são
  restaurados ao reabrir.

Atalhos: `Ctrl+T` nova aba · `Ctrl+W` fechar aba · `Ctrl+Tab` próxima aba · `Ctrl+Shift+N` nova anotação · `Ctrl+K` pesquisa · `Ctrl+N` nova tarefa · `Ctrl+B` barra lateral · `Ctrl+1..4` navegação · `Esc` fecha painel.

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

(`dev` e `build` executam `npm run assets`, que copia as fontes do editor de desenho para uso offline.)

`rebuild:electron` compila o SQLite nativo para o Electron. Para rodar os testes (que usam o Node),
recompile para o Node antes: `npm rebuild better-sqlite3`.

## Testes

```bash
npm test
```

Cobrem: anexos (cópia/vínculo, dedup, ausentes, exclusão que preserva originais), lembretes, aviso de prazo, central, notas flutuantes persistidas, capturas inseridas em nota/quadro, migração v3→v4; Teste 3 (quadro com tarefa, nota, desenho livre, seta, imagem, grupos e câmera idênticos após reabrir), Teste 4 pela camada de dados do quadro, versões/lixeira/vínculos de desenhos, migração v2→v3; Teste 2 (nota com formatação, checklist, tabela e imagem preservada após reabrir), migração v1→v2
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
| Biblioteca de arquivos | `%APPDATA%\Workspace\files\` |

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
| 3 | Editor de desenhos, quadro infinito, conectores, tarefas/notas sincronizadas no quadro | **Concluída** |
| 4 | Arquivos/anexos, captura de tela, notas flutuantes, agenda/lembretes, abas e painéis divididos | **Concluída** |
| 5 | Backup ZIP (exportar/verificar/restaurar), otimizações, empacotamento final | Pendente |

Ainda **não** existe: atalhos personalizáveis e backup ZIP / restauração (Etapa 5).
