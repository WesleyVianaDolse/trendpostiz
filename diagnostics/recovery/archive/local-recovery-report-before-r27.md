# TrendPostiz v1.7.5 — implementação local e limite de progressão

Estado em 15/11/2026: **fase B concluída para desenvolvimento local; C–D parcialmente implementadas e testadas; saída de E bloqueada. Não é uma release pronta.** F não está certificada; G tem somente preparação de observação e procedimento. H–I não têm caminho de ativação. `version.txt` continua v1.7.4.

Nenhuma operação foi executada na VPS, Meta ou Temporal de produção. Não foram alterados clientes, integrações ou suas autorizações. Os servidores de teste foram criados pelo harness, com dados sintéticos, PostgreSQL 17.11 e Temporal 1.28.2; a limpeza remove somente containers/redes com o label exclusivo da execução.

## Evidência da fronteira e cadeia Prisma

Os sete resultados informados pelo operador estão registrados em `libraries/nestjs-libraries/src/database/prisma/baseline-proposal/prisma-owned/production-boundary-result.json`:

| section | status |
| --- | --- |
| cross_boundary_fk | MATCH |
| cross_boundary_inheritance | MATCH |
| external_relation_kind | MATCH |
| routine_recorded_non_external_dependency | MATCH |
| timestamps_function_contract | MATCH |
| timestamps_on_non_external_relation | MATCH |
| unclassified_mastra_name | MATCH |

A procedência é o relato da execução manual em PostgreSQL 17.11, encerrada com ROLLBACK. O hash registrado identifica o SQL local correspondente; não inventa uma conferência independente de checksum na VPS. Não é necessário repetir essas consultas nem transferir dump.

A cadeia candidata administrada está em `baseline-proposal/prisma-owned`, com manifestos/hashes e projeções separadas do schema runtime:

1. `00000000000000_v1_7_4_prisma_owned`: 46 tabelas da aplicação; exclui DDL dos objetos externos explicitamente classificados. Preserva a ordem do enum atestada em produção.
2. `20261114000000_safe_recovery_foundation`: revisão, criação/procedência de comentários, recuperação/T0, controle fechado, ocorrências, decisões, bindings e evidências.
3. `20261115000000_recovery_effect_attempt`: reserva irreversível por efeito e fingerprint esperado do binding.
4. `20261115010000_schedule_intents_and_evidence`: admissão persistente de agendamentos e referências remotas do registro antes de revisão explícita.

As três migrações aditivas têm transação explícita. O laboratório comprovou aplicação em banco vazio, adoção de baseline em banco compartilhado sintético, idempotência, preservação real do SDK Mastra e rollback integral de cada migração aditiva sob falha injetada. O client runtime continua contendo as oito projeções Mastra para DML; nunca usar esse schema completo como alvo de DDL compartilhado.

As seis migrações parciais antigas e a proposta anterior que incluía Mastra foram preservadas como evidência histórica. Não combinar as duas baselines nem executar a cadeia parcial antiga após a baseline consolidada. A promoção do pacote candidato para um pacote operacional único ainda exige revisão de release; não foi feita adoção em produção.

Mastra permanece responsável por suas tabelas conhecidas, respectivos índices/constraints/triggers e `trigger_set_timestamps`. Nenhum DDL novo menciona esses objetos. Nomes novos ou dependências cruzadas bloqueiam revisão; não existe exclusão indiscriminada por prefixo.

A diferença ambiental de locale/collation continua documentada separadamente em `v1.7.5-baseline-production-differences.md`. Não foi alterada para produzir MATCH; afeta semântica de ordenação/uniqueness e não é simplesmente apagada da auditoria.

## Proteções implementadas

`AutomationRecoveryService` exige controle OPEN, run VERIFIED/autorizada, protocolo, geração e T0 persistidos. Banco/política indisponível não autoriza envio. Não há função de abertura nesta entrega. O laboratório cria autorizações exclusivamente nas próprias fixtures.

Workflows legados precisam de binding por workflow/run/ação, ocorrência e fingerprint aprovado. Ausência ou divergência retém a execução. A identidade de negócio e o claim independem de um novo workflow ID. As versões V101–V105 e seus comandos foram preservados.

