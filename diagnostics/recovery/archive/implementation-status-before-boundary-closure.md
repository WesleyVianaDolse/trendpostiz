# v1.7.5 — fase B: baseline proposta, comparação pendente

**Atualização — B concluída para desenvolvimento local:** os sete checks de fronteira foram relatados `MATCH`, com `ROLLBACK`. Evidência registrada no pacote Prisma-owned; cadeia e SQLs revisados, sem DDL Mastra. Collation ambiental permanece separada. O pacote Prisma-owned é a cadeia de referência para a implantação controlada futura, mantendo o histórico anterior como evidência. Desenvolvimento C–G autorizado; H–I e startup automático permanecem fechados. As seções históricas abaixo não solicitam repetir auditorias já concluídas.

Estado em 15/11/2026: **incompleta e não implantável**. O operador localizou as 93 divergências em objetos Mastra; nenhuma tabela da aplicação apareceu como divergente, e `enums` retornou `MATCH`. Foi validada uma nova candidata que separa DDL Prisma e Mastra, incluindo adoção local em PostgreSQL 17.11 com inicialização real de `PostgresStore` 1.8.5. O próximo passo é somente o pequeno check de fronteira em `baseline-proposal/prisma-owned/ownership-boundary-check.sql`, descrito em [fronteira Prisma/Mastra](v1.7.5-prisma-mastra-ownership.md). Não repetir auditorias anteriores nem transferir dumps. C–G continuam pendentes; H e I não foram iniciadas.

**Bloqueio comprovado**

O histórico versionado tem seis migrações anteriores de funcionalidades, mas não contém uma migração inicial que crie as tabelas-base. A primeira (`20260905000000_instagram_webhook_phase_one`) começa com `ALTER TABLE "Integration"`.

Foram executadas com Prisma **6.5.0**, exclusivamente em PostgreSQL descartável, duas verificações:

- Banco vazio: `migrate deploy` falha com **P3018**, na primeira migração, por ausência de `Integration` (PostgreSQL 42P01).
- Banco contendo o schema completo da v1.7.4, sem histórico Prisma: `migrate deploy` recusa a adoção com **P3005**. Esse banco é um fixture sintético, não uma cópia de produção.

O usuário confirmou PostgreSQL 17.11, schema `public` e ausência de `_prisma_migrations` em produção. A equivalência estrutural ainda não foi presumida. Não é seguro inventar esse histórico, marcar todas como aplicadas ou substituir o startup por `migrate deploy` automático. Baselining é uma adoção explícita de histórico existente, conforme a [documentação do Prisma](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining); o procedimento concreto deve ser compatível com 6.5.0 e com os metadados reais.

Para fechar B: confirmar a lista explícita de objetos externos, as dependências cruzadas e o contrato/uso da rotina mediante os sete pares do check de fronteira. A candidata `prisma-owned` substitui a baseline completa anterior para futura adoção; esta permanece como evidência. A separação não altera o resultado ambiental de collation nem oculta nomes desconhecidos. A reorganização da cadeia ativa e a adoção em produção não ocorreram. Só depois do fechamento e revisão avaliar C–G.

O antigo roteiro amplo de auditoria foi substituído por `diagnostics/recovery/baseline-audit/production-check.sql`, que consolida as consultas anteriores `01-database.sql` a `07-extras.sql` em uma única transação somente de leitura e retorna sete pares `section/status`. Pode ser copiado/colado, sem transferência de arquivo. Não consultar novamente a tabela de histórico já confirmada como ausente. O roteiro antigo permanece arquivado como registro da investigação anterior.

**Implementação realizada**

- Schema aditivo: `Post.scheduleRevision` com default 0; horário/procedência do evento e motivo de supressão em `InstagramWebhookEvent`.
- Seis estruturas de persistência: recuperação/T0, controle de liberação, ocorrências, decisões, vínculos workflow/run e evidências de publicação. Os identificadores históricos não usam cascatas que apaguem a auditoria junto com os sujeitos.
- Migração `20261114000000_safe_recovery_foundation`, transacional, sem exclusão ou alteração de dados existentes. Insere apenas controle `global/BLOCKED`, sem run, T0 ou autorização. A aplicação local foi validada diretamente como upgrade do schema anterior; **isso não equivale a uma cadeia de deploy resolvida**.
- Startup: removidos `db push` automático e `pm2 delete all` dos caminhos globais/Compose. Os helpers manuais `prisma-db-push` e `prisma-reset` agora recusam DDL compartilhado com código 78; o schema runtime conserva os modelos Mastra usados pelo client.
- Preflight de implementação incompleta antes de PM2 e do `pnpm start` do orchestrator. Sai com código **78**, sem carregar `.env`, acessar banco, iniciar workers ou executar migrações. Não há opção de ambiente para liberar esse preflight; a ativação H/I não está implementada.
- Harness PostgreSQL local com URL criada pelo teste, bind em loopback, ambiente sintético e limpeza somente dos recursos identificados pelo label exclusivo do teste. Não inicia aplicação, Temporal, workers ou providers.

O preflight é uma retenção desta implementação parcial, **não** uma defesa completa contra um binário legado executado diretamente. A política de envio, os resolvers de ocorrências, a conciliação autorizada/UI, as barreiras dos dois providers e a supervisão externa permanecem pendentes das fases seguintes. Nenhuma estratégia de Instagram, scope, OAuth, endpoint Page `/messages` ou reserva de Direct foi alterada. A causa do bloqueio nativo de inicialização permanece desconhecida.

