# Diagnóstico do worker Temporal — v1.7.4

Auditoria local em 13/11/2026. Nenhum processo de aplicação foi iniciado, nenhum worker foi conectado ao Temporal e nenhuma ação foi realizada em produção nesta auditoria. Este documento contém diagnóstico e propostas; não implementa a v1.7.5.

Atualização posterior: o diagnóstico adicional do PID 165 e os testes com Temporal descartável estão em [temporal-orchestrator-native-startup-v1.7.4.md](temporal-orchestrator-native-startup-v1.7.4.md). A ausência de testes de runtime descrita neste documento refere-se à primeira etapa da investigação; a etapa adicional executou partidas isoladas, sem operações em produção.

**1. Conclusão e limites da evidência**

O histórico informado para `instagram-comment-cmwew960m000tmq4fj71tkx9z` termina em `WorkflowTaskScheduled`, sem `WorkflowTaskStarted`. Somado aos zero pollers de workflow/activity em `default/main`, isso comprova a ausência de consumo dessa fila no servidor consultado. A execução desse workflow ainda não chegou à activity `prepare`, onde são reconhecidos os gatilhos e criados os registros de execução. Portanto, zero execuções e nenhuma falha no histórico da automação são compatíveis com essa interrupção anterior ao processamento. O erro de permissão do Direct da versão anterior não explica essa interrupção.

A causa imediata está comprovada pelos dados fornecidos. O motivo de o processo não produzir pollers ainda não está comprovado: não tivemos acesso ao artefato, ao ambiente do processo Node real, ao health check nem aos logs de inicialização do container afetado. Um processo online no PM2 e uma conexão TCP com a porta 7233 não comprovam inicialização dos workers nem sucesso dos RPCs de polling.

**2. Comparação exata das versões**

| Versão identificada pelo usuário | Commit |
| --- | --- |
| `fix: v1.7.3 update api meta, connection` | `35ac133fc37d0b85c8b002a22fbd0134d23e3312` |
| `fix: direct message instagram business v1.7.4` | `36f4cd9971d5f304b0ab94f373160ea632341ac4` |

O diff tem 12 arquivos, 539 inserções e 18 exclusões. Não há diferenças em `apps/orchestrator/src/main.ts`, `app.module.ts`, `health.controller.ts`, no workflow de comentários em produção, nas activities de comentários, em `libraries/nestjs-libraries/src/temporal/`, `package.json`, `pnpm-lock.yaml`, nos scripts/configurações de build do orchestrator, `Dockerfile.dev` ou `docker-compose.yaml`. A alteração do workflow de comentários é apenas em seu teste.

As mudanças funcionais da v1.7.4 concentram-se no endpoint e na reserva da tentativa de Direct, na classificação final das entregas e na exibição do histórico. Elas não removem workers nem mudam filas. Isso não demonstra que os dois containers executem os mesmos artefatos: imagem, processo efetivo e dependências instaladas precisam ser conferidos.

Comando local somente de leitura para repetir o comparativo:

```sh
git diff --stat 35ac133fc37d0b85c8b002a22fbd0134d23e3312 36f4cd9971d5f304b0ab94f373160ea632341ac4
git diff 35ac133fc37d0b85c8b002a22fbd0134d23e3312 36f4cd9971d5f304b0ab94f373160ea632341ac4 -- apps/orchestrator libraries/nestjs-libraries/src/temporal package.json pnpm-lock.yaml Dockerfile.dev docker-compose.yaml
```

**3. Caminho real de inicialização**

