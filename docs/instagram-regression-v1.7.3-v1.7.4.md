# Comparação v1.7.3 → v1.7.4: zero execuções

## Conclusão e limite da investigação

**A causa raiz do incidente em produção ainda não foi comprovada. Não foi identificada no diff uma alteração que bloqueie a criação da execução ou faça a resposta pública depender do Direct. Não foi aplicada uma correção funcional especulativa.**

A interface zerada, sem resposta pública, é o sintoma confirmado pelo responsável. Não há nesta execução registro sanitizado do evento, resultado da atividade `prepare`, histórico Temporal ou identidade do artefato instalado em produção. Portanto não é possível afirmar se aquele comentário chegou ao servidor, foi persistido, filtrado, deduplicado ou ficou sem consumo no worker.

O responsável confirmou expressamente que a revisão identificada como `fix: v1.7.3 update api meta, connection` foi a funcional e `fix: direct message instagram business v1.7.4` deixou de responder. A captura fornecida mostra, em 12/11/2026 às 09:07 na interface, uma execução do comentário `Jesus`, com resposta pública `Sucesso` e Direct `Falhou`, HTTP 400/Meta 10. Essa captura confirma o comportamento funcional anterior informado; não é evidência de execução ou recepção do comentário posterior na v1.7.4. A análise usa exatamente esses dois commits, sem substituir a referência funcional por v1.7.2 apesar do conteúdo desatualizado de `version.txt`.

Foi acrescentado um teste diferencial que executa o código histórico das duas revisões contra um PostgreSQL descartável real e um endpoint HTTP Nest com verificação HMAC real. Nas duas versões, `Eu quero` cria uma execução e publica a resposta pública quando a Meta simulada rejeita o Direct. Isso supera um teste só de mocks de repositório, mas **não substitui homologação na Meta nem comprova a saúde do worker em produção**.

## Identificação das revisões

| Identificação no histórico Git                  | Commit completo                            | `version.txt` no commit |
| ----------------------------------------------- | ------------------------------------------ | ----------------------- |
| `fix: v1.7.3 update api meta, connection`       | `35ac133fc37d0b85c8b002a22fbd0134d23e3312` | **v1.7.2**              |
| `fix: direct message instagram business v1.7.4` | `36f4cd9971d5f304b0ab94f373160ea632341ac4` | v1.7.4                  |

Não há tags locais para essas versões. A correspondência da primeira revisão é feita pela mensagem/histórico; seu arquivo de versão está desatualizado. Isso impede usar somente a versão exibida pela interface para provar qual backend e worker foram instalados. É necessário correlacionar o digest/artefato de implantação com o commit de origem, sem reconstruir ou publicar nada durante essa verificação.

Comandos de leitura executados:

```powershell
git show --no-patch --format=fuller 35ac133
git show --no-patch --format=fuller 36f4cd9
git diff --stat 35ac133 36f4cd9
git diff --name-status 35ac133 36f4cd9
git diff 35ac133 36f4cd9 -- libraries/nestjs-libraries/src/instagram-comment-automation/instagram-comment-automation.service.ts libraries/nestjs-libraries/src/database/prisma/instagram-comment-automations/instagram-comment-automation.repository.ts apps/orchestrator/src/workflows/instagram-comment-automation.workflow.ts
git show 35ac133:version.txt
git show 36f4cd9:version.txt
```

## Diff real e análise causal

O diff contém 12 arquivos: 4 arquivos de implementação, testes, documento e versão. Os quatro arquivos de implementação são:

| Arquivo                                      | Mudança funcional                                                                 | Quando ocorre                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `instagram-comment-automation.service.ts`    | 6 linhas chamam `claimFacebookPrivateReplyAttempt`                                | Dentro de **deliverPrivateReply**, depois da execução e da etapa pública           |
| `instagram-comment-automation.repository.ts` | Novo método de reserva de Direct; falha passa a ter prioridade na finalização     | Reserva por ID de execução existente; finalização após entregas                    |
| `instagram-comment-messaging.service.ts`     | Page ID no endpoint privado, validação de `message_id`, ausência de retry privado | Durante uma entrega já iniciada; caminho público e criação não consultam a reserva |
| `instagram-automations.component.tsx`        | Rótulo de falha parcial e erros separados                                         | Exibição de histórico, não criação/dispatch                                        |

