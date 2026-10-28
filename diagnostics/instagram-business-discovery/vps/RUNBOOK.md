# Diagnóstico 005 — pacote para revisão e aprovação

**Este pacote não foi executado na VPS e não obteve uma resposta real da Meta.** A preparação e os testes usam dados fictícios locais. Não executar `diagnose.mjs` do Diagnóstico 004 em produção: aquele inventário não seleciona um tenant exato. Para este experimento, usar exclusivamente `vps/run.mjs` e `vps/core.mjs`.

O objetivo da execução futura é obter ao menos uma legenda real e seu permalink em uma única consulta Business Discovery, ou registrar a resposta oficial sanitizada que impediu o teste. Uma falha local não será descrita como rejeição da Meta.

## 1. Seleção e autorização, antes de qualquer execução

O responsável deve aprovar uma seleção específica, registrada no procedimento interno:

| Informação | Como selecionar |
| --- | --- |
| Tenant | ID exato da organização que já autorizou o uso da integração. Obter no cadastro administrativo conhecido desse cliente, sem listar integrações de outros tenants. |
| Integração | ID exato da integração desse tenant, com `providerIdentifier = instagram`, ativa e com a seleção de página concluída. `facebook` e `instagram-standalone` são recusados. |
| Origem Instagram | `Integration.internalId` dessa integração; precisa ser o IG User ID profissional. Não é o Facebook User ID nem o Page ID. |
| Página | `Integration.facebookPageId` dessa mesma integração; deve corresponder ao vínculo profissional confirmado na Meta. |
| App | App ID já autorizado que emitiu a credencial de diagnóstico; será comparado ao `app_id` retornado pelo debugger oficial. |
| Credencial de diagnóstico | Facebook **User access token** existente, explicitamente selecionado, emitido pelo app aprovado e com acesso ao ativo escolhido. Deve ser fornecido apenas em memória/pipe. |
| Aprovação | Referência interna `CHG-...`, aprovador, janela do teste, seleção acima e destino do relatório fora do app. O relatório guarda apenas que houve referência; o vínculo com o registro de aprovação fica no procedimento externo. |

O script fará somente esta consulta de metadados, parametrizada e dentro de transação somente leitura:

```sql
SELECT "providerIdentifier", "internalId", "facebookPageId", "disabled", "deletedAt", "inBetweenSteps"
FROM "Integration"
WHERE "organizationId" = $1 AND "id" = $2
LIMIT 1;
```

Não há `SELECT *`, busca por perfil, enumeração de tenants nem seleção das colunas `token`/`refreshToken`. A comparação com os IDs de origem esperados ocorre antes de qualquer chamada Meta. Nenhum resultado de outra integração será usado como fallback. Se a seleção falhar, corrigir o procedimento fora desta execução; não tentar outro cliente automaticamente.

**Importante no TrendPostiz:** o fluxo existente `saveProviderPage` guarda um **Page token** em `Integration.token`. Esse token não é automaticamente a credencial adequada para este piloto. O utilitário aceita somente um token confirmado como `USER` por `/debug_token`, sem converter Page tokens, reaproveitar Instagram Standalone ou ler `refreshToken` do banco. Essa é uma restrição conservadora do utilitário, não uma afirmação de que todos os outros tipos são universalmente incompatíveis com a API.

## 2. Pré-requisitos a aprovar

- Linux e Node.js 22 já disponíveis na VPS ou no container existente escolhido. Nada deve ser instalado, reiniciado ou iniciado pelo procedimento.
- Dependência `pg` já resolvível a partir de `--app-root`. O código não importa Nest, Prisma, providers, Redis, filas ou workers. Se `pg` não estiver disponível, parar e reavaliar; não executar instalação na aplicação de produção.
- Credencial PostgreSQL já autorizada, preferencialmente com privilégio apenas de leitura da integração selecionada. O utilitário impõe `BEGIN READ ONLY`, confere `transaction_read_only` e finaliza com `ROLLBACK`. Opções de sessão não alteram configuração persistente do PostgreSQL.
- Saída HTTPS direta para `graph.facebook.com`, sem inspeção TLS que registre URLs/headers, sem debug de rede e sem instrumentação do processo. O programa não usa proxy, cookies, SDK Meta ou troca automática de tokens.
- Diretório de relatório já existente fora do app, com acesso restrito ao operador. O arquivo é criado com `wx` e modo `0600`, sem sobrescrever arquivos existentes ou seguir um symlink de arquivo. Não apontar para diretório mutável por usuários não confiáveis.
- Conferência, pelo aprovador, dos requisitos oficiais atuais de Business Discovery v25.0, do modo do app e de seu nível de acesso. `--requirements-reviewed` registra essa declaração; **não** concede permissões nem comprova App Review.