Antes do HTTP, a activity valida organização, integração, pausa/exclusão, data, grupo, revisão, corte, evidência manual e dependência do pai. Há nova conferência após a reserva persistida. `CLAIMED` abandonado ou `UNCERTAIN` não é um lease liberável por timeout: novo POST fica bloqueado. Recibo positivo pode ser reaproveitado para concluir metadados, sem rede. Erro ou sucesso tardio não sobrescreve uma revisão nova.

Ocorrência avulsa vencida sem efeito conhecido recebe decisão persistente, resultado EXPIRED e projeção condicionada de `Post.state=ERROR`. A mensagem pede conferir eventual publicação manual. Não afirma ausência do conteúdo na rede. Recibos anteriores, séries e incertezas não são apagados.

O repositório faz alterações explícitas de agendamento com transação, incremento de revisão, escopo de organização e retenção de referências anteriores em `PublicationRecordEvidence`. Tentativa sem confirmação impede reagendamento. Trocar apenas estado/retry não remove decisão terminal. A lista de produção de novas intenções não faz terminações amplas de workflows por postId.

O protótipo V106 transporta IDs, revisão e horários persistidos, sem tokens no payload do novo workflow. Intervalo fixo mantém âncora UTC e gera identidade determinística para o próximo slot; âncora legada desconhecida é retida. **Isso ainda não comprova a recuperação completa de todas as séries legadas ou ramificações ABANDON.**

Comentários recebidos antes de T0 são suprimidos mesmo com execução pendente. Para chegada tardia, `entry.time` não é promovido a criação: o leitor separado pede `IGComment.timestamp`, com o token existente, sem alterar scopes. O [SDK oficial da Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/igcomment.py) define o campo e sua leitura GET; as particularidades reais das autorizações e dos dois hosts ainda precisam de homologação. Falha/ambiguidade de leitura retém o evento, sem resposta.

Prepare, claim, dispatcher, entregas, upsert e finalize têm barreiras/escritas condicionais. Corrida perdendo o claim não marca outro processamento como SKIPPED. Finalize não encerra execução com entrega PENDING. Falha tardia não apaga SUCCESS nem ID. Resposta pública e Direct têm claims separados; Direct falho mantém agregado FAILED.

Os arquivos das estratégias Instagram, seus endpoints, OAuth e scopes permaneceram iguais ao HEAD. Facebook Private Reply continua usando Page ID em `/messages`; Standalone continua usando seu contrato existente. O servidor HTTP sintético verificou esses caminhos; nenhuma chamada real à Meta foi realizada.

Conciliação manual usa organização e usuário autenticados, verifica vínculo ativo e exige ADMIN/SUPERADMIN para confirmação. A confirmação é atestação humana explícita, não validação automática da rede. Mantém resultado automático, revisão e incerteza; não recoloca em QUEUE nem libera claim. Evidência manual da mesma ocorrência bloqueia novo envio automático. A tela apresenta automação e confirmação manual separadamente. Testes HTTP de autorização e interação completa da nova tela ainda estão pendentes.

## Bloqueio para concluir E

Não é seguro declarar o protótipo V106 equivalente ao fluxo anterior de ações derivadas. Evidências concretas:

- `threads.provider.ts:autoPlugPost`, `linkedin.page.provider.ts:autoRepostPost` e outros plugs retornam boolean, sem propagar comprovante remoto ao chamador.
- `bluesky.provider.ts:autoRepostPost` pode retornar `true` também no ramo sem repost.
- `x.provider.ts:repostPostUsers` captura o erro e retorna sem comprovante (`void`).
- O consumidor `IntegrationService.processPlugs/processInternalPlug` não pode transformar esses retornos em confirmação real. A cadeia nova ainda não congela/admite todas essas ações futuras com seu contrato completo.

O protótipo retém explicitamente posts com configuração de plugs/ações derivadas (`DERIVED_EFFECT_CONTRACT_UNVERIFIED`), preservando o agendamento/configuração em banco. Não descarta silenciosamente essas ações, não inventa recibo e não libera reenvio de resultado incerto. Isso é contenção; **não satisfaz ainda a preservação operacional integral dos futuros**.

