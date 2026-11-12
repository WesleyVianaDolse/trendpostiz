# Instagram Facebook Login: inscrição e recuperação de comentários (3.1B)

Esta correção é local. Não executa migração, deploy, OAuth, inscrição real ou atualização de integrações em produção. Os testes usam credenciais fictícias e respostas simuladas.

## Contrato oficial da Meta

Documentação consultada em 11/11/2026:

- [Webhooks for Instagram, etapas 1 e 2](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram/): configurar o objeto **Instagram** e o campo **comments** no App Dashboard; habilitar a Página vinculada com Page Access Token, `pages_manage_metadata` e um campo válido de Página. O exemplo oficial usa `feed`.
- [Page subscribed_apps](https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/): `subscribed_fields` é obrigatório e contém campos de **Página**. A referência ressalta que esse parâmetro não configura webhooks Instagram. Para a Página, exige Page Access Token emitido por alguém com tarefa CREATE_CONTENT, MANAGE ou MODERATE e permissões `pages_manage_metadata` e `pages_show_list`.
- [App subscriptions](https://developers.facebook.com/docs/graph-api/reference/app/subscriptions/): leitura das assinaturas do app com App Access Token. Esta implementação apenas consulta essa borda; não cria ou modifica a configuração Instagram do aplicativo.
- [Matriz de campos e permissões](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields): para comentários com Facebook Login, `instagram_basic`, `instagram_manage_comments`, `pages_manage_metadata`, `pages_read_engagement` e `pages_show_list`. Todos já são solicitados pelo provider; nenhum scope foi acrescentado.
- [Configuração de webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup): App Live, Advanced Access para comentários, verificação de negócio e conta pública são requisitos externos. Exemplos atuais usam outra versão Graph; o projeto mantém **v25.0**.
- [Payloads por login](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples#unified-login-and-facebook-login-for-business): `object=instagram`, `entry.id` é o Instagram professional account ID, `changes[].field=comments`. Os exemplos incluem `value.id` e `value.comment_id`; ambos são aceitos.

As páginas novas também oferecem uma representação legível em `.../webhooks/setup.md`, `.../webhooks/fields.md` e `.../webhooks/examples.md`. Isso permitiu ler a documentação oficial quando a ferramenta de pesquisa recebeu HTTP 429.

### Duas assinaturas distintas

1. **Aplicativo:** objeto `instagram`, campo `comments`, callback HTTPS ativo. O serviço verifica essa configuração por GET usando App Access Token em header.
2. **Página:** `POST graph.facebook.com/v25.0/{FACEBOOK_PAGE_ID}/subscribed_apps`, Page Access Token em header, `subscribed_fields` contendo um campo válido de Página. O serviço lê e preserva os campos já inscritos para o mesmo app. Quando ainda não existe nenhum, utiliza `feed` como habilitação documentada da Página.

`feed` não é interpretado como comentário Instagram. O receptor continua ignorando `object=page` e campos diferentes de `comments`. A seleção e o processamento usam o IG ID (`internalId`), nunca o Page ID.

Antes de gravar `webhookCommentsSubscribed=true`, o serviço confirma que o token representa a Página esperada, que ela está vinculada ao IG ID armazenado, que o callback Instagram `comments` está ativo e que o POST da Meta retornou HTTP bem-sucedido com `success: true`. Nenhuma falha de preflight, rede ou persistência é retornada como sucesso. Isso confirma a inscrição; não comprova aprovação de Advanced Access ou entrega de um evento real.

O Standalone mantém host `graph.instagram.com`, conta Instagram como objeto da inscrição, campos `comments,messages` e as regras existentes de preservação de inscrições previamente confirmadas. Não há novas permissões, variáveis obrigatórias ou migração para esse provider.

## Estados e segurança

- `RECONNECT_REQUIRED`: token ausente/expirado/inválido, Página ausente ou vínculo/token incompatível. A reconexão tradicional recupera e persiste `facebookPageId`, mantém os dados OAuth de validade e refaz a inscrição.
- `SUBSCRIPTION_FAILED`: rede, resposta sem confirmação, coleção inválida/incompleta ou falha de persistência.
- `INSUFFICIENT_PERMISSIONS`: negativa Meta 10/200 no uso do Page token. Não identifica automaticamente qual permissão, política ou aprovação está faltando.
- `WEBHOOK_CONFIGURATION_INCOMPLETE`: credenciais de webhook do servidor ausentes, inspeção do app indisponível, callback Instagram inativo/ausente ou campo inválido. A correção da configuração ocorre pelo responsável no Dashboard.

Erros legados são classificados na leitura, sem regravar registros. A resposta de contas contém apenas motivo e orientação controlados pelo servidor, sem token, erro bruto ou segredo. Todas as ações de automação continuam bloqueadas se `commentsWebhook=false`.

## Recuperação futura, após implantação autorizada

Não executar este procedimento como parte da preparação local. Ele modifica a inscrição na Meta e persiste seu resultado somente quando invocado pelo operador autorizado.

1. Confirmar a revisão instalada, a organização e o ID exato da integração. Conferir `providerIdentifier=instagram`, `facebookPageId`, `internalId`, token e validade em ambiente restrito. Não exportar credenciais.
2. No app Facebook usado pela integração, verificar o callback `https://trendpostiz.com.br/api/public/webhooks/instagram`, objeto Instagram, campo `comments`, Include Values, App Live, permissões, Advanced Access e verificação de negócio. Confirmar as variáveis já existentes `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` e `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`.
3. Para token válido e vínculo correto, usar a nova rota autenticada, com a sessão e organização corretas:

   ```text
   POST /api/integrations/{INTEGRATION_ID}/instagram-comments/subscribe
   ```

   Sem corpo e sem token Meta no navegador ou URL. A rota exige a política de criação de canais já usada na conexão, consulta a integração por organização e ID, rejeita registros excluídos/desabilitados, conexões incompletas e outros providers. Não há operação em lote. O endpoint Nest não inclui o prefixo de proxy `/api`.

4. Verificar o retorno `{success, reason}`. Reabrir `GET /api/instagram-comment-automations/accounts`. Não alterar o booleano no banco por SQL. Se houver falha, tratar o motivo antes de repetir; não há repetição automática.
5. Se o motivo for `RECONNECT_REQUIRED`, usar o OAuth de reconexão do mesmo provider e da mesma conta. Não excluir a integração nem trocar de método. A reconexão agora preserva os metadados e tenta novamente a inscrição.
6. Com uma conta e comentário de teste autorizados, verificar assinatura, `object=instagram`, `entry.id=internalId`, recepção, deduplicação e respostas pública/privada. O teste do Dashboard sozinho não comprova eventos reais nem Advanced Access.

### Consulta de verificação somente leitura

Executar na mesma conexão SQL, com `$1` e `$2` vinculados à organização e integração exatas. Não retorna credenciais ou IDs externos.

```sql
BEGIN TRANSACTION READ ONLY;
SELECT
  "providerIdentifier", "profile", "refreshNeeded", "inBetweenSteps",
  "disabled", "deletedAt" IS NOT NULL AS deleted,
  "token" <> '' AS token_present, "tokenExpiration",
  NULLIF("facebookPageId", '') IS NOT NULL AS page_id_present,
  "webhookCommentsSubscribed", "webhookMessagesSubscribed",
  "webhookSubscriptionLastAttemptAt",
  substring("webhookSubscriptionError" FROM '"reason":[[:space:]]*"([A-Z_]+)"') AS reason,
  substring("webhookSubscriptionError" FROM '"status":[[:space:]]*([0-9]+)') AS meta_http,
  substring("webhookSubscriptionError" FROM '"code":[[:space:]]*([0-9]+)') AS meta_code
FROM "Integration"
WHERE "organizationId" = $1 AND "id" = $2;
ROLLBACK;
```

## Validação local

Arquivos de implementação alterados (caminhos a partir da raiz):

- `libraries/nestjs-libraries/src/integrations/social/instagram-webhook-subscription.service.ts`: contratos separados, preflights, preservação dos campos da Página, confirmação e sanitização.
- `libraries/nestjs-libraries/src/integrations/social/instagram-webhook-status.ts`: motivos e mensagens controladas, com leitura de erros legados.
- `libraries/nestjs-libraries/src/integrations/social/instagram-capabilities.ts`: classificação sem remover o bloqueio por inscrição não confirmada.
- `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts` e `social.integrations.interface.ts`: vínculo validado e Page ID na reconexão.
- `libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts` e `integration.service.ts`: persistência da Página, roteamento pelo IG ID e recuperação por tenant.
- `libraries/nestjs-libraries/src/database/prisma/instagram-webhooks/instagram-webhook-events.service.ts` e `libraries/nestjs-libraries/src/dtos/webhooks/instagram.webhook.dto.ts`: aceitação de `comment_id`.
- `apps/backend/src/api/routes/no.auth.integrations.controller.ts` e `integrations.controller.ts`: conclusão OAuth e rota de recuperação autenticada.
- `apps/backend/src/services/instagram-comment-automations/instagram-comment-automation-crud.service.ts`: contrato de estados sanitizados com a interface.
- `apps/frontend/src/components/instagram-automations/instagram-automations.component.tsx` e `types.ts`: mensagens específicas com seleção ainda bloqueada.
- Este documento: contrato, fontes e procedimento de recuperação.

Testes alterados/adicionados: `instagram-webhook-subscription.service.spec.ts`, `instagram-capabilities.spec.ts`, `instagram.provider.spec.ts`, `integration.multi-provider.spec.ts`, `integration.instagram-webhook.spec.ts`, `instagram-webhook-events.service.spec.ts`, `instagram-comment-automation-crud.service.spec.ts`, `instagram-automations.component.spec.tsx` e `apps/backend/src/api/routes/no.auth.integrations.instagram.spec.ts`.

Os testes cobrem contrato em duas etapas, confirmação estrita da Meta, preservação dos campos existentes da Página, preflights, erros e sanitização, recuperação por tenant, reconexão OAuth, roteamento pelo IG ID, `comment_id`, rejeição de Page feed, capacidades e mensagens da interface. As suítes existentes do Standalone continuam fazendo parte da regressão.

Usar a configuração `apps/backend/jest.instagram-webhook.config.js` para os testes TypeScript do backend/orchestrator e `apps/frontend/jest.instagram-automations.config.cjs` para a interface. Os scripts `build` de backend, orchestrator e frontend compilam o código local; não devem ser substituídos por scripts de início, deploy ou sincronização do banco.

Resultado final desta execução:

- Backend/orchestrator: **18 suítes, 181 testes aprovados**, incluindo Standalone, assinaturas, isolamento e processamento.
- Frontend: **2 suítes, 21 testes aprovados**.
- Builds de **backend, orchestrator e frontend concluídos com sucesso**.
- `git diff --check` aprovado. Nenhum scope ou schema alterado; nenhuma migração executada.

Comandos de validação executados na raiz:

```powershell
node node_modules/jest/bin/jest.js --config apps/backend/jest.instagram-webhook.config.js --runInBand --testPathPattern 'instagram|integration.multi-provider' --silent
./node_modules/.bin/jest.cmd --config apps/frontend/jest.instagram-automations.config.cjs --runInBand --no-cache
pnpm --filter ./apps/backend run build
pnpm --filter ./apps/orchestrator run build
pnpm --filter ./apps/frontend run build
```

Permanece pendente, fora desta execução: confirmação da configuração e aprovação do app em produção, GETs/POSTs reais do fluxo corrigido e observação de um evento real com a conta alvo.
