# Private Reply — Facebook Login legado (3.1B)

Auditoria e correção local em 12/11/2026, a partir do commit `35ac133`. Nenhuma chamada autenticada à Meta, consulta a produção, renovação de autorização, reenvio, alteração de cliente ou deploy foi executado. O erro de produção abaixo foi fornecido pelo responsável.

## Evidência e diagnóstico

O provider `instagram` usava `POST graph.facebook.com/v25.0/{IG_BUSINESS_ID}/messages`, com o Page Access Token em `Integration.token` e `recipient.comment_id`. A resposta real foi código 10, solicitando `instagram_manage_messages`. O teste anterior exigia esse IG ID na URL, mas apenas simulava a Meta.

O [guia específico de Private Replies do Instagram Messaging legado](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies) documenta **`/{FACEBOOK_PAGE_ID}/messages`**, **Page Access Token** e **`recipient.comment_id`**. O código foi alinhado a esse contrato, mantendo v25.0. Não existe fallback para IG ID ou `/me`.

O erro demonstra a exigência de permissão na chamada que foi feita com IG ID. Ele não demonstra, por si só, que acrescentar essa permissão é a correção apropriada para o contrato legado por Página. O sucesso do endpoint corrigido ainda precisa ser homologado.

## Contratos e permissões: diferenças relevantes

Fontes oficiais lidas diretamente, inclusive pela representação `.md` quando o navegador de pesquisa recebeu HTTP 429:

| Fluxo/documento                                                                                                                                                 | Destino e token                                                                                                     | Permissões documentadas para Private Reply                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Instagram Messaging legado, Private Replies](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies.md) | `graph.facebook.com/{PAGE_ID}/messages`; Page Access Token de uma pessoa com tarefa `MESSAGING` na Página vinculada | `instagram_manage_comments` e `pages_messaging`; o guia também lista Advanced Access e recurso Human Agent                                                      |
| [Instagram Platform, Private Replies — Instagram Login](https://developers.facebook.com/documentation/instagram-platform/private-replies.md)                    | `graph.instagram.com/{IG_ID}/messages`; Instagram User access token                                                 | `instagram_business_basic`, `instagram_business_manage_comments`                                                                                                |
| Mesmo guia — Login Unificado                                                                                                                                    | `graph.facebook.com/{IG_ID}/messages`; Business Integration System User access token                                | `instagram_basic`, `instagram_manage_comments` e explicitamente `instagram_manage_messages`                                                                     |
| Mesmo guia — coluna Facebook Login                                                                                                                              | Page Access Token; o exemplo geral desse guia usa IG ID                                                             | `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement`; lista ainda `ads_management`/`ads_read` condicionalmente a papéis via Business Manager |

A [visão geral de Instagram Messaging](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/overview.md), que abrange conversas completas, lista `instagram_manage_messages`. Portanto há diferenças de abrangência e de requisitos entre os documentos oficiais. A implementação seleciona explicitamente o contrato legado por Página indicado na solicitação; não mistura os três tipos de token nem amplia permissões com base no exemplo geral.

**Conclusão de escopo:** o guia específico legado não lista `instagram_manage_messages` para a única resposta por `comment_id`, mas lista **`pages_messaging`**, ausente do array OAuth atual. Não foi comprovada nesta execução a concessão efetiva de nenhum desses scopes no token de produção. Não foi acrescentado qualquer scope: a mudança de autorizações e a aprovação do app precisam de validação e decisão explícita antes da homologação com clientes. Também não foram acrescentados scopes de anúncios ou tag Human Agent à automação.

## OAuth e concessão efetiva

`InstagramProvider.scopes` solicita: `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `business_management`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`.

`authenticate()` lê `/me/permissions` com o **User Access Token**, considera somente permissões `granted` e executa `checkScopes`. Isso valida o array solicitado; não comprova `pages_messaging` ou `instagram_manage_messages`, pois não são solicitados/validados. A seleção de Página armazena o **Page Access Token** em `Integration.token`; não confundir esse campo com o token de usuário usado na inspeção das concessões.

Procedimento de inspeção futura, exclusivamente leitura e em ambiente restrito:

1. Selecionar a organização e integração exatas; confirmar `providerIdentifier=instagram`, IG ID e Page ID diferentes e vínculo entre eles. Não exportar valores de tokens, IDs internos de clientes ou segredos.
2. Inspecionar o token operacional com o debugger oficial, registrando apenas indicadores de tipo Page, app correto, validade, escopos relevantes e ativos granulares compatíveis. `/debug_token` usa `input_token` em parâmetro; não executá-lo em ambiente que registre URLs ou respostas brutas. Não copiar credenciais para comandos, chat, logs ou relatórios.
3. Com um User Access Token válido da mesma autorização, verificar `/me/permissions`; devolver somente os estados `granted`/`declined` de `instagram_manage_comments`, `pages_messaging` e `instagram_manage_messages`. Não usar o Page token como se fosse o token de usuário dessa consulta e não renovar tokens durante a inspeção.
4. Confirmar a tarefa `MESSAGING` da pessoa sobre a Página e as configurações de acesso às mensagens da conta Instagram. Confirmar App Live, Advanced Access e requisitos do recurso no Dashboard.

Se `pages_messaging` estiver ausente, o guia legado exige que o responsável prepare a revisão/aprovação apropriada, acrescente esse scope ao OAuth em uma mudança autorizada e obtenha nova concessão dos usuários pertinentes. Aprovação do app não atualiza automaticamente tokens existentes. Não é necessário excluir integrações para renovar a autorização.

Se a homologação do **endpoint correto por Página** ainda exigir explicitamente `instagram_manage_messages`, preservar a resposta sanitizada, confirmar o contrato e configuração do app com a Meta e preparar a ampliação do OAuth, App Review/Advanced Access e renovação dos grants como mudança separada. Nada disso foi executado ou disparado automaticamente nesta entrega.

## Correções e proteção contra repetição

- `instagram-comment-messaging.service.ts`: usa `facebookPageId`, exige esse identificador, mantém Page token em header, exige `message_id` para confirmar o Direct e trata todas as falhas do Direct tradicional como não repetíveis. Respostas públicas mantêm seu tratamento de retries.
- `instagram-comment-automation.repository.ts` e `instagram-comment-automation.service.ts`: reservam atomicamente uma única tentativa de Direct para o provider `instagram`, antes do HTTP. A reserva exige `PENDING`, ausência de mensagem confirmada e execução ainda não finalizada. O status passa conservadoramente a `FAILED`, com erro explícito de resultado não confirmado; somente o `message_id` confirmado e persistido passa a `SUCCESS`.
- Se houver queda do worker, timeout ou falha de banco depois de a Meta aceitar a mensagem, a reserva não volta automaticamente a `PENDING`. Isso evita duplicação, aceitando que uma tentativa interrompida possa ficar sem entrega ou sem confirmação local. Não há reenvio automático para resolver essa incerteza.
- As chaves de deduplicação existentes por evento, comentário e autor/automação permanecem. Execuções históricas `FAILED`/finalizadas não são reabertas. Não foi criado endpoint de reenvio, job de reparação ou script que resete resultados.
- A janela local existente de sete dias foi preservada. Ela usa `webhookEvent.receivedAt`, não o instante original de criação; não substitui a restrição aplicada pela Meta. Homologação usa comentário novo e mídia não Live. `live_comments` continua fora do processamento suportado; não há extensão de janela ou mensagem de acompanhamento.
- O transporte, OAuth, scopes e política de envio do Standalone não foram modificados; a nova reserva é restrita a `providerIdentifier=instagram`.

## Auditoria e histórico

`publicReplyStatus`/`publicReplyId` e `privateReplyStatus`/`privateReplyError` já eram persistidos separadamente e devolvidos pela API de histórico. A contagem de falhas já considera falha em qualquer canal.

A finalização antiga atribuía `PROCESSED` à combinação público `SUCCESS` + Direct `FAILED`. Agora qualquer falha resulta em evento `FAILED`, preservando o resultado e ID públicos. `REPLIED` exige ausência de falha e de pendência. Não foi necessário criar enum ou migração.

A interface identifica **Falha parcial** quando um canal tem sucesso e o outro falha, e mostra os dois erros separadamente quando ambos falham. Registros antigos não são regravados: a interface deriva a indicação dos resultados por canal já armazenados. Essa melhoria de auditoria é compartilhada; não altera o contrato de envio do Standalone.

Consulta futura de leitura, com `$1` organização e `$2` execução exata, vinculados pelo cliente SQL na mesma conexão:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT
  x."publicReplyStatus", x."privateReplyStatus",
  x."publicReplyId" IS NOT NULL AS public_confirmation_present,
  x."privateReplyId" IS NOT NULL AS private_confirmation_present,
  x."processedAt", e."status" AS event_status,
  substring(x."privateReplyError" FROM '"code":[[:space:]]*([0-9]+)') AS private_meta_code,
  COALESCE(x."privateReplyError" LIKE '%instagram_manage_messages%', false) AS mentions_instagram_manage_messages,
  COALESCE(x."privateReplyError" LIKE '%pages_messaging%', false) AS mentions_pages_messaging
FROM "InstagramCommentAutomationExecution" x
JOIN "InstagramCommentAutomation" a ON a."id" = x."automationId"
JOIN "Integration" i ON i."id" = a."integrationId"
LEFT JOIN "InstagramWebhookEvent" e ON e."id" = x."webhookEventId"
WHERE i."organizationId" = $1 AND x."id" = $2;
ROLLBACK;
```

## Homologação após implantação autorizada

1. Confirmar o contrato legado e os grants/requisitos acima com uma conta de teste autorizada. Não repetir o comentário/execução que já falhou em produção.
   Antes de uma implantação, revisar por leitura as execuções antigas ainda pendentes/em processamento: a reserva durável nova não existe retroativamente para tentativas iniciadas pela versão anterior. Não resetar status ou liberar reenvios em lote para resolver resultados desconhecidos.
2. Criar uma automação de teste para uma mídia não Live e usar um **novo comentário e novo autor de teste**, pois a deduplicação é por autor/automação. O envio real só ocorre em uma etapa futura autorizada.
3. Confirmar uma única chamada `POST /v25.0/{PAGE_ID}/messages`, Page token correto em header e `recipient.comment_id`; não registrar header, token ou identificadores privados no relatório.
4. Exigir `message_id` real e verificação da Inbox/Requests pelo destinatário para declarar sucesso. Validar ambos os canais no histórico.
5. Para negativa de permissão, verificar público `SUCCESS`, Direct `FAILED`, evento `FAILED` e indicação **Falha parcial**. Não reiniciar, reabrir ou reenfileirar a execução para tentar entregar novamente.
6. Em testes isolados com mocks, simular duplicatas concorrentes, rede e perda de confirmação no banco. Reexecutar a atividade não pode repetir a chamada de Direct tradicional. Regressão de Standalone usa suas suítes existentes, sem mudar suas credenciais ou contratos.

## Arquivos e validação local

Implementação: `libraries/nestjs-libraries/src/integrations/social/instagram-comment-messaging.service.ts`, `libraries/nestjs-libraries/src/instagram-comment-automation/instagram-comment-automation.service.ts`, `libraries/nestjs-libraries/src/database/prisma/instagram-comment-automations/instagram-comment-automation.repository.ts`, `apps/frontend/src/components/instagram-automations/instagram-automations.component.tsx`.

Testes: respectivas suítes de messaging, serviço, repository (nova), histórico frontend, workflow do orchestrator e `instagram.provider.spec.ts` (array OAuth inalterado e rejeição de grants negados).

Não houve alteração de schema, scopes ou provider Standalone. A alteração paralela em `version.txt` não faz parte desta correção e foi preservada.

Resultado final:

- Backend/orchestrator: **19 suítes e 204 testes aprovados**, incluindo as suítes existentes do Standalone.
- Frontend: **2 suítes e 23 testes aprovados**.
- Builds de **backend, orchestrator e frontend aprovados**.
- `git diff --check` aprovado. Testes de envio usam mocks; nenhum resultado representa uma mensagem real entregue.

Comandos executados na raiz:

```powershell
node node_modules/jest/bin/jest.js --config apps/backend/jest.instagram-webhook.config.js --runInBand --testPathPattern 'instagram|integration.multi-provider' --silent
node node_modules/jest/bin/jest.js --config apps/frontend/jest.instagram-automations.config.cjs --runInBand
pnpm --filter ./apps/backend run build
pnpm --filter ./apps/orchestrator run build
pnpm --filter ./apps/frontend run build
```
