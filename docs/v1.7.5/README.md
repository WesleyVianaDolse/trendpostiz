# v1.7.5 — ponto de entrada e estado atual

Atualizado em 17/11/2026. Esta página consolida o estado do desenvolvimento; os relatórios anteriores permanecem como evidência histórica.

## Produção e decisão atual

O operador informou que a v1.7.4 voltou a funcionar após reiniciar somente o orchestrator e que os 32 workers estão saudáveis. Não houve verificação independente da VPS neste trabalho. O reinício bem-sucedido não identifica a causa específica do travamento anterior.

A prioridade é preservar e revisar o desenvolvimento local. Não há autorização para deploy, migrações, contenção, recuperação, liberação de filas ou promoção de release. Os roteiros operacionais anteriores não devem ser executados com base em sua mera existência.

## Desenvolvimento preservado

- Base: `36f4cd9971d5f304b0ab94f373160ea632341ac4`, assunto `fix: direct message instagram business v1.7.4`.
- A revisão encontrou 33 arquivos rastreados modificados e 193 arquivos não rastreados, sem staging, sobre `main`, igual a `origin/main`.
- Há um snapshot privado externo, com hashes verificados, das alterações originais. Inventário, recibo e revisão: [auditoria do repositório](../../diagnostics/repository-review/README.md).
- O checkpoint autorizado será preservado em `dev/v1.7.5-preserved-2026-11-17`, sem merge, push ou promoção de release. O estado inicial em `main` continua registrado no inventário histórico.
- O diff anterior de `docker-compose.yaml` fica fora do checkpoint e permanece intacto na árvore local e no snapshot. `diagnostics/recovery/r28-linux-lab-local.json` também fica fora do commit, por conter metadados temporários locais. Nenhum arquivo de ambiente é incluído ou alterado.

O fechamento anterior registrou 30/31 cenários no escopo isolado. R28 não está certificado operacionalmente. Esses resultados são históricos; esta limpeza não recertifica a recuperação nem testa a infraestrutura real.

O código local altera agendamento, schema, workflows e admissão. O preflight continua bloqueando o startup, e o entrypoint de admissão aceita apenas laboratório isolado. Portanto, a árvore local inteira não é uma atualização implantável da v1.7.4 funcional.

## Documentação técnica principal

| Finalidade | Documento |
| --- | --- |
| Requisitos e cenários R01–R31 | [Plano de recuperação segura](../v1.7.5-safe-recovery-plan.md) |
| Contratos locais R04/R14 e limites de R28 | [Fechamento F–G](../v1.7.5-final-fg-handoff.md) |
| Resultado de ações derivadas | [E/R27](../v1.7.5-derived-actions-r27.md) |
| Baseline candidata | [Proposta](../v1.7.5-baseline-proposal.md) e [diferenças ambientais](../v1.7.5-baseline-production-differences.md) |
| Propriedade Prisma/Mastra | [Fronteira e cadeia Prisma-owned](../v1.7.5-prisma-mastra-ownership.md) |
| Evidência anterior do travamento | [Inicialização nativa do orchestrator](../temporal-orchestrator-native-startup-v1.7.4.md) |
| Script R28 de leitura | [Diagnóstico compacto](../v1.7.5-r28-compact-audit.md) |
| Roteiros futuros, sem autorização de execução | [Homologação](../v1.7.5-r28-candidate-homologation-plan.md) e [contenção](../v1.7.5-r28-operational-containment-plan.md) |

## Histórico e organização

`v1.7.5-implementation-status.md`, `v1.7.5-local-recovery-report.md` e `v1.7.5-fg-operational-report.md` descrevem marcos anteriores; suas pendências foram parcialmente superadas pelo fechamento F–G. Não devem ser usados como estado operacional atual. A auditoria extensa R28 foi sucedida pela versão compacta. Esses arquivos continuam preservados até aprovação de eventual arquivamento, pois têm referências e valor de auditoria.

Os programas operacionais permanecem em `scripts/recovery/`, os harnesses e evidências em `diagnostics/recovery/`, e o contexto da imagem em `docker/`. A organização é feita por índices, sem mudar caminhos ligados a imports, hashes, scripts ou relatórios existentes. Consulte o [mapa dos diagnósticos](../../diagnostics/README.md) e o [mapa dos scripts](../../scripts/README.md).

Não apagar cópias de migrações nem atualizar manifests históricos para forçar igualdade de hashes. A cadeia candidata Prisma-owned e a cadeia parcial histórica têm funções diferentes.
