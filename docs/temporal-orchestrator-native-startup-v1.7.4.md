# Orchestrator v1.7.4 — investigação de bloqueio síncrono

Auditoria adicional em 13/11/2026, commit `36f4cd9971d5f304b0ab94f373160ea632341ac4`. Complementa `temporal-worker-v1.7.4-diagnosis.md`. Nenhuma operação foi realizada em produção. Nenhum código funcional, provider ou versão do produto foi alterado.

**Resultado principal**

A inicialização real concluiu em Linux com Node 22.20.0, Temporal 1.28.2, PostgreSQL 16, `nestjs-temporal-core` 3.2.3 e SDK Temporal 1.15.0. Foram criados os 32 workers e 32 bundles, o health retornou 200 e o servidor registrou pollers de workflow e activity em `main`. Um workflow com fila de emails vazia produziu `WorkflowTaskStarted` e `WorkflowTaskCompleted`, sem enviar emails ou executar publicações.

O travamento espontâneo de produção **não foi reproduzido**. Logo, ainda não é possível nomear a chamada responsável no PID 165 nem apresentar uma correção causal comprovada para a v1.7.5. `futex_wait_queue`, health recusado e timer sem efeito são compatíveis com bloqueio síncrono, mas não identificam a biblioteca/função que o provoca. Também continua possível que os imports não tenham terminado e o watchdog ainda não tenha sido armado.

**O que os testes demonstraram**

| Caso executado | Resultado observado |
| --- | --- |
| Partida normal com rastreamento | 32 workers, 32 bundles, health 200, pollers reais e Workflow Task concluída. |
| Partida sem preload de diagnóstico | Mesmo resultado; o funcionamento não depende da instrumentação. |
| Sentry habilitado com DSN fictícia | Mesmo resultado, sem credenciais nem tráfego permitido para serviços externos. Não demonstra equivalência com toda configuração de produção. |
| Falha injetada: Promise de `Worker.create(main)` nunca resolve | Event loop continua ativo; watchdog encerra o processo após **120.006 ms** desde o marco de início do Nest, com exit code 1 e mensagem esperada. |
| Falha injetada: bloqueio síncrono antes de `Worker.create(main)` | Thread principal em **`futex_do_wait`**, porta 3002 recusada, zero progresso do event loop após o bloqueio e nenhuma mensagem do watchdog mesmo depois de seu prazo. O controlador externo encerrou somente o container descartável após o limite do teste. |

As duas últimas falhas são deliberadas e identificadas no trace como `injected:*`. Demonstram a diferença entre espera assíncrona e bloqueio síncrono; **não são uma reprodução causal do incidente**. As execuções negativas originalmente encerraram o controlador com código 1 por não haver health; o verificador posterior validou seus resultados esperados. O runner agora também distingue esses casos esperados de falhas inesperadas.

O resultado verificável e hashes dos logs estão em `diagnostics/temporal-startup/latest-results.json`. `verify-results.mjs` validou os cinco casos com assertions sobre logs e históricos reais, sem mocks de Temporal. Os logs completos ficam nos diretórios temporários indicados pelo runner; o JSON versionável não contém ambiente, payloads ou caminhos pessoais.

O build local `pnpm --filter ./apps/orchestrator run build` passou, assim como as verificações de sintaxe dos scripts de diagnóstico. Não houve mudanças funcionais que exigissem builds de frontend/backend. Ao fim da auditoria, todos os containers, redes e os três volumes de dependências descartáveis criados nesta execução foram removidos, com conferência de seus labels; os arquivos temporários de evidências e as imagens de teste permanecem locais.

Na partida normal instrumentada: imports até o início do Nest em 9.254 ms; `NestFactory.create` em 142 ms; conexão nativa em 9 ms; criação sequencial dos 32 workers em 37.884 ms; último worker criado em aproximadamente 47,4 s desde o preload. Com Sentry, os tempos observados foram maiores, mas houve testes concorrentes: esses números não são benchmark comparativo nem prova de causa ligada ao Sentry.

**Pontos capazes de bloquear a inicialização**

