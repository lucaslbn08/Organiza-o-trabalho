# Workspace

Programa de produtividade e organização pessoal para **Windows 10 e 11**: tarefas, Kanban, anotações,
desenhos, quadros infinitos, agenda, arquivos, capturas de tela, notas flutuantes e backup completo.
Funciona **totalmente offline**, sem cadastro, login ou servidor. Interface em português do Brasil.

> **Status: versão 1.0.0 — Etapas 1 a 5 concluídas.** Veja o que foi verificado e as limitações conhecidas no fim deste arquivo.

## Funcionalidades

| Área | Destaques |
|---|---|
| **Início** | contadores por status, prioritárias, prazos/atrasadas, notas, desenhos e quadros recentes; painéis arrastáveis e ocultáveis; adição rápida |
| **Tarefas** | status, prioridade, categoria, projeto, prazo com horário, etiquetas, checklist, subtarefas com progresso, comentários, links, anexos, notas e desenhos associados, recorrência, histórico; duplicar, lixeira, reordenar, arrastar entre categorias, filtros, pesquisa, ordenação, exibir/ocultar concluídas |
| **Kanban** | o mesmo registro das tarefas; arrastar muda o status; colunas personalizáveis; filtro por projeto |
| **Anotações** | editor rico (títulos, listas, checklists, cores, destaque, links, tabelas, imagens/capturas coladas, código, separadores), pastas e subpastas, etiquetas, fixar, favoritas, várias abertas e lado a lado, salvamento automático, **histórico de versões**, pesquisa de texto completo |
| **Desenhos** | lápis/pincel, borracha, linhas, setas, formas, texto, seleção, cores, espessura, zoom, grade, alinhamento, duplicação, imagens; **objetos editáveis**; exportação PNG/PDF; versões |
| **Quadro infinito** | notas adesivas, caixas de texto, **cartões de tarefa interativos sincronizados**, cartões de anotação, checklists clicáveis, imagens, **PDFs como referência**, links para arquivos/quadros, conectores, agrupamentos, bloqueio, zoom pela roda; câmera e zoom restaurados; exportação ajustada ao conteúdo |
| **Agenda** | dia, semana e mês; arrastar tarefa para outro dia; lembretes; notificações do Windows; central de notificações |
| **Arquivos** | **copiar para a biblioteca interna** (entra no backup) ou **vincular o original**; arrastar do Windows; visualização de imagens, PDFs e texto; abrir no app padrão; pastas; detecção de ausentes; executáveis nunca são abertos |
| **Captura de tela** | região, janela ou tela inteira → nota, tarefa, desenho, quadro ou área de transferência |
| **Notas flutuantes** | janelas pequenas sobre outros programas, cor, minimizar, fixar, relacionar a tarefa, reabertas automaticamente |
| **Projetos e espaços** | projetos com cor reunindo tarefas, notas, desenhos, quadros e arquivos; espaços de trabalho independentes |
| **Pesquisa** | Ctrl+K: tarefas, notas (texto completo, sem acentos), projetos, etiquetas, desenhos, quadros e arquivos + paleta de comandos |
| **Área de trabalho** | abas, divisão lado a lado/horizontal, sessão restaurada, atalhos personalizáveis, tema claro/escuro, cor, escala |
| **Segurança dos dados** | SQLite com WAL + transações, migrações versionadas com backup preventivo, lixeira, histórico, **backup ZIP verificado**, restauração segura |

Atalhos padrão (todos personalizáveis em Configurações → Interface): `Ctrl+K` pesquisa · `Ctrl+N` tarefa ·
`Ctrl+Shift+N` anotação · `Ctrl+Shift+F` nota flutuante · `Ctrl+Shift+S` captura · `Ctrl+T`/`Ctrl+W` abas ·
`Ctrl+Tab` próxima aba · `Ctrl+B` barra lateral · `Ctrl+1…5` navegação.

## Instalar (usuário)

Execute `Workspace-Setup-<versão>.exe`. A instalação é por usuário (não exige administrador) e permite escolher
a pasta. O instalador não é assinado digitalmente: o Windows SmartScreen pode pedir “Mais informações → Executar assim mesmo”.

## Desenvolvimento

Requisitos: **Node.js 20+** (testado com 22) e Git. Não é preciso compilar nada nativo: o `better-sqlite3` usa
binários Node-API pré-compilados, válidos para Node e Electron.

```bash
npm install
```

```bash
npm run dev
```

| Script | O que faz |
|---|---|
| `npm run dev` | Vite + Electron com recarga do renderer |
| `npm run build` | compila processo principal (tsc) e interface (Vite) em `dist/` |
| `npm run typecheck` | verificação de tipos dos dois lados |
| `npm test` | testes automatizados (Vitest) das funções críticas |
| `npm run test:e2e` | ponta a ponta no **Electron real** (Playwright): Testes 1 a 7 |
| `npm run dist:win` | gera o instalador NSIS em `release/` |
| `npm run dist:dir` | gera só a pasta `release/win-unpacked` (para testar sem instalar) |