São **idênticos nas duas revisões**, verificados por conteúdo Git:

- Controller HTTP e validação de assinatura do webhook.
- Normalização de `Eu quero` e reconhecimento de gatilhos.
- Serviço/repositório de recepção e persistência do webhook.
- Resolução de integração, capacidades e OAuth.
- Dispatcher e reconciliação de eventos `RECEIVED`.
- Workflow e activity do orchestrator.
- Schema e chaves únicas de deduplicação.
- `prepare`, `claimExecution`, `deliverPublicReply` e os construtores envolvidos.

O blob Git do workflow é o mesmo: `d676e7459c345032f0c4abb12ed03acb9769abf9`.

O caminho de execução permanece:

```text
HTTP assinado
  → registrar evento RECEIVED
  → iniciar workflow instagram-comment-{eventId}, task queue main
  → prepare: resolver dados/automação/gatilho
  → claimExecution: criar execução e marcar evento PROCESSING na mesma transação
  → deliverPublicReply
  → deliverPrivateReply: somente aqui entra a nova reserva
  → finalize
```

Uma falha nessa reserva pode impedir o **Direct** ou levar o workflow a registrar sua falha. Ela não explica zero execuções: o método precisa receber um ID criado anteriormente, e a etapa pública vem antes. A mudança `PROCESSED` → `FAILED` na falha parcial também não apaga a execução nem zera as métricas, que contam por `automationId` e resultados individuais.

Não foi encontrado impedimento novo à criação no código comparado. Isso não exclui diferenças no artefato implantado, dados, configuração efetiva ou operação do worker; essas condições não estão registradas no diff.

## Teste diferencial local com persistência real

Executar na raiz, com Docker Desktop/daemon **local**:

```powershell
node diagnostics/instagram-regression/run-local.mjs
```

O runner cria um PostgreSQL `postgres:16-alpine` exclusivo, sem volume, com porta aleatória publicada somente em `127.0.0.1`, usuário/banco de teste `ig_regression` e dados fictícios. Não lê `.env` para escolher o banco. O datasource é explícito e validado antes dos testes. A inicialização de schema só é executada nesse banco novo. Ao terminar, remove exclusivamente o container cujo ID e rótulo pertencem à execução.

O teste carrega, por `git show`, serviço de automação, repositório de execução e estratégia de mensagens das duas revisões, transpila esse código e usa as classes históricas reais. Ingress, resolução, persistência e matcher são os arquivos comuns, cuja igualdade é assertada.

O endpoint HTTP usa o controller Nest real, assinatura HMAC, Prisma e PostgreSQL reais. O dispatcher é real, mas o cliente/consumidor Temporal usa uma ponte local controlada. As respostas HTTP da Meta são simuladas e não há chamada à Graph real. Não inicia o backend ou orchestrator completos, nem usa Redis ou filas de produção.

Casos cobertos:

1. Igualdade das fontes de ingresso, matcher, workflow e schema; igualdade de `prepare`.
2. v1.7.3: comentário assinado, persistência, `Eu quero`, execução, sucesso público, falha privada persistida.
3. Mesmo caso na v1.7.4, preservando o endpoint privado por Page ID.
4. Exceção na reserva de Direct da v1.7.4: execução e sucesso público permanecem.
5. Redelivery e segundo comentário do mesmo autor não duplicam entrega/execução.
6. Evento `RECEIVED`, encaminhado e sem consumo: **0 execuções e nenhuma chamada de publicação**. Após consumo, cria execução e publica. Reproduz a forma do sintoma sem atribuir causa ao incidente real.
7. Assinatura inválida rejeitada; texto sem gatilho é persistido como `SKIPPED`, sem execução.
8. Standalone mantém entrega pública independente da falha privada, usando seu host próprio.

O teste padrão fica explicitamente pulado sem `INSTAGRAM_REGRESSION_TEST_DATABASE_URL`; o runner é a forma reprodutível de executar os casos com banco real e isolado. Meta e Temporal reais permanecem fora dessa prova local.