**Verificação da fundação**

`node diagnostics/recovery/test-foundation.mjs` usa o schema do commit-base fixo `36f4cd9971d5f304b0ab94f373160ea632341ac4`. Não lê `.env`. A criação do schema anterior por diff em laboratório é apenas preparação de fixture e não foi adicionada como baseline de produção.

| Teste | Resultado |
| --- | --- |
| B01 — upgrade preserva posts, agenda futura, recorrência confirmada e evento antigo | PASS |
| B02 — controle inicialmente fechado, sem corte/recuperação autorizada | PASS |
| B03 — estado fechado persiste em conexões independentes | PASS |
| B04 — slots duplicados concorrentes rejeitados pela unicidade | PASS |
| B05 — evidência manual não substitui erro automático nem recibo existente | PASS |
| B06 — schema resultante corresponde ao modelo Prisma revisado | PASS |
| B07 — cadeia atual rejeita banco vazio: P3018 reproduzido | PASS da verificação negativa; bloqueio confirmado |
| B08 — adoção automática de banco populado é recusada: P3005 reproduzido | PASS da verificação negativa; bloqueio confirmado |
| B09 — erro injetado na migração reverte DDL inteiro e mantém dados | PASS |
| B10 — release incompleta recusa startup antes do aplicativo | PASS |

Resultados individuais de **R01–R31** estão em `diagnostics/recovery/foundation-results.json`: todos **BLOCKED**. Não são testes implementados/executados nem resultados aprovados de recuperação. A unicidade do schema de B04, por exemplo, não comprova R13, que requer os serviços de envio e concorrência real de workers. Não foi iniciado Temporal para essa etapa interrompida.

Regressões executadas com ambiente de testes sem credenciais de clientes: **188 testes backend/bibliotecas/orchestrator passaram em 18 suites Instagram**; os oito testes de integração diferencial anteriores foram pulados porque sua variável de banco específico não foi configurada. **23 testes frontend passaram em duas suites**. Os resultados dessas regressões não substituem R01–R31.

Builds de **backend, frontend e orchestrator passaram**, inclusive após gerar o Prisma Client 6.5.0 com o schema aditivo e configuração sintética. Os 188 testes backend também passaram com o Client atualizado. Nenhum build iniciou processos de aplicação ou workers. `git diff --check` passou.

**Implantação controlada — ainda bloqueada**

Este patch não deve ser publicado ou aplicado em produção. `version.txt` não foi promovido para v1.7.5. Não executar a nova migração isoladamente para contornar a baseline; isso criaria mais divergência entre schema e histórico.

O procedimento futuro deverá, depois de B resolvida e C–G comprovadas:

1. Fixar artefato por revisão/digest e conferir a cadeia de migrações, snapshot/restauração e autorizações separadas. Manter workers e reconciliadores contidos durante toda a preparação.
2. Aplicar somente migrações revisadas em uma operação explícita. O entrypoint não deve fazer DDL, `db push`, reset ou adoção automática de baseline.
3. Verificar protocolo de todos os consumidores, política persistente fechada, decisões, resultados incertos, evidências manuais e preservação dos futuros.
4. Gerar dry-run sanitizado por ocorrência e revisar T0/manifesto atualizado. Somente uma autorização posterior pode iniciar H; somente após a verificação de H pode ser considerada I.

**Reversão segura**

Enquanto esta etapa estiver bloqueada, reversão significa manter o ambiente operacional existente intocado; não há recuperação em produção para reverter. As alterações locais podem ser revisadas sem tocar nos dados ou apagar os arquivos anteriores da investigação.

Depois de uma implantação autorizada futura, manter schema/ledger/evidências aditivos; fechar a barreira, interromper novos efeitos pelo procedimento aprovado e não devolver vencidos para `QUEUE`. Não executar down migration nem remover colunas/tabelas de auditoria como forma de rollback.

Um worker antigo não lê o controle novo. Portanto, **não permitir rollback de consumidores para binário antigo na mesma infraestrutura com acesso de polling**. O plano operacional deverá impedir o seu processo e o seu acesso ao Temporal/egresso de publicação, preservando filas e históricos. Se não houver mecanismo verificável para essa contenção, o rollback do consumidor fica proibido: manter manutenção e corrigir adiante. Bloquear somente uma linha no banco novo ou reaplicar este preflight a um binário antigo não oferece essa garantia. A implementação de verificação do protocolo/consumidores faz parte das fases C–G pendentes; a restrição não foi implantada na infraestrutura.

**Arquivos novos ou alterados nesta etapa**

- `libraries/nestjs-libraries/src/database/prisma/schema.prisma`.
- `libraries/nestjs-libraries/src/database/prisma/migrations/20261114000000_safe_recovery_foundation/migration.sql`.
- `package.json`, `apps/orchestrator/package.json`, `docker-compose.yaml`.
- `recovery-release.json`, `scripts/recovery/preflight.cjs`.
- `diagnostics/recovery/test-foundation.mjs`, `foundation-results.json`, `read-only-schema-audit.sql`.
- Este relatório.

Os arquivos não versionados das investigações anteriores foram preservados. Não houve deploy, alteração em banco de produção, reconexão de integração, reenvio de mensagens, reinício de workers ou mudança de configuração no Temporal/Meta.
