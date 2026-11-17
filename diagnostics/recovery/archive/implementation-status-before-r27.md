# TrendPostiz v1.7.5 — estado da implementação local

Atualização em 15/11/2026: **B concluída para desenvolvimento local; C–D parciais; saída de E bloqueada. Não implantar.**

Os sete checks de fronteira Prisma/Mastra informados pelo operador retornaram MATCH e terminaram com ROLLBACK. O registro está em `libraries/nestjs-libraries/src/database/prisma/baseline-proposal/prisma-owned/production-boundary-result.json`. Nenhuma nova consulta de produção ou transferência de dump é necessária. A diferença ambiental de collation permanece documentada.

O [relatório atual](v1.7.5-local-recovery-report.md) contém a cadeia candidata, as proteções implementadas, os arquivos, resultados, riscos, procedimento de implantação controlada e reversão. A versão anterior deste status foi preservada em `diagnostics/recovery/archive/implementation-status-before-boundary-closure.md`; seus bloqueios históricos de baseline não são solicitações atuais de auditoria.

Verificação local atual: 18/18 testes de propriedade/migrações, 23/23 testes das barreiras, 31/31 fixtures preliminares com PostgreSQL/Temporal/HTTP reais isolados. Regressões: 223 testes backend/bibliotecas/orchestrator e 23 frontend aprovados; 8 diferenciais históricos pulados. Builds backend/frontend/orchestrator aprovados em ambiente sintético.

**Os 31 fixtures não certificam os 31 cenários completos.** A avaliação individual, incluindo subcasos pendentes, está em `diagnostics/recovery/matrix-coverage-review.json`. O resultado executado conserva `fullMatrixCertified=false`.

Bloqueio comprovado de E: callbacks de plugs/reposts podem retornar boolean/void sem comprovante e ocultar erros. O novo fluxo ainda não preserva seu contrato completo; posts com essas configurações são explicitamente retidos. Ainda faltam subcasos de séries, filhos ABANDON, retries pendentes, reconciliação e UI. A progressão para uma saída certificada de F/G fica interrompida até resolver esses pontos.

`recovery-release.json` mantém `deliveryGuardsVerified=false`, `recoveryScenariosVerified=false` e `workerActivationImplemented=false`. O preflight sai 78; a fábrica de workers também recusa registro. O observador externo preparado não reinicia processos nem abre filas.

H–I continuam indisponíveis. Nenhum deploy, migração/resolve, restart, recuperação, reenvio ou alteração de produção foi executado. Instagram/OAuth/scopes e os endpoints de Private Reply permaneceram intactos. `version.txt` continua v1.7.4.