## Localização segura da interrupção em produção

As etapas abaixo são **procedimento de leitura para o operador**. Não foram executadas nesta sessão e não alteram configuração, autorizações, filas ou registros. Não iniciar/reiniciar processos, reconciliar/reexecutar workflows ou resetar estados para obter evidências.

1. Identificar o `automationId` exato e sua organização. Confirmar o horário do comentário, com fuso, e se ele foi publicado depois de a automação estar ativa. Confirmar digest/commit do backend **e** do orchestrator; versão da interface não comprova os dois.
2. Usar uma transação somente leitura na mesma conexão e parâmetros vinculados. Não selecionar `token`, `refreshToken`, secrets ou payload bruto.
3. Se houver evento, consultar o workflow determinístico **existente** `instagram-comment-{eventId}` no namespace e task queue usados pelo backend. Ler estado e atividade `prepare` (entrada/resultado/erro), sem clicar em retry/reset/terminate/start. O resultado de `prepare` já fornece o motivo de descarte.
4. Conferir pollers do worker `main`, namespace/endereço efetivos, estado/erro de inicialização e logs de dispatch/watchdog. Compartilhar só estado, etapa e erro sanitizado, omitindo dados de clientes e credenciais.

### Dados da automação e estado atual da integração

`$1`: organização exata; `$2`: automação exata.

```sql
BEGIN TRANSACTION READ ONLY;

SELECT
  a."enabled", a."matchType", a."createdAt", a."updatedAt",
  a."publicReplyEnabled", a."privateReplyEnabled",
  NULLIF(trim(a."publicReplyText"), '') IS NOT NULL AS public_text_present,
  i."providerIdentifier", i."disabled", i."refreshNeeded", i."inBetweenSteps",
  i."deletedAt" IS NOT NULL AS integration_deleted,
  i."token" <> '' AS token_present,
  i."tokenExpiration",
  NULLIF(i."facebookPageId", '') IS NOT NULL AS page_present,
  i."webhookCommentsSubscribed",
  o."suspendedAt" IS NOT NULL AS organization_suspended,
  EXISTS (
    SELECT 1 FROM "InstagramCommentAutomationTrigger" t
    WHERE t."automationId" = a."id" AND t."normalizedPhrase" = 'eu quero'
  ) AS eu_quero_trigger_present,
  (SELECT count(*) FROM "InstagramCommentAutomationExecution" x
    WHERE x."automationId" = a."id") AS execution_count
FROM "InstagramCommentAutomation" a
JOIN "Integration" i ON i."id" = a."integrationId"
JOIN "Organization" o ON o."id" = i."organizationId"
WHERE o."id" = $1 AND a."id" = $2;

ROLLBACK;
```

### Eventos do intervalo do teste e deduplicação

`$1/$2`: mesmos parâmetros; `$3/$4`: início/fim UTC do intervalo do teste. Usar intervalo curto. IDs de evento abaixo servem somente à correlação operacional dentro do ambiente restrito; ao compartilhar o resultado, substituí-los por aliases.

```sql
BEGIN TRANSACTION READ ONLY;

WITH target AS (
  SELECT a."id", a."integrationId", a."mediaId", i."internalId"
  FROM "InstagramCommentAutomation" a
  JOIN "Integration" i ON i."id" = a."integrationId"
  WHERE i."organizationId" = $1 AND a."id" = $2
)
SELECT
  e."id" AS event_id, e."status", e."receivedAt",
  e."integrationId" = t."integrationId" AS integration_matches,
  e."mediaId" = t."mediaId" AS media_matches,
  NULLIF(e."authorId", '') IS NOT NULL AS author_present,
  NULLIF(e."externalCommentId", '') IS NOT NULL AS comment_id_present,
  lower(regexp_replace(trim(e."commentText"), '[[:space:]]+', ' ', 'g'))
    LIKE '%eu quero%' AS text_contains_eu_quero,
  linked."id" IS NOT NULL AS execution_for_event,
  linked."automationId" = t."id" AS execution_for_this_automation,
  linked."publicReplyStatus", linked."privateReplyStatus", linked."processedAt",
  EXISTS (
    SELECT 1 FROM "InstagramCommentAutomationExecution" x
    WHERE x."automationId" = t."id" AND x."authorId" = e."authorId"
      AND x."webhookEventId" IS DISTINCT FROM e."id"
  ) AS another_execution_for_same_author
FROM target t
JOIN "InstagramWebhookEvent" e ON
  (e."integrationId" = t."integrationId" OR e."instagramAccountId" = t."internalId")
LEFT JOIN "InstagramCommentAutomationExecution" linked ON linked."webhookEventId" = e."id"
WHERE e."receivedAt" >= $3 AND e."receivedAt" <= $4
ORDER BY e."receivedAt";

ROLLBACK;
```

