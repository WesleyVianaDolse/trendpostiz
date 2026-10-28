# Diagnóstico isolado: Instagram Business Discovery v25.0

O diagnóstico desta execução ficou **bloqueado no ambiente local, antes de qualquer chamada Graph API**. Isso não é uma rejeição da Meta nem prova de inviabilidade da API.

O PostgreSQL indicado pelo `.env` do checkout recusou a conexão (`ECONNREFUSED`). As chaves locais dos apps Facebook/Instagram, tokens diretos e `IG_USER_ID` também não estão disponíveis no ambiente inspecionado. A existência e validade dos tokens armazenados, os vínculos das contas e as permissões concedidas permanecem desconhecidos. Nenhuma consulta a registros chegou a ser executada. Não foi inspecionada a configuração de produção.

## Evidências entregues

O arquivo `reports/instagram-business-discovery/relatorio-business-discovery-v25.json` registra o resultado sanitizado e aponta os arquivos de código inspecionados. Uma subpasta com data/hora preserva cada execução. Há SHA-256 dos arquivos inspecionados antes/depois e verificação de preservação do `.env`; o conteúdo e o hash do `.env` não são exportados.

O inventário pode ser reproduzido na raiz do TrendPostiz:

```powershell
node diagnostics/instagram-business-discovery/diagnose.mjs
```

O script é propositalmente um **pré-diagnóstico de configuração**, sem cliente Graph, OAuth ou refresh. Ele não importará os providers ou iniciará Nest, workers ou serviços da aplicação. Se o banco estiver disponível, abre `BEGIN READ ONLY`, verifica `transaction_read_only`, consulta somente nomes de providers e indicadores booleanos e encerra com `ROLLBACK`. Não lê valores de tokens, IDs de conta ou tenant. Não inicia PostgreSQL nem muda credenciais para superar o bloqueio. Código de saída 0 significa relatório produzido, inclusive para `environment_blocked`; não significa API validada. Erros internos ou falha de preservação retornam 1.

## Providers existentes

| Provider | Autenticação e API | Evidência no código |
| --- | --- | --- |
| `instagram` | Facebook Login; `graph.facebook.com`; versão v25.0 | `instagram.provider.ts`: constante de versão, `scopes`, `generateAuthUrl`, `authenticate`, `pages` e `fetchPageInformation`. É a rota candidata para a validação de Business Discovery. |
| `facebook` | Facebook Login para Facebook Pages; versão v25.0 | `facebook.provider.ts`. A lista de escopos deste provider não inclui por si só os escopos Instagram exigidos para a leitura pretendida. |
| `instagram-standalone` | Instagram Login; `graph.instagram.com`; permissões `instagram_business_*` | `instagram.standalone.provider.ts`. O código OAuth/profile ainda contém chamadas v21.0; publicação e messaging usam v25.0. Nenhuma versão foi alterada. Não se considera esse token intercambiável com Facebook Login. |

Os caminhos completos estão no relatório. A distinção entre os fluxos também consta da [coleção oficial da Meta](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-3fe78620-2258-44b6-893f-42d76c7200d7).

Um detalhe importante: em `IntegrationService.saveProviderPage`, a seleção de página substitui `Integration.token` pelo **Page access token**, coloca o IG user ID em `internalId` e registra `facebookPageId`. Não confundir Page ID, IG user ID e Facebook user ID. A compatibilidade de um token de publicação com Business Discovery precisa ser verificada, não presumida. `refreshToken` e validade local também não substituem validação da Meta. Não foram invocados serviços existentes que poderiam atualizar tokens, desconectar canais ou persistir caches.

## Documentação e elegibilidade: o que foi verificado

A [coleção oficial Meta para Facebook Login](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login) confirma que esse fluxo requer uma Facebook Page vinculada a uma conta profissional Instagram e oferece metadados de outras contas profissionais. Contas pessoais não estão abrangidas. Isso não confirma que `wesleydolse` é elegível na API.

