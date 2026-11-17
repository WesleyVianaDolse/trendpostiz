# Direct de comentários — autorização Facebook Login, v1.7.4

Implementação local em `main`, sobre `36f4cd9971d5f304b0ab94f373160ea632341ac4`. Não incorpora o checkpoint v1.7.5. Não houve alteração de infraestrutura, ambiente, schema, migrações, endpoint de envio ou provider Standalone. Não houve acesso a produção, App Dashboard, tokens de clientes, banco ou APIs sociais autenticadas durante os testes.

## Diagnóstico e contrato

O erro fornecido pelo operador é HTTP 403, Meta 230: `Requires instagram_manage_messages permission to manage the object`. A resposta pública funciona porque usa autorização de comentários. O OAuth anterior solicitava e validava as permissões de publicação/comentários, mas não `instagram_manage_messages`. O operador confirmou que essa permissão já possui Advanced Access no aplicativo; essa informação é adotada como evidência operacional, sem nova consulta ao Dashboard.

Fontes oficiais consultadas:

- [Private Replies legado](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies): `POST /{PAGE_ID}/messages`, Page Access Token, `recipient.comment_id`, `instagram_manage_comments`, `pages_messaging`, tarefa `MESSAGING`, Advanced Access e o recurso Human Agent mencionado pelo guia.
- [Instagram Messaging Overview](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/overview): inclui `instagram_manage_messages` entre os requisitos; Standard Access limita a interação a pessoas com papel no app.
- [Private Replies na Instagram Platform](https://developers.facebook.com/documentation/instagram-platform/private-replies): distingue os tipos de login; a coluna Facebook Login não lista `pages_messaging` e o exemplo geral usa outro identificador de endpoint. Não foi usado para trocar o endpoint existente.
- [Debug Token](https://developers.facebook.com/docs/graph-api/reference/debug_token/): permite conferir validade, app, Página, scopes e concessões granulares do token operacional, usando um App Access Token do mesmo app.

O guia legado lista `pages_messaging`, mas não há comprovação operacional de que a ausência desse scope seja o bloqueio da chamada v25.0 deste app; a documentação de Private Replies em outros fluxos apresenta requisitos diferentes. O erro real identifica `instagram_manage_messages`. Conforme a orientação final, `pages_messaging` não é solicitado nem usado como bloqueio adicional. Isso não declara a permissão dispensável em todos os contratos da Meta: se a homologação desse endpoint exigir explicitamente outro grant, registrar a evidência e revisar separadamente. Não se trocou o endpoint por IG ID nem se misturaram os contratos de Instagram Login ou Login Unificado.

## Mudança mínima

- `InstagramProvider` solicita `instagram_manage_messages` junto aos scopes existentes, sem acrescentar `pages_messaging`. `auth_type=rerequest` permite reapresentar permissões recusadas.
- Os scopes existentes continuam obrigatórios no OAuth; mensagens são opcionais para a conexão. Ausência, recusa ou expiração de grants de mensagens não impede concluir login para publicar e responder comentários.
- A seleção/reconexão continua obtendo e persistindo o Page Access Token da Página vinculada e o mesmo Instagram Business ID.
- Uma função de autorização consulta `/v25.0/debug_token` para o Page token efetivamente usado, com as credenciais existentes `FACEBOOK_APP_ID` e `FACEBOOK_APP_SECRET`. Não há campo novo no banco, cache de grants ou flag de autorização persistida pelo cliente.
- Direct requer token válido do app e da Página corretos, `instagram_manage_messages`, os grants básicos/comentários e alvos granulares compatíveis. `pages_messaging` não substitui `instagram_manage_messages`, e sua ausência não bloqueia o Direct. A resposta externa contém somente capacidades/estados, nunca o payload de introspecção.
- A verificação acontece ao listar contas, configurar uma regra com Direct e antes de reservar/enviar uma tentativa. Cada leitura tem timeout de 5 segundos; não há retry automático da introspecção. Publicação e entrega pública não dependem dessa consulta.
- Falta comprovada de grant produz `privateReplyAuthorization=RECONNECT_REQUIRED`, mantendo comentários ativos e `refreshNeeded` intacto. Falha de transporte, credenciais do app indisponíveis ou erro da introspecção produzem `VERIFICATION_UNAVAILABLE`; não se manda reconectar por uma falha de leitura.
- A interface mantém a conta selecionável e permite configurar somente resposta pública. As orientações do Direct são específicas desse canal.

O envio continua em `POST graph.facebook.com/v25.0/{FACEBOOK_PAGE_ID}/messages`, com Page token em Bearer, `recipient.comment_id` e confirmação obrigatória por `message_id`. A reserva atômica, a falha parcial e a supressão de repetição do Direct tradicional são as da v1.7.4; nenhuma execução FAILED é recolocada em PENDING. A verificação ocorre antes da reserva, sem disparar envio.

O debugger recebe o token operacional no parâmetro obrigatório `input_token`; o código não registra URL, headers, resposta bruta nem exceção de transporte. Coleta manual/APM também não deve exportar esses valores.

## Arquivos

Código alterado (7 arquivos):

- `libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts`
- `libraries/nestjs-libraries/src/integrations/social/instagram-capabilities.ts`
- `libraries/nestjs-libraries/src/integrations/social/instagram-facebook-authorization.ts` (novo)
- `libraries/nestjs-libraries/src/instagram-comment-automation/instagram-comment-automation.service.ts`
- `apps/backend/src/services/instagram-comment-automations/instagram-comment-automation-crud.service.ts`
- `apps/frontend/src/components/instagram-automations/types.ts`
- `apps/frontend/src/components/instagram-automations/instagram-automations.component.tsx`

Testes alterados/adicionados (7 arquivos):

- `libraries/nestjs-libraries/src/integrations/social/instagram.provider.spec.ts`
- `libraries/nestjs-libraries/src/integrations/social/instagram-capabilities.spec.ts`
- `libraries/nestjs-libraries/src/integrations/social/instagram-facebook-authorization.spec.ts` (novo)
- `libraries/nestjs-libraries/src/integrations/social/instagram-comment-messaging.service.spec.ts`
- `libraries/nestjs-libraries/src/instagram-comment-automation/instagram-comment-automation.service.spec.ts`
- `apps/backend/src/services/instagram-comment-automations/instagram-comment-automation-crud.service.spec.ts`
- `apps/frontend/src/components/instagram-automations/instagram-automations.component.spec.tsx`

Este relatório é o 15º arquivo do conjunto. O código dos providers Standalone e das estratégias de envio permanece sem alterações. Foram preservadas as regressões de reconexão, Page token, respostas públicas e Standalone.

## Validação local

- Backend: 20 suites, 237 testes aprovados, incluindo provider tradicional e Standalone. Scopes concedidos/recusados/omitidos, login, reconexão, vínculo da Página, grants granulares, erros de leitura, entrega pública independente, reserva concorrente e ausência de reenvio são cobertos com respostas HTTP sintéticas. Na revisão final, a autorização funciona sem `pages_messaging` nas fixtures de configuração e entrega; testes específicos verificam que seu grant não substitui `instagram_manage_messages` nem cria bloqueio adicional.
- Frontend: 2 suites, 25 testes aprovados, incluindo conta selecionável com Direct sem autorização e histórico de falha parcial.
- TypeScript: backend, orchestrator e frontend aprovados com `--noEmit --incremental false`.
- Builds locais de backend, orchestrator e frontend aprovados, com exit code 0.
- `git diff --check` aprovado; sem staging ou commit. Alterações de código restritas aos sete arquivos listados, sem mudanças de infraestrutura ou schema.

Comandos de validação, executados por subprocessos Node com ambiente sanitizado:

```text
node node_modules/jest/bin/jest.js --config apps/backend/jest.instagram-webhook.config.js --runInBand --silent --testPathPattern "instagram|integration.multi-provider"
node node_modules/jest/bin/jest.js --config apps/frontend/jest.instagram-automations.config.cjs --runInBand --silent
node node_modules/typescript/bin/tsc --project apps/backend/tsconfig.build.json --noEmit --incremental false
node node_modules/typescript/bin/tsc --project apps/orchestrator/tsconfig.build.json --noEmit --incremental false
node node_modules/typescript/bin/tsc --project apps/frontend/tsconfig.json --noEmit --incremental false
```

Para os builds Nest, foi invocado `node <raiz>/node_modules/@nestjs/cli/bin/nest.js build` nos diretórios `apps/backend` e `apps/orchestrator`. Para o frontend, `node <raiz>/node_modules/next/dist/bin/next build` em `apps/frontend`. Nenhum script de startup, `postinstall`, Prisma CLI ou wrapper que carrega `.env` foi executado. Os logs de build ficaram no diretório temporário local, fora do Git.

Os subprocessos receberam ambiente sanitizado e valores locais sintéticos; não carregaram `.env`. Nenhum teste certifica os grants ou a aprovação do app real. Não foram iniciados workers, PM2 ou serviços da aplicação.

## Bloqueios externos e reconexão futura

O Advanced Access de `instagram_manage_messages` foi confirmado pelo operador. Não é tratado como bloqueio pendente desta correção. Isso não atualiza automaticamente grants de usuários ou tokens antigos: continua necessária a renovação da autorização das contas afetadas, preservando o vínculo existente com a Página e a tarefa `MESSAGING`. Não foi feita inspeção independente no Dashboard nem homologação autenticada do envio real. Não adicionar a tag Human Agent a mensagens automáticas.

Após autorização própria para a implantação desta correção:

1. Conferir a Página/Instagram correta, sem exportar tokens. O acesso avançado informado pelo operador já cobre `instagram_manage_messages`.
2. Reconectar somente as contas cujo Direct apresentar `RECONNECT_REQUIRED`, aceitando `instagram_manage_messages`. Não excluir as integrações; usar a reconexão já existente, que conserva a identidade e a Página. Não exigir `pages_messaging` nesse procedimento.
3. Conferir `comments=ACTIVE`, resposta pública disponível e Direct disponível. Se aparecer `VERIFICATION_UNAVAILABLE`, investigar a introspecção e a configuração do app; não invalidar a conexão por suposição.
4. Homologar com um comentário novo: uma resposta pública, um Direct confirmado por `message_id` e histórico correto. Não reprocessar comentários ou mensagens antigas que falharam.

Se o usuário não conceder `instagram_manage_messages`, o Direct permanece bloqueado, sem invalidar as demais funções. Não há fallback de endpoint ou token para contornar a autorização. A conclusão local não certifica o envio real: após publicação autorizada, homologar um comentário novo com o Page token renovado; eventual exigência adicional da Meta precisa de evidência antes de outra ampliação de scopes.