| Arquivo / função | Comportamento relevante |
| --- | --- |
| `apps/orchestrator/src/main.ts:24`, `bootstrap` | Arma timeout de 120 s; cria Nest; chama `app.listen`; cancela timeout apenas após a inicialização. Falha de bootstrap registrada com stack e `process.exit(1)`. |
| `apps/orchestrator/src/app.module.ts:21` | Chama `getTemporalModule(true, require.resolve('./workflows'), activities)`. Logo, este processo é configurado para executar workers. |
| `libraries/nestjs-libraries/src/temporal/temporal.module.ts:10`, `getTemporalModule` | `allowConnectionFailure:false`, `autoRestart:true`, `maxRestarts:50`; workers com `autoStart:true`. |
| `node_modules/nestjs-temporal-core/dist/services/temporal-worker.service.js:52`, `onModuleInit` | Aguarda a criação dos múltiplos workers. Falhas são registradas e propagadas com a configuração utilizada. |
| Mesmo arquivo, `initializeMultipleWorkers:144` / `createWorkerFromDefinition:164` | Conecta via `NativeConnection`; cria os workers sequencialmente; aguarda `Worker.create()` em cada fila; registra a instância no mapa somente depois da criação. |
| Mesmo arquivo, `onApplicationBootstrap:88` | Depois da inicialização dos workers, chama `startWorkerByTaskQueue` para as filas. Criar um worker não inicia polling. |
| Mesmo arquivo, `startWorkerByTaskQueue:259` | Marca `isRunning=true` e chama a função que inicia `worker.run()`. A conclusão deste método não aguarda a vida inteira do worker nem confirma um poll no servidor. |
| Mesmo arquivo, `runWorkerWithAutoRestartByTaskQueue:305` | Instala `.catch()` em `worker.run()`. Registra erros e tenta recriar o worker, até o limite configurado. A rejeição assíncrona não é propagada diretamente para `bootstrap()`. |
| Mesmo arquivo, `autoRestartWorkerByTaskQueue:332` | Recria e inicia o worker após falha; falha dessa recriação é registrada. Não confundir essas tentativas internas com reinicializações do processo contabilizadas pelo PM2. |
| Mesmo arquivo, `calculateWorkerHealth:909` | Exige inicializado, sem erro, `isRunning=true` **e** `worker.getState()==='RUNNING'`. Não consulta os pollers registrados no servidor. |
| `apps/orchestrator/src/main.ts:42` | Watchdog consulta esse estado após 60 s de tolerância, a cada 30 s. Três verificações consecutivas com erro encerram o processo: aproximadamente 150 s após `listen`, se o event loop estiver funcionando. |
| `apps/orchestrator/src/health.controller.ts:14`, `getHealthStatus` | Verifica conectividade gRPC/namespace com conexão própria e o mesmo estado dos workers. Retorna 503 se `main` estiver ausente ou algum worker conhecido estiver com erro. Não comprova que a conexão nativa dos workers esteja realizando polls. |

O SDK define `RUNNING` no início de `runInternal`, antes do processamento dos streams de polling. Seu `getStatus()` também oferece estados separados dos pollers e polls pendentes. Logo, `RUNNING` é evidência local de execução do loop, sem confirmação remota de polls bem-sucedidos. Essa limitação de observabilidade está comprovada; seu envolvimento no incidente depende do health check e dos logs reais.

Há ainda dois limites do watchdog: ele é armado dentro de `bootstrap()`, depois dos imports estáticos e de `initializeSentry`; e seus timers dependem do event loop. Uma demora antes desse ponto ou um bloqueio síncrono não são diagnosticados adequadamente por esse timer. Não há evidência de que isso aconteceu em produção.

A factory da biblioteca (`dist/providers/temporal-connection.factory.js`, `createNewWorkerConnection`) captura falhas da conexão injetada e retorna `null`, mesmo com a opção restritiva. No caminho efetivamente usado pelo manager, `createConnection` tenta conectar novamente e propaga a falha porque `allowConnectionFailure=false`. Portanto, encontrar o log da factory retornando `null` é relevante, mas não basta para afirmar que o bootstrap atual aceita ficar permanentemente sem workers.

**4. Configuração e filas esperadas**

- Endereço: `process.env.TEMPORAL_ADDRESS || 'localhost:7233'`. Com o ambiente informado: `postiz-temporal:7233`.
- Namespace: `process.env.TEMPORAL_NAMESPACE || 'default'`, repassado ao client e a cada `Worker.create`. A variável ausente não é defeito neste código.
- TLS somente com `TEMPORAL_TLS==='true'`; API key somente quando configurada. Não é necessário revelar seu valor.
- 32 filas de workers são configuradas estaticamente: `main`, `x`, `linkedin`, `reddit`, `instagram`, `facebook`, `threads`, `youtube`, `gmb`, `tiktok`, `pinterest`, `dribbble`, `discord`, `slack`, `kick`, `twitch`, `mastodon`, `bluesky`, `lemmy`, `wrapcast`, `telegram`, `nostr`, `vk`, `medium`, `devto`, `hashnode`, `wordpress`, `listmonk`, `moltbook`, `whop`, `skool`, `mewe`.
- Todos recebem o mesmo módulo de workflows e as mesmas cinco classes de activities: `PostActivity`, `AutopostService`, `EmailActivity`, `IntegrationsActivity`, `InstagramCommentAutomationActivity`.
- Identificadores com hífen são filtrados: `linkedin-page` e `instagram-standalone`. Publicações desses providers usam o prefixo da fila. As automações de comentários dos **dois** providers usam explicitamente `main`, por `InstagramCommentAutomationDispatcherService.dispatch`. A ausência de uma fila chamada `instagram-standalone` é esperada.

