# Backup e restauração — documentação técnica

Implementação: `src/main/backup/backup.ts` (sem dependência do Electron; testada em `tests/backup.test.ts`).

## Conteúdo do ZIP

```
manifest.json                 manifesto (ver abaixo)
db/workspace.sqlite           banco completo: tarefas, subtarefas, status, prioridades, projetos, categorias,
                              etiquetas, anotações e versões, desenhos e quadros (objetos, posições, câmera, zoom),
                              imagens das notas/quadros, lembretes, notas flutuantes, histórico, lixeira,
                              preferências de aparência, abas, divisão de tela e demais configurações
files/<aa>/<sha256>.<ext>     biblioteca interna de arquivos (PDFs, imagens, documentos…)
linked/<id>/<nome>            somente se o usuário escolher: cópias dos arquivos apenas vinculados
```

O banco é copiado com a **API de backup online do SQLite** (`db.backup`), que gera uma cópia consistente mesmo
com o programa aberto e sem bloquear o uso. Os dados originais nunca são modificados pela exportação.

### manifest.json

| Campo | Descrição |
|---|---|
| `format` | versão do formato do backup (atual: 1) |
| `appVersion`, `dbVersion` | versão do programa e do esquema do banco |
| `createdAt` | data/hora (ISO 8601) |
| `counts` | totais por tipo (tarefas, anotações, quadros, arquivos…) |
| `files[]` | `path`, `size`, `sha256` de cada arquivo do ZIP |
| `includeLinked` | se cópias de arquivos vinculados foram incluídas |
| `linkedNotIncluded[]` | arquivos vinculados que **não** estão no backup (nome e caminho original) |

## Exportação

1. Cópia consistente do banco para uma pasta temporária.
2. Inventário e **verificação de espaço livre** no destino (erro claro se insuficiente).
3. SHA-256 de cada arquivo; criação do ZIP em `<destino>.parcial` (arquivos já comprimidos são armazenados sem recompressão); `fsync`.
4. **Verificação completa** do ZIP gerado (mesma rotina do item “Verificar”).
5. Somente então o arquivo é renomeado para o nome final e o sucesso é informado. Em qualquer falha o `.parcial` é removido.
6. Registro em `backup_log` (histórico exibido nas configurações).

## Verificação

Sem alterar dados: abre o ZIP, rejeita entradas inseguras, lê o manifesto, confere formato e compatibilidade de
versão, existência, tamanho e SHA-256 de cada arquivo, extrai o banco para um temporário e executa
`PRAGMA integrity_check`, além de contar os registros para o resumo. Avisa sobre arquivos vinculados não incluídos.

## Restauração (em duas fases)

**Fase 1 — preparação (com o programa aberto, sem tocar nos dados atuais)**
1. Verificação completa do ZIP; backups de versão mais nova são recusados.
2. Confirmação do usuário (com resumo do conteúdo).
3. **Cópia de segurança automática** dos dados atuais em `backups\antes-da-restauracao-*.zip` (verificada).
4. Extração para `restauracao-preparo-*` com **validação de caminhos** (somente `manifest.json`, `db/…`, `files/<aa>/<arquivo>`,
   `linked/<id>/<arquivo>`; sem caminhos absolutos, `..` ou letras de unidade — proteção contra *zip slip*), sem sobrescrever arquivos.
5. Migrações aplicadas à cópia preparada (se o backup for de versão anterior) e verificação de integridade.
6. Arquivos vinculados incluídos no backup cujo original não existe neste computador passam para a biblioteca interna.
7. Grava `restauracao-pendente.json` (gravação atômica). O usuário pode cancelar antes de reiniciar.

**Fase 2 — troca (na inicialização, antes de abrir o banco)**
1. Move `data\` e `files\` atuais para `dados-anteriores-<data>\` (não apaga), registrando cada passo no marcador.
2. Move os dados preparados para o lugar e valida a integridade.
3. Em qualquer falha, desfaz a troca. Se a troca for interrompida (ex.: queda de energia), a próxima inicialização
   detecta o marcador e **restaura os dados anteriores**.
4. O resultado é mostrado ao usuário ao abrir o app.

## Testes que cobrem este fluxo

Exportação/restauração completa em ambiente limpo (tarefas, subtarefas, etiquetas, notas e versões, imagens,
quadros com câmera, anexos internos e vinculados, preferências, abas, notas flutuantes, lembretes e relacionamentos),
arquivos vinculados não incluídos, substituição com preservação dos dados anteriores, ZIP adulterado, *zip slip*,
arquivo que não é backup, versão mais nova, troca interrompida, falha na troca com reversão e cancelamento.
No Electron real (`tests/e2e`), o Teste 5 exporta, restaura em uma pasta de dados vazia e no mesmo computador.