Na preparação, as páginas específicas da Meta voltaram a retornar HTTP 429/indisponibilidade. Isso não foi tratado como validação da documentação nem como erro da API do cliente. O gate conservador exige os escopos `instagram_basic`, `instagram_manage_insights` e `pages_read_engagement`. `pages_show_list` não é solicitado: não há enumeração de páginas. Se a documentação atual exigir condição adicional para o app/papel do operador, não marcar a revisão como concluída até verificar essa condição. Não solicitar permissões novas para este teste.

Referências oficiais para a revisão:

- [Business Discovery](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/business-discovery/).
- [Referência do campo business_discovery](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery/).
- [Debug Token](https://developers.facebook.com/docs/graph-api/reference/debug_token/).
- [Depuração de tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debugging-and-error-handling/).
- [Coleção Meta: Facebook Login](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login), que documenta o requisito de Page vinculada a conta profissional; os escopos de toda a coleção não devem ser confundidos com requisitos mínimos deste endpoint.

## 3. Fluxo autorizado: no máximo cinco chamadas GET

| Ordem | Leitura oficial | Condição para continuar |
| --- | --- | --- |
| 1 | `/v25.0/debug_token?input_token=...` | `is_valid=true`, tipo `USER`, app correto, Facebook user identificado, sem expiração ou expiração de acesso aos dados demonstrada. Escopos precisam estar disponíveis. Se os alvos granulares forem informados, precisam incluir a Page ou IG User selecionados. |
| 2 | `/v25.0/me/permissions?limit=100` | As três permissões exigidas devem estar concedidas e concordar com o debugger. Inventário com página adicional é interrompido, sem paginação. |
| 3 | `/v25.0/{PAGE_ID}?fields=id,instagram_business_account{id}` | Página esperada e vínculo com o IG User esperado conferem. Ausência do vínculo não é automaticamente classificada como conta pessoal. |
| 4 | `/v25.0/{IG_USER_ID}?fields=id,username` | A credencial consegue ler a identidade da origem profissional vinculada. O username da origem não é exportado. |
| 5 | `/v25.0/{IG_USER_ID}?fields=...` | Uma única consulta ao destino fixo `wesleydolse`, sem retry, fallback ou paginação. |

Campos exatos da quinta chamada:

```text
business_discovery.username(wesleydolse){username,media_count,media.limit(5){caption,media_type,timestamp,permalink}}
```

Não se pede `id` da mídia, URL de arquivo, alt, insights, comentários ou biografia. IDs implícitos eventualmente retornados pela Meta são descartados. Uma falha em qualquer etapa encerra o fluxo; não há descoberta adicional de perfis nem acesso direto às mídias de terceiros.

### Credencial verificadora do debugger

Por padrão, o debugger recebe a própria credencial de diagnóstico como Bearer de verificação. A Meta pode não permitir essa inspeção com uma credencial de usuário sem o papel exigido no app. Nesse caso o programa para e registra a resposta oficial; isso não demonstra que o token inspecionado é inválido.

Opcionalmente, o operador pode selecionar **previamente** outro token verificador existente e autorizado para a inspeção, de um usuário desenvolvedor/administrador do app, por `--verifier-fd 4`. Ele é usado apenas em `/debug_token`; as demais chamadas usam a credencial de diagnóstico. Não se acessa App Secret, não se gera app token e não se aceita um composto `APP_ID|APP_SECRET`. Falha de autenticação do verificador é identificada como falha da inspeção, sem atribuí-la automaticamente ao token de diagnóstico.

## 4. Comandos para revisão — executar apenas após aprovação

Copiar o diretório `vps` para a área de diagnóstico aprovada, fora do diretório de produção, sem executar deploy. Não é necessário copiar o restante do projeto ou alterar `package.json`.

Verificação offline, sem banco, credenciais ou rede:

```bash
node /AREA_APROVADA/vps/run.mjs --dry-run
node --test /AREA_APROVADA/vps/core.test.mjs
```

O modo padrão também é `dry_run`. Parâmetros de token literal são recusados. Não executar com `NODE_DEBUG`, `NODE_OPTIONS`, flags adicionais do Node (debugger, profiling, heap dump, keylog TLS ou preloads) ou validação TLS desabilitada. Flags do utilitário vêm depois de `run.mjs`; não são flags do runtime. Não utilizar `set -x`, gravação de terminal, shell com expansão impressa, `curl -v`, `tee` ou logs de payloads.

Exemplo de operação **manual e posterior à aprovação**, usando somente memória do shell e descritores herdados. Substituir somente os caminhos e identificadores não secretos pelos valores aprovados. As credenciais são solicitadas com eco desabilitado; não colar credenciais em comandos, histórico ou chat.

```bash
(
  set +x
  ulimit -c 0
  IFS= read -r -s -p 'Facebook User token de diagnóstico existente: ' DIAG_TOKEN
  printf '\n'
  IFS= read -r -s -p 'Conexão PostgreSQL somente leitura existente: ' DIAG_DB_URL
  printf '\n'

  node /AREA_APROVADA/vps/run.mjs \
    --execute --authorization-ref CHG-APROVACAO-REGISTRADA --requirements-reviewed \
    --app-root /CAMINHO/DO/APP/EXISTENTE \
    --tenant-id TENANT_EXATO --integration-id INTEGRACAO_EXATA \
    --expected-ig-user-id IG_ID_EXATO --expected-page-id PAGE_ID_EXATO \
    --expected-app-id APP_ID_EXATO \
    --token-fd 3 --database-fd 5 \
    --report /DIRETORIO_EXTERNO_RESTRITO/relatorio-005-EXECUCAO_UNICA.json \
    3< <(builtin printf '%s' "$DIAG_TOKEN") 5< <(builtin printf '%s' "$DIAG_DB_URL")

  result=$?
  unset DIAG_TOKEN DIAG_DB_URL
  exit "$result"
)
```

Os descritores precisam conter apenas o valor selecionado e chegar a EOF. O exemplo exige **Bash no Linux com process substitution e `/dev/fd`**, usando pipes; `printf` é explicitamente o builtin do shell, sem executar processo externo com o segredo em argv. Não trocar por here-document/here-string nem arquivo temporário. Um gerenciador de segredos já aprovado pode fornecer esses pipes diretamente, sem expor valores no terminal. Não introduzir gerenciador ou serviço novo para este diagnóstico. `read -s` evita eco; não protege contra gravação de entrada por ferramentas externas ou um administrador da VPS.

Para um verificador diferente, obter seu valor pelo mesmo mecanismo aprovado e acrescentar `--verifier-fd 4` com o descritor correspondente; não reutilizar o descritor do banco. IDs de seleção aparecem nos argumentos do processo e devem circular somente no procedimento interno; não aparecem no JSON. O relatório também não contém tokens, App Secret, cookies, IDs de origem/tenant, cursors ou URLs completas de requisição.

## 5. Relatório e classificação

O arquivo é JSON sanitizado. stdout contém apenas estado, motivo, contagem de requisições e contagens de mídia/legenda. Erros locais não imprimem stack, URL de conexão ou mensagem bruta de bibliotecas.

- `success`: ao menos uma caption não vazia retornada por Business Discovery e um permalink público válido da mesma mídia.
- `partial`: mídias retornadas sem satisfazer esse critério; caption ausente, `null`, vazia e com tipo inválido são estados separados.
- `no_publications`: resposta bem-sucedida com `media_count=0` e coleção vazia; coleção vazia isoladamente gera `empty_media_page`.
- `insufficient_permission`: ausência demonstrada dos grants exigidos ou alvos granulares incompatíveis.
- `permission_or_policy_denied`: erro Meta 10/200, que também pode envolver política, modo do app ou acesso; não é automaticamente um escopo ausente.
- `token_expired`: expiração demonstrada pelo debugger ou subcódigo Meta explícito 190/463. Código 190 sem essa evidência gera `token_invalid`, com causa não determinada entre invalidação/revogação/expiração.
- `rate_limited`: HTTP 429 ou código explícito de limite; não tenta novamente.
- `account_not_eligible`: somente mensagem Meta explícita exigindo conta profissional; não identifica automaticamente o alvo como conta pessoal. Erro genérico 100/803/404 gera `unavailable_or_not_accessible`.
- `token_inspection_failed`: `/debug_token` não pôde inspecionar a credencial, inclusive por falha do verificador. A validade do token de diagnóstico permanece desconhecida; o HTTP/código Meta original dessa etapa é preservado sem atribuição indevida.
- `unsupported_field`, `api_error`, `network_error`, `environment_blocked` e `validation_blocked`: falhas distintas, com etapa e motivo estável. Falha local não inclui código Meta inventado.

`requests` registra etapa, GET, host, versão, HTTP e código/subcódigo/tipo Meta sanitizados. Mensagens, trace IDs, respostas brutas e headers não são persistidos. O resumo das condições conhecidas do erro usa etiquetas fixas, sem texto livre da Meta. O número de chamadas é contado separadamente para não confundir os preflights com a única consulta Business Discovery.

A busca avalia somente captions reais da API. Conta `estratégia` e `estrategia` separadamente sem diferenciar caixa, e registra uma contagem combinada após NFD e remoção de marcas combinantes. Considera palavra inteira Unicode; não conta `estratégias` ou `estrategicamente`. Quando não há legenda verificável, o resultado é `evaluated=false`/`null`, não zero menções. A busca ocorre antes da redação do texto; `caption_redacted_in_report` e truncamento indicam quando o texto exportado difere do original. URLs de permalink têm query/fragmento removidos.

`returned_media`, `confirmed_captions`, `captions_with_permalink` e `caption_coverage` se referem somente à amostra retornada de até cinco itens. Não se afirma cobertura de todas as publicações recentes. Cursor é apenas convertido em indicador de disponibilidade; não é seguido ou exportado.

Códigos de saída: `0` para sucesso do critério caption+permalink; `2` para investigação concluída sem esse sucesso; `1` para erro local de preparação/execução. Dry-run e ajuda retornam `0` sem dizer que o critério foi atingido. Um relatório já existente não é sobrescrito.

## 6. Riscos e limites a aceitar na aprovação

1. Até cinco GETs consomem quota, são visíveis à Meta e podem gerar logs de auditoria do PostgreSQL/infraestrutura. O programa não publica nem modifica registros.
2. `/debug_token` exige o token inspecionado no parâmetro `input_token`. O programa nunca registra essa URL, mas proxies de inspeção, agentes de APM ou logs externos podem capturá-la. Não executar se isso não estiver controlado.
3. Credenciais existem temporariamente em memória do shell, Node e cliente PostgreSQL. JavaScript não garante apagamento físico de strings/heap; um administrador do host pode observar processos/memória. Não usar ambientes com heap dumps, profiling ou captura de requisições. Os buffers de leitura são zerados, mas isso não equivale a apagar todas as cópias.
4. O relatório contém captions e links públicos, além do resultado operacional; tratá-lo conforme a política de acesso e retenção do cliente. Permissões de arquivo não impedem acesso de root.
5. Meta pode negar inspeção, grants, ativos, campos ou o próprio endpoint. O utilitário para e não amplia escopos, executa OAuth, faz refresh, altera configuração ou tenta outro token/tenant automaticamente.
6. A execução não cria um coletor multicliente e não comprova cobertura de contas pessoais. Um sucesso autoriza apenas a conclusão sobre essa amostra, credencial, app e instante.

**Estado da entrega:** código, testes e procedimento prontos para revisão. Qualquer execução com `--execute` na VPS depende de autorização posterior explícita do responsável.