| Etapa e código real | Semântica e evidência |
| --- | --- |
| `apps/orchestrator/src/main.ts:1-12` e compilado `main.js` | Imports CommonJS são avaliados antes de `bootstrap()`. Incluem Sentry/profiler nativo, Nest e `AppModule`, que alcança muitos providers. Um bloqueio aqui ocorre antes do timer de 120 s ser armado. |
| `apps/orchestrator/src/main.ts:24-36` | O timer é armado antes de `NestFactory.create` e `app.listen`. Uma Promise pendente, sozinha, não impede seu disparo, conforme o teste de espera assíncrona. |
| `node_modules/nestjs-temporal-core/dist/providers/temporal-connection.factory.js`, `createNewWorkerConnection` | A conexão nativa é criada durante a resolução dos providers do Nest. A função assíncrona pode executar chamadas síncronas antes de devolver o controle. O teste normal concluiu essa etapa. |
| `node_modules/@temporalio/worker/lib/connection.js`, `NativeConnection.connect` | Obtém o runtime e cria o client nativo. TCP acessível não garante sucesso dessa inicialização ou dos RPCs seguintes. |
| `node_modules/@temporalio/worker/lib/runtime.js`, `Runtime.create` | Chama **sincronamente** `native.newRuntime(...)`. No bridge Rust, `runtime_new` chama `CoreRuntime::new` e cria o runtime Tokio. É um ponto nativo relevante para rastrear, mas concluiu em cerca de 1–2 ms no controle normal. |
| `node_modules/nestjs-temporal-core/dist/services/temporal-worker.service.js`, `initializeMultipleWorkers` | Aguarda as 32 criações sequencialmente; nenhum worker é iniciado enquanto essa fase inteira não terminar. O teste normal completou todas. |
| `node_modules/@temporalio/worker/lib/worker.js`, `Worker.create` | Executa compilação de opções, criação do bundle, criação do executor de workflows e registro do worker nativo. O método ser `async` não torna cada operação interna não bloqueante. |
| `node_modules/@temporalio/worker/lib/workflow/bundler.js`, `WorkflowCodeBundler.createBundle` | Webpack usa callback/Promise, mas carregamento de módulos, transformações, leitura e compilação contêm trabalho síncrono. Os 32 bundles concluíram no teste real. Não foi constatada compilação infinita. |
| `node_modules/@temporalio/worker/lib/workflow/threaded-vm.js`, `ThreadedVMWorkflowCreator.create` | No modo normal, o SDK usa worker threads para o executor VM. A criação das VMs pode ser longa; aguardar uma resposta da thread mantém o timer disponível se o event loop principal estiver responsivo. |
| Carregadores nativos e `process.report.getReport` usados por dependências | São operações síncronas adicionais rastreadas pelo preload. Não houve bloqueio espontâneo nesses pontos. Não coletar relatórios/heap de produção para compartilhar: podem incluir ambiente ou dados em memória. |