Como a criação é sequencial e o início ocorre em outro hook, uma criação lenta de qualquer uma das 32 filas pode impedir o início de todas, inclusive `main`, temporariamente. É hipótese verificável pela sequência dos logs; com este bootstrap e event loop responsivo, uma inicialização presa deve atingir o timeout de 120 s, em vez de permanecer indefinidamente online.

**5. Build, pnpm e PM2**

O script de `apps/orchestrator/package.json` é:

```text
dotenv -e ../../.env -- node --experimental-require-module ./dist/apps/orchestrator/src/main.js
```

É compatível com o layout compilado local existente. O `outDir` é `apps/orchestrator/dist`, preservando a árvore do monorepo. Foram encontrados `dist/apps/orchestrator/src/main.js`, `app.module.js`, `workflows/index.js` e `dist/libraries/nestjs-libraries/src/temporal/temporal.module.js`. Os compilados `main.js`, `app.module.js` e `temporal.module.js` passaram em `node --check`, sem executar seus imports. Isso não certifica o artefato do container.

O Compose faz `cd /app/apps/orchestrator` antes de `pm2 start pnpm --name orchestrator ... -- start`. Esse diretório torna os caminhos relativos corretos. Executar `pnpm start` em outro diretório não é equivalente. O PM2 supervisiona inicialmente o wrapper pnpm; é necessário identificar também o processo Node que executa o `main.js` compilado. O `dotenv-cli` pode preencher variáveis ausentes a partir de `/app/.env`; o ambiente do container, sozinho, não mostra necessariamente o que o Node recebeu.

Lockfile e instalação local: `nestjs-temporal-core@3.2.3` e SDKs Temporal `1.15.0`. O JavaScript local do manager foi comparado em memória com o tarball oficial dessa versão no npm: bytes idênticos, SHA-256 `321f998bfccdf6ef1f8d517a611c477ba1e0e0cc054eb9bd41e1c3cf9695f1e3`. Nenhuma instalação foi realizada. Não há evidência de incompatibilidade entre essas versões nesta auditoria.

`Dockerfile.dev` usa Node `22.20-bookworm-slim`, pnpm `10.6.1`, instala PM2 sem versão fixa e executa `pnpm install` e build. O Compose usa imagem `:latest`. Nada disso mudou no diff, mas o nome da versão não identifica por si só a imagem/digest ou o artefato executado. Usar digest e revisão verificável é necessário para comparar releases reais. A ausência de `--frozen-lockfile` explícito não prova que as dependências tenham divergido.

Não executar `pnpm start`, `pnpm run pm2`, Compose up/restart nem o entrypoint compilado para diagnosticar em produção. Esses comandos iniciam consumo; os scripts globais também contêm `prisma-db-push` e operações PM2. O código atual não oferece uma chave de manutenção que bloqueie o início de todos os workers.

**6. Confirmação em produção — exclusivamente leitura**

Os exemplos abaixo são para um terminal **Linux no host Docker**, por um operador autorizado. São instruções, não foram executados nesta auditoria. Não usar `docker inspect` sem filtro, `printenv`, `pm2 env` ou JSON bruto do PM2 ao compartilhar resultados: podem conter credenciais. Não compartilhar payloads de workflows, textos de comentários ou conteúdo de posts.

Registrar primeiro o artefato e o estado, sem reiniciar:

```sh
docker inspect --format '{{.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}} {{.RestartCount}}' postiz
docker exec postiz ps -eo pid,ppid,lstart,comm
docker exec postiz node -e 'fetch("http://127.0.0.1:3002/health/status",{signal:AbortSignal.timeout(15000)}).then(async r=>{console.log("HTTP",r.status);console.log(await r.text())}).catch(e=>{console.error(e.message);process.exitCode=1})'
```