É necessário concluir um contrato explícito para ausência comprovada de efeito, efeito confirmado e efeito incerto; revisar os callbacks relevantes, a identidade lógica entre verificações de um mesmo plug e a admissão/binding dos horários futuros. O `true/false` atual não basta para inferir essa distinção genericamente. Também falta preservar todos os efeitos posteriores do fluxo novo, como notificações/webhooks, e finalizar visibilidade/auditoria de retenções e séries sem âncora. Não foram feitas alterações especulativas nos providers para contornar isso.

Conforme a condição de progressão aprovada, a saída de E está interrompida. Os testes executados são evidência de desenvolvimento das partes existentes, sem certificar a saída de F ou autorizar H–I.

## Verificação executada e limite dos 31 resultados

| Verificação | Resultado |
| --- | --- |
| `node diagnostics/recovery/test-prisma-ownership.mjs` | 18/18 O01–O18; PostgreSQL 17.11; SDK Mastra real; rollback de cada migração aditiva |
| `node diagnostics/recovery/test-delivery-guards.mjs` | 23/23 C01–C23; PostgreSQL e HTTP reais isolados; não substitui F |
| `node diagnostics/recovery/test-temporal-recovery.mjs` | 31/31 fixtures iniciais; 155 WorkflowTasks concluídas e 14 requisições sintéticas no último ciclo |
| Regressão Instagram/PostActivity/YouTube | 223 aprovados, 20 suites; 8 diferenciais antigos pulados, não contados como aprovação |
| Regressão frontend Instagram | 23 aprovados, 2 suites |
| Builds backend/orchestrator/frontend | Aprovados com ambiente sintético; sem iniciar aplicativos |
| Verificador de artefatos Prisma-owned | Aprovado, `productionAuthorized=false`, `workersAuthorized=false` |

Os fixtures Temporal usam as implementações de guards, repositórios, estratégias Instagram e activities de envio. Dependências de notificação/mídia e providers de publicação são substituídas por adapters sintéticos; não são homologação das APIs dos clientes. V101–V105 foram iniciados numa fila sem pollers e consumidos depois; seus históricos reais sintéticos passaram em `Worker.runReplayHistory`. A prova de crash usa processo filho descartável, inclusive saída abrupta antes e depois do commit. Nenhum teste faz replay/reset em produção.

**31/31 fixtures aprovados não significa 31 cenários integralmente certificados.** O arquivo `diagnostics/recovery/matrix-coverage-review.json` faz a avaliação individual R01–R31, relacionando evidência e subcasos restantes. `temporal-recovery-results.json` conserva `fullMatrixCertified=false`, `productionHomologated=false` e `activationAuthorized=false`. A matriz integral continua incompleta, especialmente R06–R07, R13–R20, R27–R30 e a passagem por todos os endpoints/UI/estados administrativos.

## Startup e observação externa

O startup não executa mais `prisma-db-push --accept-data-loss`. Helpers de db push/reset recusam DDL compartilhado. O preflight sai 78 e a própria fábrica de workers também recusa registro, inclusive no lançamento Node direto. Não há variável de ambiente para abrir essa implementação parcial. Alterar os booleans do release não contorna a ausência de H–I.

`scripts/recovery/watchdog-observe.cjs` é um processo observador externo, com timeout HTTP, sem API de restart ou consumo. Exemplos systemd não têm seção Install, têm Restart=no e não iniciam PM2/Docker/orchestrator. Não foram instalados, habilitados ou executados na VPS. Reinícios automáticos continuam indisponíveis. O travamento nativo específico de produção segue sem causa raiz comprovada.

## Procedimento de implantação controlada — somente proposta futura

Esta implementação não deve ser implantada agora. Antes de qualquer procedimento operacional:

1. Resolver a saída de E e todas as pendências da matriz, testar histórico/HTTP/UI e revisar o artefato completo. Atualizar a evidência de builds após alterações. Manter todos os consumidores/produtores de publicação contidos.
2. Preparar pacote único com a cadeia Prisma-owned revisada, client runtime separado, hashes e protocolo do consumidor. Conferir backup/restauração. Não usar a cadeia parcial antiga nem qualquer `db push` automático.
3. Somente em operação posteriormente autorizada, adotar a baseline existente como aplicada sem executar seus CREATE e aplicar apenas as migrações aditivas revisadas. Não marcar indiscriminadamente todas as migrações. Preservar os objetos Mastra e coordenar seus escritores DDL; não alterar collation/enum de produção.
4. Conferir schema, controle fechado e referências históricas. Inventariar todas as filas, workflow/run IDs, activities, retries, timers e filhos, além de posts/eventos de qualquer idade. Não limitar o inventário às 18 tasks ou aos últimos dois dias.
5. Preparar dry-run por ocorrência com T0 proposto explícito, identidade/revisão, origem da prova, destino, decisões e futuros preservados, sem tokens/conteúdo completo. Reconciliar manuais/incertos; não deduzir slot antigo do Post mutável atual. O gerador e executor completos desse manifesto continuam pendentes.
6. Atualizar o corte/manifesto se a retomada for adiada. H somente com autorização operacional específica e lotes idempotentes auditados; I somente depois de H verificada e consumidores protegidos. Esta entrega não contém comandos para abrir filas.

## Reversão e riscos restantes

Não há alteração de produção a reverter nesta entrega. Numa implantação futura, preservar schema/ledger/evidências aditivos; fechar admissão, interromper novos efeitos pelo procedimento aprovado e corrigir adiante. Não apagar históricos, remover colunas, executar down migration nem converter vencidos em QUEUE.

Um binário anterior às barreiras ignora o novo controle do banco. Portanto, rollback para esse binário com acesso às mesmas filas/credenciais de publicação é proibido. Exigir artefato permitido por digest/protocolo e contenção verificável dos consumidores antigos no gerenciador de processos/acesso Temporal e egresso. Essa contenção de infraestrutura ainda não foi implementada ou comprovada; sem ela, manter manutenção, sem rollback do consumidor. A linha BLOCKED sozinha não protege contra um binário antigo arbitrário.

Persistem: compatibilidade completa das ações derivadas, associação/retenção auditada de todos os ramos legados, projeções de threads/séries, ciclo completo de reconciliação, cursor/versões de manifesto, testes de reinício externo, homologação da leitura de metadados da Meta e políticas de rejeição comprovadamente sem efeito (inclusive a interação de rejeições YouTube com o claim comum conservador). Chamadas remotas já iniciadas não podem ser desfeitas por uma alteração posterior no banco. O claim bloqueia novos envios, mas não promete entrega exatamente uma vez sem suporte da API externa.

## Arquivos de implementação para revisão

- `automation-recovery/automation-recovery.service.ts`, `recovery-policy.ts`, `instagram-comment-time-reader.ts`, `publication-mutation-guard.ts`, `publication-scheduling.service.ts`, `publication-reconciliation.service.ts`, `worker-consumption.ts`.
- `schema.prisma`, `database.module.ts`, as três migrações aditivas e a cadeia/projeções/manifestações em `baseline-proposal/prisma-owned`.
- `posts.repository.ts`, `posts.service.ts`, `post.activity.ts`, `integration.service.ts`, `youtube-publication.service.ts`.
- Serviço/dispatcher de automações Instagram, repositórios de eventos/execuções e seus testes.
- `recovery-publication.activity.ts`, protótipo `post.workflow.v1.0.6.ts`, exports/registro do orchestrator.
- `posts.controller.ts`, `publication-recovery-history.tsx` e sua inclusão em `manage.modal.tsx`.
- `scripts/recovery/*`, `recovery-release.json`, scripts de startup globais/Compose já contidos.
- Harnesses/resultados em `diagnostics/recovery`, incluindo revisão individual da matriz e verificações de build/regressão.

O workspace já continha arquivos de diagnóstico anteriores; foram preservados. Não foi criado commit, tag ou release, nem executado deploy, restart, reconexão, reenvio ou mudança de configuração de produção.