A expressão SQL de texto é só um indicador para a frase ASCII deste teste, não uma substituição da normalização Unicode do código. Os dados atuais não comprovam como a automação estava configurada no instante de um evento antigo; ler também o resultado histórico de `prepare` no Temporal.

| Evidência obtida                      | Localização da interrupção                                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Nenhum evento no intervalo/conta      | Recepção/filtro anterior à persistência; verificar callback, HTTP e assinatura. Ausência no banco não identifica sozinha a causa             |
| `UNMATCHED`, `AMBIGUOUS` ou `INVALID` | Resolução da conta/estrutura do evento; não encaminhado ao processamento normal                                                              |
| `RECEIVED`, sem execução              | Dispatch pendente/falho, worker sem consumo ou erro de `prepare`/transação; consultar o workflow e pollers                                   |
| `SKIPPED`, sem execução               | Ler motivo de `prepare`: `no_match`, `no_automation`, `already_claimed`, conta própria, dados ausentes ou organização suspensa, entre outros |
| Execução presente no banco, UI zerada | Confirmar ID/organização da automação consultada e resposta da API/caching; a reserva do Direct não apaga a linha                            |
| Público `SUCCESS`, Direct `FAILED`    | Falha isolada posterior à execução; não é o incidente de zero execuções                                                                      |

`claimExecution` cria a execução e muda o evento para `PROCESSING` na mesma transação nas duas versões. Uma criação revertida por erro de banco precisa ser confirmada pelo erro histórico da atividade; não deve ser confundida com deduplicação `P2002`.

## Arquivos alterados nesta investigação

- `apps/backend/src/services/instagram-comment-automations/instagram-version-regression.integration.spec.ts`: teste diferencial HTTP + banco real.
- `diagnostics/instagram-regression/run-local.mjs`: infraestrutura descartável isolada e limpeza controlada.
- Este relatório.

Nenhum arquivo funcional de webhook, automação, repositório, workflow, mensagens, OAuth, scopes ou Standalone foi alterado. A correção de Page ID e as proteções seguras de v1.7.4 foram preservadas. Nenhuma mensagem antiga foi reenviada.

## Resultado da validação

- Teste diferencial HTTP/PostgreSQL: **8 casos aprovados**, executados com o runner local e container removido ao final. Código das duas revisões efetivamente executado.
- Suítes de regressão backend/orchestrator: **19 suítes e 204 testes aprovados**. Os 8 casos de PostgreSQL aparecem como pulados nessa invocação padrão, por não haver datasource de teste; foram executados separadamente com sucesso pelo runner.
- Frontend: **2 suítes e 23 testes aprovados**.
- Builds de backend, orchestrator e frontend: **aprovados**.
- `git diff --check`: aprovado. Nenhum container de teste ficou em execução.

```powershell
node diagnostics/instagram-regression/run-local.mjs
node node_modules/jest/bin/jest.js --config apps/backend/jest.instagram-webhook.config.js --runInBand --testPathPattern 'instagram|integration.multi-provider' --silent
node node_modules/jest/bin/jest.js --config apps/frontend/jest.instagram-automations.config.cjs --runInBand
pnpm --filter ./apps/backend run build
pnpm --filter ./apps/orchestrator run build
pnpm --filter ./apps/frontend run build
```

**Estado da entrega:** comparação e validação local; incidente de produção ainda aberto, sem causa raiz comprovada e sem alegação de restauração/homologação concluída. Uma correção funcional só deve ser escolhida após localizar a interrupção com as evidências acima.