As páginas oficiais específicas de [Business Discovery](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/business-discovery/) e da [referência `business_discovery`](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery/) não puderam ser lidas nesta sessão: houve HTTP 429/indisponibilidade na documentação. O relatório distingue esse HTTP do status da Graph API, que é `null` porque não houve chamada. Portanto, **não está concluída a confirmação oficial atual dos requisitos específicos, campos, paginação e suporte v25.0**. Não foi usada documentação de terceiros para afirmar elegibilidade.

O relatório separa as permissões **solicitadas no código** das permissões **efetivamente concedidas**, desconhecidas nesta execução. Para a continuação, a lista candidata a confirmar na referência oficial é `instagram_basic`, `instagram_manage_insights` e `pages_read_engagement`; `pages_show_list` serve à descoberta das páginas. Condições de papéis via Business Manager e permissões adicionais precisam ser avaliadas pelo caminho real de autorização. Não foi solicitado nenhum escopo novo.

## Continuação técnica, sem alterar produção

1. Usar um acesso somente leitura **já autorizado** ao ambiente correto, selecionando explicitamente uma integração e seu tenant. Não colar tokens ou App Secret no chat e não consultar outros clientes para encontrar um token que funcione.
2. Confirmar na documentação oficial a compatibilidade v25.0 e o tipo de token exigido. Validar validade/expiração, escopos concedidos e ativos autorizados por chamadas oficiais de leitura adequadas ao tipo de token. Não renovar nem trocar tokens automaticamente.
3. Verificar o vínculo Page → conta profissional Instagram e usar como origem o **IG user ID autenticado**. Se houver somente Instagram Standalone, não transportar seu token para a Graph do Facebook; registrar que a rota compatível ainda não foi estabelecida.
4. Somente após essas verificações, executar a expansão abaixo, com credencial apenas em memória/header e sem incluir IDs privados ou segredo no relatório:

```text
GET https://graph.facebook.com/v25.0/{IG_USER_ID_DA_ORIGEM}
fields=business_discovery.username(wesleydolse){username,media_count,media.limit(30){id,caption,media_type,timestamp,permalink}}
```

5. Respeitar o cursor retornado na expansão `media`, sem converter a consulta em leitura direta de mídia de terceiro como se fosse própria. Deduplicar em memória, limitar o total a 30 e interromper em erro ou limitação de acesso. Não prometer ordenação temporal que não foi validada; ordenar os itens recebidos por `timestamp` não comprova cobertura de todos os mais recentes.
6. Avaliar apenas `caption` real retornada pela API. Normalizar com NFD, remover marcas combinantes e comparar em minúsculas com `estrategia`. Registrar permalink e correspondências sem exportar IDs da origem/tenant. Diferenciar caption ausente, `null` e vazia.

A consulta e a busca **não foram executadas nesta sessão**. `posts_returned`, contagens de legendas e correspondências são `null`; arrays vazios não significam ausência de menções. O relatório inclui critérios distintos para nenhuma publicação, nenhuma legenda, permissão insuficiente, conta inelegível, token expirado, erro de API e bloqueio do ambiente. Um erro genérico 190 não prova expiração, e um erro genérico de objeto não prova que o alvo é conta pessoal.

## Recomendação para monitoramento multicliente

**Viabilidade condicional, ainda não demonstrada neste ambiente.** A rota a testar é Facebook Login com origem profissional vinculada e autorização verificada. Os providers existentes não comprovam acesso atual ao Business Discovery, e a conexão via Standalone não deve ser tratada como equivalente.

Antes de recomendar uso multicliente, obter ao menos uma legenda e permalink por API oficial e revisar com a Meta o modo do app, App Review, nível de acesso e ativos de cada cliente. A aprovação de publicação ou um teste com administrador não comprovam autorização de leitura para todos os clientes. Não se deve solicitar novas permissões nesta etapa.

Uma futura implementação deve manter isolamento por tenant, credenciais próprias por autorização, métricas de cobertura, deduplicação, progresso de paginação, controles por limites efetivamente retornados pela API e estados explícitos de expiração/revogação. Não estabelecer números de quota sem verificar o app e seus cabeçalhos de uso. Não prometer monitoramento de qualquer perfil pessoal nem ausência de palavras-chave em conteúdo não retornado. Nenhum banco, dashboard, integração nova ou processamento de IA foi desenvolvido para este diagnóstico.
