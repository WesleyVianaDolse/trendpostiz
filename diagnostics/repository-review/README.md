# Inventário, preservação e limpeza — 17/11/2026

## Resultado

A v1.7.4 voltou a funcionar com 32 workers após reinício exclusivo do orchestrator, segundo o operador. Esta revisão não acessou a VPS. A causa específica do travamento permanece desconhecida; não há evidência para afirmar que o conjunto local v1.7.5 seja necessário para corrigi-lo.

A árvore de desenvolvimento foi preservada em snapshot privado externo antes da limpeza. Apenas quatro caches ignorados do TypeScript foram removidos. Na revisão inicial não houve alteração de código, configuração da aplicação, migração, histórico técnico, branch, staging ou commit. A documentação foi organizada por índices, sem mover programas existentes.

Na etapa posterior, o operador autorizou a criação de `dev/v1.7.5-preserved-2026-11-17` e de um commit de checkpoint revisado. O checkpoint preserva o desenvolvimento e não representa release, correção certificada do travamento ou autorização de ativação. O diff preexistente de `docker-compose.yaml` permanece fora do commit e intacto na árvore local; sua cópia continua no snapshot. `diagnostics/recovery/r28-linux-lab-local.json` é mantido fora do commit como metadado temporário local, igualmente preservado no snapshot. Credenciais, caches e demais temporários ignorados não entram no checkpoint. Nenhuma exclusão adicional foi feita: a finalidade dos históricos retidos não foi considerada descartável.

A revisão do staging encontrou apenas duas advertências de whitespace: uma linha em branco extra ao final de cada baseline SQL, em `baseline-proposal/00000000000000_v1_7_4_baseline/migration.sql` e `baseline-proposal/prisma-owned/migrations/00000000000000_v1_7_4_prisma_owned/migration.sql`. Esses bytes foram mantidos para preservar os hashes históricos; não se corrigiu formatação de migrações durante o checkpoint. A checagem das demais regras de whitespace passou com `core.whitespace=-blank-at-eof`. Os resultados da revisão inicial abaixo continuam descrevendo seu escopo original, anterior ao staging dos arquivos novos.

## Origem e inventário completo

| Item | Resultado inicial |
| --- | --- |
| Branch | `main` |
| HEAD e upstream `origin/main` | `36f4cd9971d5f304b0ab94f373160ea632341ac4` |
| Assunto | `fix: direct message instagram business v1.7.4` |
| Commit anterior | `35ac133fc37d0b85c8b002a22fbd0134d23e3312` — `fix: v1.7.3 update api meta, connection` |
| Modificados rastreados | 33; diff de 743 inserções e 360 remoções |
| Não rastreados | 193 arquivos, enumerados individualmente |
| Staged | 0 |
| Total original | 226 arquivos, 3.362.523 bytes |

As versões foram identificadas pelos assuntos dos commits; não existe tag local `v1.7.4`. O [inventário integral](inventory-2026-11-17.json) registra caminhos, estados, tamanhos, SHA-256, categorias, duplicatas e referências encontradas. Ele representa a entrada da revisão, antes dos novos índices/relatórios produzidos neste trabalho. A lista final de novos arquivos será registrada na verificação.

| Categoria técnica do inventário | Arquivos |
| --- | ---: |
| Aplicação/configuração/build | 49 |
| Testes de regressão | 9 |
| Código de diagnóstico/harness | 68 |
| Evidências/gerados de diagnóstico | 36 |
| Documentação | 24 |
| Ferramentas operacionais experimentais | 13 |
| Migrações/baseline | 27 |

As categorias contam apenas os 226 arquivos originais e são distintas da avaliação de prioridade abaixo. Arquivos ignorados foram identificados por grupo: `.env`, dependências, builds, `.next`, `tmp/`, caches e arquivo gerado do Next. Não foram inventariados valores de ambiente nem dados de clientes.

## Preservação recuperável

Local do snapshot: `C:\Users\viana\Documents\GitHub\trendpostiz-preservation\2026-11-17-8b69a646fc\worktree-private.zip`.

SHA-256: `a7989e83e220e03af8bb43f3ecc84288e6501ecc69bfa085f362c99da3a14f69`.

O ZIP contém os 226 arquivos originais, o inventário, os quatro caches em seção separada, manifest de hashes, instruções de restauração e patch binário dos rastreados. Foram verificados CRC e SHA-256 de todas as 231 entradas de conteúdo; o patch passou em `git apply --check --cached` contra o índice original, sem modificá-lo. Veja o [recibo](preservation-receipt-2026-11-17.json).