No Linux, o teste de ponta a ponta precisa de um servidor X: `xvfb-run -a npm run test:e2e`.

### Gerar o instalador

No Windows:

```bash
npm run dist:win
```

Saída: `release/Workspace-Setup-<versão>.exe`. Também é possível gerar a partir do Linux (requer `wine` para o
passo do NSIS). Configuração em `package.json → build`; ícones em `build/`.

## Onde ficam os dados

Tudo fica em `%APPDATA%\Workspace` — **separado da pasta de instalação**:

| Item | Local |
|---|---|
| Banco de dados (tarefas, notas, quadros, imagens, preferências, abas…) | `data\workspace.sqlite` (+ `-wal`) |
| Biblioteca interna de arquivos | `files\` |
| Backups preventivos de migração e cópias antes de restaurar | `backups\` |
| Registro de erros técnicos | `logs\workspace.log` |
| Dados substituídos por uma restauração (guardados, não apagados) | `dados-anteriores-<data>\` |

Para uso portátil ou testes, a variável de ambiente `WORKSPACE_DATA_DIR` aponta para outra pasta.

## Atualizar sem perder dados

1. Instale a versão nova **por cima** da atual (não é preciso desinstalar). O desinstalador também nunca apaga `%APPDATA%\Workspace`.
2. Na primeira abertura o Workspace verifica a versão do banco; se houver migrações, **cria um backup preventivo**
   (`backups\pre-migracao-v<N>-*.sqlite`), aplica cada migração em transação, valida a integridade e registra no log.
3. Se algo falhar, nada é alterado e uma mensagem informa o problema; se o banco for de uma versão **mais nova**
   que o programa, ele se recusa a abri-lo (sem modificar).

Para quem desenvolve: migrações ficam em `src/main/db/migrations.ts`, são **somente acrescentadas** (nunca editadas) e testadas
(incluindo atualização a partir de cada versão anterior).

## Backup e restauração

Configurações → **Dados e backup**. Detalhes técnicos em [docs/BACKUP.md](docs/BACKUP.md).

- **Exportar**: escolha destino e nome; barra de progresso; o ZIP é gravado como `.parcial`, **verificado por completo**
  e só então renomeado — a mensagem de sucesso aparece apenas após a verificação. Trata falta de espaço em disco.
- **Verificar**: confere manifesto, versões, SHA-256 de cada arquivo e integridade do banco contido, sem alterar nada.
- **Restaurar**: verifica, mostra o que será restaurado, pede confirmação, cria uma cópia de segurança dos dados atuais,
  extrai com validação de caminhos e só troca os dados na reinicialização; qualquer falha mantém os dados anteriores.

## Testes

- `npm test` — 47 testes: tarefas, Kanban, notas, versões, pesquisa, desenhos/quadros, sincronização, anexos,
  lembretes, notas flutuantes, capturas, migrações v1→v5, **backup/verificação/restauração** (inclusive adulteração,
  zip slip, versão incompatível, queda de energia durante a troca e reversão), desempenho com milhares de itens.
- `npm run test:e2e` — no Electron real: Testes 1 (tarefas), 2 (notas), 3 (quadro), 4 (sincronização), 5 (backup em
  ambiente limpo), 6 (atualização sobre dados antigos) e 7 (encerramento abrupto), além de protocolo seguro, CSP,
  fontes offline e janelas de notas flutuantes.

## Estrutura e arquitetura

Visão técnica, estrutura de pastas e modelo de dados: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Dependências principais

| Pacote | Uso |
|---|---|
| electron, electron-builder | aplicativo desktop e instalador NSIS |
| react, vite, typescript | interface |
| better-sqlite3 | banco SQLite local (transações, WAL, FTS5, backup online) |
| zod | validação de toda entrada vinda da interface |
| @tiptap/* | editor de anotações |
| @excalidraw/excalidraw | desenhos e quadro infinito (MIT) |
| @dnd-kit/* | arrastar e soltar (listas, Kanban) |
| pdfjs-dist | visualização de PDFs |
| jspdf | exportação PDF de desenhos/quadros |
| yazl, yauzl | criação e leitura do backup ZIP |
| lucide-react | ícones |
| vitest, playwright | testes |

## Limitações conhecidas

- O instalador não tem assinatura digital (requer certificado de assinatura de código).
- A verificação de atualizações consulta as *Releases* do repositório no GitHub apenas quando o usuário clica; a instalação da nova versão é manual.
- Captura de tela, notificações do Windows e janelas de diálogo (abrir/salvar) dependem do sistema e não são exercitadas pelos testes automatizados; a lógica por trás deles é testada.
- O editor de desenho declara uma CDN como fonte alternativa das fontes; o CSP a bloqueia (o app nunca acessa a rede) e as fontes locais são usadas. Isso gera avisos inofensivos no console de desenvolvedor.