Se a porta configurada for diferente, usar o valor encontrado no processo real. Revisar localmente mensagens de erro antes de compartilhar; o health atual pode devolver texto de erros da biblioteca.

O comando seguinte apenas lê `/proc`, arquivos compilados e metadados de pacotes. Não importa o aplicativo nem o SDK. Imprime somente os parâmetros de conexão permitidos e presença de credencial, nunca seu valor. O ambiente lido é o recebido pelo Node após o wrapper `dotenv`; mudanças posteriores dentro do processo não seriam refletidas.

```sh
docker exec -i postiz node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const safe = s => s && /^[a-zA-Z0-9_.:[\]-]+$/.test(s) ? s : (s ? '[omitido: formato inesperado]' : null);
let found = 0;
for (const pid of fs.readdirSync('/proc').filter(p => /^\d+$/.test(p))) {
  try {
    const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    const arg = argv.find(a => /(?:^|\/)dist\/apps\/orchestrator\/src\/main\.js$/.test(a));
    if (!arg) continue;
    const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    const entry = path.resolve(cwd, arg);
    const env = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8')
      .split('\0').filter(Boolean).map(v => { const i = v.indexOf('='); return [v.slice(0,i), v.slice(i+1)]; }));
    const req = createRequire(entry);
    const versions = {};
    for (const name of ['nestjs-temporal-core', '@temporalio/worker', '@temporalio/client', '@temporalio/core-bridge']) {
      try { versions[name] = req(name + '/package.json').version; }
      catch { versions[name] = 'não resolvido'; }
    }
    const files = [entry,
      path.join(path.dirname(entry), 'app.module.js'),
      path.join(path.dirname(entry), 'workflows/index.js'),
      path.resolve(path.dirname(entry), '../../../libraries/nestjs-libraries/src/temporal/temporal.module.js')];
    const source = fs.readFileSync(entry, 'utf8');
    const ppid = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^PPid:\s*(\d+)/m)?.[1];
    console.log(JSON.stringify({pid, ppid, cwd, executable:fs.readlinkSync(`/proc/${pid}/exe`),
      address:safe(env.TEMPORAL_ADDRESS || 'localhost:7233'),
      namespace:safe(env.TEMPORAL_NAMESPACE || 'default'),
      tls:env.TEMPORAL_TLS === 'true', apiKeyPresent:!!env.TEMPORAL_API_KEY,
      port:safe(env.ORCHESTRATOR_PORT || '3002'), versions,
      watchdogPresent:source.includes('orchestrator-watchdog'),
      files:files.map(p=>({path:p, exists:fs.existsSync(p), sha256:fs.existsSync(p)?sha(p):null}))},null,2));
    found++;
  } catch (e) {
    // Processos podem terminar entre as leituras; não imprimir ambiente ou cmdline.
    if (!['ENOENT','EACCES','EPERM','ESRCH'].includes(e.code)) console.error('Falha de leitura do PID',pid,e.code || e.name);
  }
}
if (!found) console.log('Nenhum Node com o entrypoint compilado esperado foi localizado. Conferir a árvore de processos e o caminho real, sem iniciá-lo.');
NODE
```

Os hashes servem para comparar artefatos produzidos com o mesmo procedimento; diferenças de compilador/dependências também podem produzir diferenças. Conferir o código do artefato localmente para `getTemporalModule(true)`, `allowConnectionFailure:false`, endereço/namespace e watchdog. Um hash diferente sozinho não determina a causa.

Nos logs existentes do orchestrator, localizar nesta ordem, registrando horários e erros sanitizados:

1. `Creating new client connection`, `Worker connection established`, ou erros de conexão.
2. `Initializing 32 workers...`, logs de bundle por fila e o último `Worker.create`/bundle concluído.
3. `Successfully initialized 32 workers` e `Starting configured workers...`.
4. `Worker 'main' started`, `Worker 'instagram' started`, `Worker 'facebook' started`, demais filas e `Started 32 workers successfully`.
5. `Orchestrator health check listening on port ...`.
6. `auto-restarting`, `Auto-restart failed`, `run failed`, `Worker failed`, erros gRPC/native worker e `[orchestrator-watchdog]`.