O snapshot exclui `.env`, chaves, temporários ignorados, dependências, builds, histórico/configuração Git e bytes de imagens Docker. A varredura não encontrou padrões de credenciais reais nos arquivos selecionados; sete ocorrências de literais de credenciais pertencem a fixtures sintéticos. Isso não equivale a uma certificação universal de ausência de segredos: o backup é privado e não deve ser enviado integralmente a terceiros. Defaults antigos existentes no Compose não foram modificados nem publicados no relatório.

O recibo da imagem Linux candidata é preservado, mas sua presença não prova que os bytes da imagem ainda existam no Docker local. Este snapshot não é um export OCI e não permite prometer reprodução do mesmo digest. Não houve inspeção, inicialização ou remoção de imagens nesta revisão.

Para restaurar, usar outro checkout no commit exato e seguir `RESTORE.txt`, conferindo os hashes antes de copiar o overlay. Não usar reset/clean na árvore atual. O patch dos rastreados é uma alternativa à restauração desses mesmos arquivos pelo overlay; não aplicar ambos indiscriminadamente.

## Proposta inicial de branch e autorização posterior

O roteiro abaixo registra a proposta inicial. A criação da branch e do checkpoint foi posteriormente autorizada; suas exceções estão descritas acima. Não executar novamente o comando de criação se a branch já existir. Os inventários e verificações JSON anteriores permanecem como retratos da etapa inicial, sem serem reescritos para parecerem atuais.

1. Criar `dev/v1.7.5-preserved-2026-11-17` sobre `36f4cd9971d5f304b0ab94f373160ea632341ac4`. Comando previsto: `git switch -c dev/v1.7.5-preserved-2026-11-17`.
2. Conferir o diff e selecionar paths explicitamente; não usar `git add .` ou `git add -A`. Ignorados e backup externo não devem entrar no commit.
3. Revisar novamente credenciais e metadados locais antes do staging. Guardar apenas evidência sanitizada útil; manifests completos, logs e fixtures devem ser avaliados individualmente. Não incluir `r28-linux-lab-local.json` automaticamente.
4. Criar um checkpoint revisado após a autorização, recebida nesta etapa posterior. Avaliar correções pequenas em branches derivadas da base funcional somente em trabalho futuro. Separação de hunks exige revisão porque runtime, schema e admissão são interdependentes.

Criar uma branch sozinha não salva conteúdo não commitado nem arquivos não rastreados. Por isso o snapshot foi feito antes de qualquer limpeza; o checkpoint posterior dependeu da autorização expressa do operador.

## Classificação por necessidade

| Grupo | Evidência e caminhos principais | Decisão proposta |
| --- | --- | --- |
| Correções necessárias a revisar separadamente | `.dockerignore` exclui credenciais do contexto; `package.json`/`docker-compose.yaml` removem `db push --accept-data-loss` automático e `pm2 delete all`. | São riscos concretos a tratar, mas os mesmos diffs introduzem um preflight fechado. Separar e validar os hunks antes de adotar. Não são prova de correção do travamento. |
| Correção já existente na base | Private Reply tradicional via Page ID no commit de origem. | Preservar a base. Nenhum novo ajuste de OAuth, scopes ou providers Instagram é necessário nesta limpeza. |
| Melhorias opcionais de resiliência | `automation-recovery/`, schema/migrações, V106, scheduling, ledger/claims, resultados incertos e contratos de ações derivadas. | Preservar em desenvolvimento. Proteções úteis, porém mudam comportamento e exigem homologação própria; não transportar o conjunto para produção funcional. |
| Testes relevantes | Specs backend/frontend, harnesses PostgreSQL/Temporal/HTTP e verificação Prisma/Mastra. | Manter: documentam riscos de duplicidade e compatibilidade. O teste isolado não certifica a VPS. |
| Documentação essencial | Plano R01–R31, fechamento F–G, E/R27, baseline/Mastra, investigação de startup. | Um [ponto de entrada atual](../../docs/v1.7.5/README.md), mantendo relatórios anteriores como histórico. |
| Complexidade não necessária à estabilização atual | Admissão assinada Ed25519, T0/hash de inventário e banco, janela de 30s, bloqueio global de startup, protótipo V106 e scaffolding de contenção. | Colocar em revisão de escopo. Não remover componentes acoplados durante limpeza. O preflight sempre sai 78; `admitted-main.ts` permite somente laboratório. O conjunto não está apto a deploy. |
| Descartáveis comprovados | Quatro `.tsbuildinfo` ignorados. | Removidos após snapshot e conferência dos hashes. Regeneráveis, sem alteração de comportamento. |

Essa classificação não declara inúteis as proteções anteriormente solicitadas: separa sua finalidade futura da operação atualmente restaurada. As mudanças não foram cherry-picked, revertidas ou simplificadas nesta execução.