O watchdog dentro do mesmo event loop não pode interromper uma chamada síncrona que o bloqueia. Mover apenas `setTimeout` para antes de um import também não resolve esse limite. A documentação do [Node sobre timers](https://nodejs.org/api/timers.html) não garante execução exata no prazo; o resultado depende do trabalho em execução no event loop. A [implementação do runtime Temporal 1.15.0](https://github.com/temporalio/sdk-typescript/blob/v1.15.0/packages/worker/src/runtime.ts) e do [executor em threads](https://github.com/temporalio/sdk-typescript/blob/v1.15.0/packages/worker/src/workflow/threaded-vm.ts) foi conferida na versão utilizada.

**Preparação do ambiente isolado**

O harness não usa Compose, PM2 ou `pnpm start`: esses caminhos podem ler `.env` e executar outras operações. Inicia diretamente o Node compilado em containers nomeados e rotulados pelo teste. Os containers da aplicação/Temporal/DB usam uma rede Docker interna, sem saída para APIs externas. Não existem workflows de clientes nesse servidor. O `.env` do checkout não é montado nem lido.

Foram eliminadas diferenças do laboratório antes de interpretar o comportamento: dependências locais Windows continham binários `sharp`/`bcrypt` incompatíveis com Linux, e a imagem Node slim pura não trazia `libssl` para Prisma. Essas falhas encerraram o processo com erro; não explicam a estabilidade do PID de produção. A imagem de teste adiciona OpenSSL, biblioteca também trazida pelo nginx da imagem de produção. A geração de dependências Linux usa o lockfile e snapshots existentes, com scripts de instalação desabilitados. Somente o importer do manifesto descartável é reduzido ao grafo do orchestrator; o lockfile do repositório não muda.

Há limites na equivalência: não foi fornecido o digest da imagem de produção, seu conjunto efetivo de bibliotecas, limites de recursos, extensões `NODE_OPTIONS` nem os últimos logs. O gerado Prisma é o do checkout, com engine Linux correspondente e URL de teste. O teste comprova partida e polling, sem homologar acesso à Meta ou respostas aos clientes.

**Como repetir localmente**

Requer Docker local, dependências do checkout e compilado do orchestrator. Os preparadores recusam Docker remoto via contexto ou `DOCKER_HOST`. A preparação baixa pacotes públicos; somente os containers de preparação têm rede externa. Exemplo PowerShell, sem carregar `.env`:

```powershell
pnpm --filter ./apps/orchestrator run build
docker build --tag trendpostiz-temporal-startup-test:node22.20 diagnostics/temporal-startup
$env:TEMPORAL_DIAG_OVERLAY = node diagnostics/temporal-startup/prepare-linux-overlay.mjs
node diagnostics/temporal-startup/prepare-linux-dependencies.mjs
# Definir com o nome de volume impresso na última linha do preparador:
$env:TEMPORAL_DIAG_DEPENDENCIES_VOLUME = 'temporal-startup-deps-NOME_GERADO'
node diagnostics/temporal-startup/run-local.mjs
node diagnostics/temporal-startup/run-local.mjs --no-trace
node diagnostics/temporal-startup/run-local.mjs --sentry
node diagnostics/temporal-startup/run-local.mjs --async-create-stall
node diagnostics/temporal-startup/run-local.mjs --sync-create-stall
```

Cada partida usa um novo Temporal e banco; containers e rede são removidos após o teste, com conferência de propriedade pelo label. Os volumes de dependências e arquivos temporários de evidência são caches do laboratório, não volumes de produção. O verificador recebe cinco diretórios de evidências, nesta ordem: normal, Sentry, sem trace, falha assíncrona, falha síncrona.

**Próxima evidência necessária em produção — somente leitura**

1. Último marco do orchestrator: ausência de `Starting Nest application` aponta para imports anteriores; `Creating new client connection`/`Worker connection established` delimitam a factory; `Initializing 32 workers` e os últimos `Workflow bundle created`/`Created worker` delimitam a criação. `Routes mapped` não significa porta aberta: `app.listen` só abre a porta depois dos hooks de inicialização.
2. Confirmar a imagem/digest, revisão do compilado, versão efetiva do Node e dos SDKs, `cwd`, `NODE_OPTIONS` sanitizado e presença de instrumentação externa. Não imprimir o valor bruto de `NODE_OPTIONS` se contiver parâmetros sensíveis; informar apenas os nomes de flags/preloads.
3. Conferir o canal de espera da thread principal e das demais threads. Ler `/proc` não identifica símbolos nativos de usuário, mas ajuda a diferenciar thread de event loop de uma thread auxiliar. Nenhum attach, sinal, reset ou relatório de memória é necessário para estas leituras.

Exemplo para terminal Linux no host, sem carregar o aplicativo:

```sh
docker inspect --format '{{.Image}} memory={{.HostConfig.Memory}} nanoCpus={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}} cpuset={{.HostConfig.CpusetCpus}}' postiz
docker exec -i postiz node <<'NODE'
const fs = require('node:fs');
const pid = 165; // conferir se continua sendo o Node correto
for (const tid of fs.readdirSync(`/proc/${pid}/task`)) {
  try { console.log(JSON.stringify({tid, wchan:fs.readFileSync(`/proc/${pid}/task/${tid}/wchan`,'utf8').trim()})); }
  catch (e) { console.log(JSON.stringify({tid,error:e.code})); }
}
const maps = fs.readFileSync(`/proc/${pid}/maps`,'utf8');
const libraries = new Set(maps.split('\n').map(l=>l.split(/\s+/).at(-1)).filter(p=>
  p && (/\.node$/.test(p) || /libssl\.so/.test(p))));
console.log(JSON.stringify({loadedLibraries:[...libraries]}));
NODE
```

Essas bibliotecas carregadas não provam qual chamada está esperando. Não usar `kill -USR1`/`USR2`, profiler, core dump ou attach em produção nesta fase. Se os marcos não bastarem, repetir **a imagem exata por digest** em laboratório, com banco/Temporal descartáveis, variáveis sintéticas e arquivos `.env` mascarados. O Dockerfile atual não exclui explicitamente `.env` do contexto: uma cópia da imagem real deve ser tratada como potencialmente sensível. Não executar seu entrypoint padrão ou exportar artefatos sem revisão. O preload permite localizar o último `begin` sem `end` e então coletar uma stack nativa apenas no laboratório.

**Proposta para v1.7.5**

A correção causal permanece condicionada à chamada identificada. O resultado atual não justifica trocar SDK, desabilitar Sentry, reduzir filas, aumentar timeout, remover validações ou modificar o Private Reply.

O defeito de cobertura do watchdog está comprovado pelos testes: ele depende do event loop supervisionado e é instalado após os imports. A proteção mínima proposta é supervisão de inicialização em **outro processo**, iniciada antes do carregamento do aplicativo, com marcos de etapa e indicação explícita de readiness pelo filho. Esse supervisor detectaria a falta de progresso mesmo com o filho preso em operação síncrona. É uma contenção verificável, não a remoção da causa nativa; não foi implementada nem deve ser usada para restabelecer as filas pendentes sem o plano de retenção anterior.

Para aceitar a correção causal, exigir: o mesmo caso de laboratório falha antes e passa depois; conexão nativa, 32 workers/bundles, polls remotos e Workflow Task concluída; os testes de espera assíncrona e bloqueio síncrono distinguem seus resultados; o processo não informa readiness antecipadamente. Preservar o endpoint Page `/messages`, a reserva de Direct e os estados separados de resposta pública/privada. A homologação Meta e de publicação fica para a janela autorizada, com comentários novos e sem reenvio do backlog.

**Arquivos desta investigação**

- `diagnostics/temporal-startup/Dockerfile`: imagem local de teste.
- `prepare-linux-dependencies.mjs`: dependências Linux com snapshots do lockfile.
- `prepare-linux-overlay.mjs`: binários de teste e engine Prisma correspondente.
- `trace-startup.cjs`: preload de diagnóstico, ausente do entrypoint de produção.
- `run-local.mjs`: isolamento, bootstrap real, polling/histórico e falhas controladas.
- `verify-results.mjs` e `latest-results.json`: verificação dos cinco casos e evidências sanitizadas.
- Este relatório; nenhuma alteração no código funcional.