Consultar pela UI ou CLI já disponível **no mesmo cluster**, namespace e filas. Exemplos com CLI Temporal; se a versão instalada tiver flags diferentes, consultar `--help` e usar somente operações `describe`, `list` e `show` equivalentes:

```sh
temporal --address postiz-temporal:7233 --namespace default task-queue describe --task-queue main --task-queue-type workflow
temporal --address postiz-temporal:7233 --namespace default task-queue describe --task-queue main --task-queue-type activity
temporal --address postiz-temporal:7233 --namespace default task-queue describe --task-queue instagram
temporal --address postiz-temporal:7233 --namespace default task-queue describe --task-queue facebook
temporal --address postiz-temporal:7233 --namespace default workflow describe --workflow-id instagram-comment-cmwew960m000tmq4fj71tkx9z
temporal --address postiz-temporal:7233 --namespace default workflow list --query 'ExecutionStatus = "Running"'
```

`postiz-temporal` é nome DNS da rede Docker; os comandos precisam ocorrer onde esse nome resolva ou usar o endereço equivalente confirmado. Não iniciar o entrypoint do container para obter uma CLI. Inspecionar também as demais filas e todos os workflows abertos, inclusive os aguardando timers; 18 tarefas não significam necessariamente 18 workflows ou 18 publicações. Históricos completos e `describe` podem conter inputs: examiná-los apenas no ambiente restrito e compartilhar somente estado, tipo, horários e nomes de events/activities, sem payloads. Fixar o Run ID ao inspecionar cada histórico.

Consultas PostgreSQL em uma sessão com credenciais de leitura existentes, sem inserir segredos no comando. Tipos, campos e tabelas correspondem ao schema versionado. Sem `SELECT *`:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT e.id, e.status, e."receivedAt", i."providerIdentifier",
       x.id AS "executionId", x."publicReplyStatus", x."privateReplyStatus", x."processedAt"
FROM "InstagramWebhookEvent" e
LEFT JOIN "Integration" i ON i.id = e."integrationId"
LEFT JOIN "InstagramCommentAutomationExecution" x ON x."webhookEventId" = e.id
WHERE e.id = 'cmwew960m000tmq4fj71tkx9z';

SELECT status, COUNT(*) AS total, MIN("receivedAt") AS oldest
FROM "InstagramWebhookEvent"
WHERE status IN ('RECEIVED', 'PROCESSING')
GROUP BY status;

SELECT p.id, p.state, p."publishDate", i."providerIdentifier",
       (p."releaseId" IS NOT NULL) AS "hasRemoteId",
       (p."releaseURL" IS NOT NULL) AS "hasRemoteUrl",
       (p."adminPausedAt" IS NOT NULL) AS paused,
       p."intervalInDays", p."parentPostId"
FROM "Post" p
JOIN "Integration" i ON i.id = p."integrationId"
WHERE p."deletedAt" IS NULL AND p."publishDate" < CURRENT_TIMESTAMP
  AND (p.state = 'QUEUE' OR p.id IN (
    -- Para cada post identificado no inventário Temporal, substituir por seu ID.
    'SUBSTITUIR_POR_POST_ID_DO_INVENTARIO'
  ))
ORDER BY p."publishDate" ASC
LIMIT 200;