## Mantidos, organizados e removidos

Todos os 226 arquivos originais de código, configuração, migração, testes, scripts, documentação e evidências foram mantidos com os mesmos bytes. Também foram mantidos os builds, dependências e temporários ignorados; não se presumiu que `tmp/` fosse seguro para exclusão.

A organização foi lógica: índices novos em `docs/v1.7.5/README.md`, `diagnostics/README.md` e `scripts/README.md`. Não houve movimentação física de scripts nem remoção de documentos antigos. Caminhos existentes fazem parte de imports, comandos, hashes e evidências.

Removidos exclusivamente: `tsconfig.tsbuildinfo`, `apps/backend/tsconfig.tsbuildinfo`, `apps/frontend/tsconfig.tsbuildinfo`, `apps/orchestrator/tsconfig.tsbuildinfo`. Total: 28.207.425 bytes (26,9 MiB). Todos podem ser restaurados da seção `regenerable-cache/` do snapshot. [Diário da limpeza](cleanup-2026-11-17.json).

## Lista que exige aprovação antes de excluir ou mover

| Arquivos | Motivo para revisar | Dependência/decisão pendente |
| --- | --- | --- |
| `diagnostics/recovery/buildBackend-r27.log`, `buildOrchestrator-r27.log` | Vazios e sem referência textual encontrada. | Ainda são evidências de uma etapa de build; aprovar retirada ou retenção histórica. |
| `diagnostics/recovery/buildBackend-fg.log`, `buildOrchestrator-fg.log` | Vazios. | Referenciados por `fg-build-results.json`; não excluir sem revisar o relatório. |
| `diagnostics/recovery/buildFrontend-r27.log` | Log anterior à rodada F–G. | Não equivale ao log F–G; ausência de referência não prova ausência de finalidade. |
| `diagnostics/recovery/r28-compact-linux-runtime.log` | Registro pequeno de execução antiga. | Valor de auditoria a confirmar antes de arquivar/remover. |
| `diagnostics/recovery/r28-linux-lab-local.json` | Metadados de caminhos/distribuição locais. | Não promover a evidência compartilhada; preservar prova local de limpeza até aprovação. |
| `diagnostics/recovery/archive/fg-review-candidate-before-final-20261116.json` | Manifest histórico grande. | Guarda evolução da revisão; não há prova de equivalência com os posteriores. |
| `docs/v1.7.5-implementation-status.md`, `v1.7.5-local-recovery-report.md`, `v1.7.5-fg-operational-report.md` | Estados anteriores superados em parte. | Aprovar eventual mudança para arquivo histórico; atualizar referências em conjunto. |
| `docs/v1.7.5-r28-infrastructure-audit.md` | Coletor extenso sucedido pelo compacto. | Preservar investigação/integridade da versão anterior; aprovar arquivamento. |

Não são candidatos à exclusão automática: as seis duplas de SQL idêntico nas cadeias candidata/histórica, snapshots de schema, manifests atuais, logs citados por resultados e o coletor Python arquivado usado nos testes. Há sete grupos de bytes duplicados no inventário: um de quatro logs vazios e seis de migrações. Igualdade de bytes não demonstra redundância de função.

Não foi feita varredura indiscriminada de node_modules, imagens ou dados de clientes para ampliar artificialmente a limpeza. A ausência de referência textual foi tratada apenas como indicação; referências dinâmicas podem existir.

## Verificações

O resultado está em [verification-2026-11-17.json](verification-2026-11-17.json). Foram aprovados:

- Integridade SHA-256 dos 226 arquivos originais e do patch rastreado; branch e HEAD preservados, staging vazio.
- 21 links locais dos novos índices e hash original do coletor R28.
- Verificação local da cadeia candidata Prisma-owned, sem executar Prisma ou conectar ao banco.
- 42 testes sintéticos: infraestrutura 16, coletor compacto 10, transporte SDK 8 e snippets operacionais 8.
- Checagens TypeScript do backend e do orchestrator, ambas com `--noEmit --incremental false`.
- `git diff --check`.

Esses testes foram executados localmente no Windows com fixtures, sem repetir a homologação Linux/Temporal/PostgreSQL nem usar a VPS. Nenhum resultado histórico de build foi apresentado como execução atual. Builds completos não são necessários para índices e remoção de caches e poderiam reescrever artefatos ligados a evidências anteriores.

Nenhum processo da aplicação, worker, conexão PostgreSQL, Prisma CLI, Docker ou comando remoto foi iniciado nesta revisão. Produção, OAuth, integrações e Private Reply permanecem fora do escopo.