ROLLBACK;
```

Paginar o inventário de posts se houver mais de 200; incluir separadamente IDs de workflows abertos, inclusive recorrências, mesmo se o post estiver publicado. `hasRemoteId=false` não prova ausência de publicação externa. Nenhuma dessas consultas lê token, comentário, payload, texto do post ou erro bruto.

**7. Como as leituras distinguem as hipóteses**

| Evidência encontrada | Conclusão / próximo diagnóstico |
| --- | --- |
| Endereço/namespace do Node diferem da fila inspecionada | Explica a ausência de pollers naquele destino. Corrigir a configuração efetiva somente depois do inventário dos dois destinos. |
| Artefato sem watchdog/sem configuração de workers, entrypoint diferente ou wrapper sem Node correspondente | Divergência de execução/build. O diff do repositório não explica o binário implantado. Corrigir o empacotamento/entrypoint comprovadamente errado. |
| Sem log de `listen`, progresso interrompido na conexão ou no bundle | Bootstrap incompleto. Investigar o erro/etapa registrada e os limites de recursos. Com timers ativos, este bootstrap deve sair em 120 s; estabilidade superior exige explicar watchdog ausente, imports anteriores ou event loop bloqueado. |
| HTTP 503, workers ausentes/com erro, por mais de aproximadamente 150 s após `listen`, mesmo PID | Contradiz o watchdog esperado, salvo event loop bloqueado ou estado oscilando entre checks. Conferir artefato/processo e horários. Não concluir que basta acrescentar outro watchdog. |
| HTTP 200, workers RUNNING, mas sem pollers no mesmo destino | Demonstra que o health local não reflete consumo remoto. Conferir RPCs nativos, identidade/partições da fila e logs do servidor; TCP e `describeNamespace` não validam `PollWorkflowTaskQueue`/`PollActivityTaskQueue`. |
| Logs repetidos de erro e recriação de worker, PM2 sem restart | Compatível com reinício interno da biblioteca. Identificar o primeiro erro e se os curtos intervalos RUNNING mascaram o watchdog. |

Não há evidência que justifique alterar scopes, endpoint do Direct, deduplicação, namespace para outro valor, migrar filas ou modificar o Standalone para resolver a ausência de polling.

**8. Proposta mínima para v1.7.5 — ainda não implementada**

Separar o ajuste que corrige o incidente do ajuste de observabilidade. A correção causal deve ser escolhida pela evidência da seção 7: entrypoint/artefato, configuração efetiva ou a falha específica de conexão/criação/execução. O diff atual não sustenta um patch funcional único que comprovadamente restabeleça os pollers. Não propor downgrade de SDK, aumentar timeouts ou paralelizar 32 criações sem comprovar a necessidade.

Melhorias delimitadas que o código auditado justifica:

1. Registrar revisão/digest do build e configuração Temporal efetiva sanitizada, quantidade e nomes das filas; marcos com duração para conexão, criação e início por fila. Nunca registrar API key nem ambiente completo.
2. Manter as promessas de `worker.run()` supervisionadas durante toda a vida do processo, distinguindo parada solicitada de falha/saída inesperada; não aguardar o término normal dessas promessas dentro do bootstrap, pois elas duram toda a execução do worker. Preservar a propagação de erros de `Worker.create` e limites de inicialização já existentes.
3. Expor no readiness namespace, filas esperadas versus existentes, estado nativo e estado dos pollers. Correlacionar com identidade e polls observados no servidor, com tolerância temporal e tratamento de capacidade/busy workers; um snapshot sem poll não deve disparar reinício indiscriminado. O health atual não valida a lista completa das 32 filas nem progresso remoto.
4. Permitir manutenção explícita antes de qualquer `worker.run()` para preparar uma recuperação controlada, impedindo também o início automático/reinício interno das filas enquanto retidas. Essa opção **não existe hoje**; implementá-la exigiria autorização e teste. Ela não deve alterar o namespace ou fingir saúde.

Nenhum ajuste no OAuth, no Standalone ou na lógica de respostas é necessário para a instrumentação. A correção do endpoint de Private Reply e a reserva atômica permanecem preservadas. Testes de aceitação da futura correção devem cobrir falha e timeout de criação, falha e parada do run loop, readiness sem polling, ausência de qualquer fila esperada e partida pelo artefato Linux/Node/entrypoint real em Temporal isolado. Exigir pollers de workflow e activity e a progressão real até `WorkflowTaskStarted`/activities com provedores externos substituídos. Testes simulados não homologam produção.

**9. Recuperação das tarefas pendentes — plano, sem execução**

O risco de efeitos atrasados é concreto:

- `post.workflow.v1.0.5.ts:95-105` permite posts `QUEUE` e usa espera zero se `publishDate` passou. Recorrências `postNow` têm tratamento distinto; examinar também versões V101–V104 presentes nos históricos.
- `missing.post.workflow.ts` chama `searchForMissingThreeHoursPosts`; apesar do nome, a consulta em `posts.repository.ts:36` busca posts atrasados dos últimos **dois dias**, e `PostActivity.searchForMissingThreeHoursPosts` usa `signalWithStart` para acordar/criar workflows.
- `postSocial` chama o provider antes do `updatePost` realizado pelo workflow. Entre efeito remoto e persistência há possibilidade de resultado ambíguo; replay normal não repete activities já concluídas no histórico, mas tentativas de activities sem confirmação podem repetir efeitos.
- As proteções de `PlatformService.canPublishPosts` incluem pausa, exclusão, suspensão e comparação do agendamento. Não constituem uma política geral para rejeitar todo post atrasado nem garantem exatamente uma publicação.
- Automações de comentários possuem IDs determinísticos, unicidade e reserva de Direct; isso reduz duplicidades, mas não autoriza responder automaticamente todo comentário antigo. `prepare` não estabelece idade máxima para resposta pública. O dispatcher reconcilia eventos `RECEIVED` a cada minuto. Apenas cancelar/encerrar um workflow não garante que esse reconciliador não volte a tentar seu evento. A janela privada de sete dias é verificada pela aplicação com base em `receivedAt`.

Sequência proposta para uma intervenção futura, com autorização operacional específica:

1. Manter o consumo retido. Inventariar todos os workflows abertos, filas de workflow/activity, timers, schedules/reconciliadores, retries e IDs de posts/eventos. Identificar atividades já iniciadas, pendentes ou com efeito remoto incerto; incluir histórico recente concluído se necessário à conciliação. Não limitar a análise aos 18 itens aproximados.
2. Classificar cada item: futuro válido, atrasado aguardando decisão do cliente, comentário de teste descartável, já entregue externamente ou resultado ambíguo. Conferir provider/permalink/IDs remotos por leitura; não reenviar itens ambíguos. Usar o mesmo workflow/run e os registros existentes como referência; não criar IDs novos para contornar deduplicação.
3. Definir retenção por item e bloquear previamente os produtores que possam recolocar itens retidos na fila. Cancelamento cooperativo precisa de worker para ser processado e não serve sozinho para conter consumo. Qualquer encerramento de workflow, pausa de agendamento/reconciliador ou ajuste auditado de estado é mutação, não faz parte desta auditoria e exige autorização posterior. Não apagar a fila nem fazer resets/replays de recuperação.
4. Homologar a correção em ambiente isolado, com Temporal/DB de teste e sem tokens de clientes. Só depois preparar a recuperação em produção: todos os itens não autorizados devem estar efetivamente retidos, inclusive nos mecanismos de reconciliação, antes de iniciar um worker da fila compartilhada. Não existe filtro de consumo por workflow ID nesta configuração; iniciar apenas um worker `main` já pode avançar vários fluxos e agendar activities em outras filas.
5. Na janela autorizada, liberar somente o conjunto conciliado. Baixa concorrência limita volume, mas não seleciona quais itens serão consumidos. Conferir IDs e sucesso remoto antes de liberar qualquer item ambíguo; não reenviar Directs antigos que falharam. Monitorar filas, activities, estado do banco e provas de entrega, com uma forma previamente aprovada de interromper consumo.
6. Validar depois com um comentário novo autorizado: recepção, evento persistido, `WorkflowTaskStarted`, activity `prepare`, uma execução, resposta pública e resultado separado do Direct. Validar deduplicação sem repetir o envio e compatibilidade com Standalone em homologação. A recuperação não está concluída só porque a fila diminuiu ou o health retornou 200.

**10. Verificações realizadas e referências**

Foram realizados diff exato dos commits, leitura do bootstrap/código compilado e dos caminhos de publicação/reconciliação, enumeração estática das 32 filas, conferência de versões/resolução dos pacotes, comparação em memória do manager com a distribuição oficial npm e checagem de sintaxe dos compilados de bootstrap/configuração. Nenhum build ou teste de runtime foi iniciado nesta auditoria; não houve mudança funcional que exigisse novo build. Os testes diferenciais da investigação anterior não demonstram polling no container de produção.

Referências primárias consultadas: [Worker — run/getState/getStatus](https://typescript.temporal.io/api/classes/worker.Worker), [Task Queues](https://docs.temporal.io/task-queue), [CLI task-queue describe](https://docs.temporal.io/cli/command-reference/task-queue), [CLI workflow describe/list/show](https://docs.temporal.io/cli/command-reference/workflow) e [metadados da distribuição npm 3.2.3](https://registry.npmjs.org/nestjs-temporal-core/3.2.3). A semântica do pacote foi auditada na versão instalada, em vez de inferida somente da documentação atual. A CLI documenta backlog aproximado e listas separadas de polling por tipo; os exemplos precisam respeitar a versão de CLI já instalada.
