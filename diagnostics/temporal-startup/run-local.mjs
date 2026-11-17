// Local disposable reproduction. Does not read .env, copy client credentials,
// run production entrypoints/Compose, or contact a configured Temporal server.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const id = `temporal-startup-${randomUUID()}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), id + '-'));
const resources = [];
const run = (args, options = {}) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error || result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.error?.message || result.stdout}`);
  return (args[0] === 'logs' ? result.stdout + result.stderr : result.stdout).trim();
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bind = (source, target, readonly = true) => ['--mount', `type=bind,source=${source},target=${target}${readonly ? ',readonly' : ''}`];
const ownedContainer = args => {
  let container;
  try { container = run(['run', '--detach', '--label', `trendpostiz.startup-test=${id}`, ...args]); }
  catch (error) {
    const name = args[args.indexOf('--name') + 1];
    const probe = spawnSync('docker', ['inspect', '--format', '{{.Id}} {{ index .Config.Labels "trendpostiz.startup-test" }}', name], { encoding: 'utf8', windowsHide: true });
    const [created, owner] = (probe.stdout || '').trim().split(' ');
    if (/^[a-f0-9]{64}$/.test(created) && owner === id) resources.push({ type: 'container', value: created });
    throw error;
  }
  if (!/^[a-f0-9]{64}$/.test(container)) throw new Error('Invalid container identity');
  resources.push({ type: 'container', value: container });
  return container;
};

try {
  if(process.env.DOCKER_HOST && !/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST)) throw new Error('Remote DOCKER_HOST is forbidden');
  const endpoint = run(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  if (!endpoint.startsWith('npipe://') && !endpoint.startsWith('unix://')) throw new Error('Only local Docker is allowed');
  console.log(JSON.stringify({ id, artifacts: dir }));
  const importOnly = process.argv.includes('--import-only');
  const withoutTrace = process.argv.includes('--no-trace');
  const overlay = process.env.TEMPORAL_DIAG_OVERLAY;
  if (!overlay || !fs.existsSync(path.join(overlay, 'manifest.json'))) throw new Error('Prepare a Linux test overlay and set TEMPORAL_DIAG_OVERLAY');
  const dependenciesVolume = process.env.TEMPORAL_DIAG_DEPENDENCIES_VOLUME;
  if (dependenciesVolume && run(['volume','inspect','--format','{{ index .Labels "trendpostiz.startup-cache" }}',dependenciesVolume]) !== dependenciesVolume)
    throw new Error('Dependencies volume must belong to the disposable test setup');
  const network = id;
  run(['network', 'create', '--internal', '--label', `trendpostiz.startup-test=${id}`, network]);
  resources.push({ type: 'network', value: network });
  if (!importOnly) {
    const pg = ownedContainer(['--name', id + '-pg', '--network', network, '--network-alias', 'postgres',
      '-e', 'POSTGRES_USER=diag', '-e', 'POSTGRES_PASSWORD=local-test-only', '-e', 'POSTGRES_DB=diag', 'postgres:16-alpine']);
    let ready = false;
    for (let n = 0; n < 50; n++) {
      const result = spawnSync('docker', ['exec', pg, 'pg_isready', '-U', 'diag', '-d', 'diag'], { windowsHide: true, stdio: 'ignore' });
      if (result.status === 0) { ready = true; break; }
      await sleep(500);
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
    const temporal = ownedContainer(['--name', id + '-temporal', '--network', network, '--network-alias', 'temporal',
      '-e', 'DB=postgres12', '-e', 'DB_PORT=5432', '-e', 'POSTGRES_USER=diag', '-e', 'POSTGRES_PWD=local-test-only',
      '-e', 'POSTGRES_SEEDS=postgres', '-e', 'DEFAULT_NAMESPACE=default', '-e', 'SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES=true', 'temporalio/auto-setup:1.28.2']);
    ready = false;
    for (let n = 0; n < 80; n++) {
      const result = spawnSync('docker', ['exec', temporal, 'temporal', '--address', 'temporal:7233', 'operator', 'namespace', 'describe', '--namespace', 'default'], { windowsHide: true, stdio: 'ignore' });
      if (result.status === 0) { ready = true; break; }
      await sleep(500);
    }
    fs.writeFileSync(path.join(dir, 'temporal.log'), run(['logs', temporal]));
    if (!ready) throw new Error('Disposable Temporal did not become ready');
    console.log('Disposable Temporal 1.28.2 is ready; queues contain no client workflows.');
  }
  const args = ['--name', id + '-app', '--network', network, '--memory', '4g', '--cpus', '4', '--workdir', '/app/apps/orchestrator',
    ...(dependenciesVolume ? ['--mount',`type=volume,source=${dependenciesVolume},target=/app,readonly`, ...bind(path.join(root,'node_modules/.prisma/client'),'/app/node_modules/.prisma/client')] : bind(path.join(root, 'node_modules'), '/app/node_modules')),
    ...bind(overlay, '/test-overlay'),
    ...bind(path.join(overlay, 'napi-v3/bcrypt_lib.node'), '/app/node_modules/bcrypt/lib/binding/napi-v3/bcrypt_lib.node'),
    ...bind(path.join(root, 'package.json'), '/app/package.json'),
    ...bind(path.join(root, 'apps/orchestrator/dist'), '/app/apps/orchestrator/dist'),
    ...bind(path.join(root, 'diagnostics/temporal-startup'), '/probe'),
    ...bind(dir, '/artifacts', false),
    '-e', 'NODE_ENV=production', '-e', 'TEMPORAL_DIAG_TRACE=/tmp/trace.jsonl',
    '-e', 'TEMPORAL_ADDRESS=temporal:7233', '-e', 'TEMPORAL_NAMESPACE=default',
    '-e', 'DATABASE_URL=postgresql://diag:local-test-only@postgres:5432/diag',
    '-e', 'PRISMA_QUERY_ENGINE_LIBRARY=/test-overlay/libquery_engine.so.node', '-e', 'NODE_PATH=/test-overlay/node_modules',
    '-e', 'STORAGE_PROVIDER=local', '-e', 'UPLOAD_DIRECTORY=/tmp/diag-uploads',
    '-e', 'JWT_SECRET=isolated-test-only',
    ...(process.argv.includes('--async-create-stall') ? ['-e','TEMPORAL_DIAG_FAULT=async-create'] : []),
    ...(process.argv.includes('--sync-create-stall') ? ['-e','TEMPORAL_DIAG_FAULT=sync-create'] : []),
    ...(process.argv.includes('--sentry') ? ['-e','NEXT_PUBLIC_SENTRY_DSN=https://public@sentry.invalid/1'] : []),
    'trendpostiz-temporal-startup-test:node22.20', 'node', '--experimental-require-module'];
  if (!withoutTrace) args.push('--require', '/probe/trace-startup.cjs');
  if (importOnly) args.push('-e', "require('./dist/apps/orchestrator/src/app.module.js');console.log('APP_MODULE_IMPORTED');process.exit(0)");
  else args.push('./dist/apps/orchestrator/src/main.js');
  const app = ownedContainer(args);
  let state;
  let healthy = false;
  for (let n = 0; n < 90; n++) {
    await sleep(2000);
    state = JSON.parse(run(['inspect', '--format', '{{json .State}}', app]));
    if (!state.Running) break;
    if (n % 10 === 0) {
      const tail = withoutTrace ? '' : run(['exec', app, 'tail', '-n', '1', '/tmp/trace.jsonl']);
      console.log(JSON.stringify({ seconds: (n+1)*2, lastTrace: tail }));
    }
    if (n > 0 && n % 5 === 0) {
      const probe = spawnSync('docker', ['exec', app, 'node', '-e', "const f=require('node:fs');console.log('wchan='+f.readFileSync('/proc/1/wchan','utf8'));fetch('http://127.0.0.1:3002/health/status',{signal:AbortSignal.timeout(2000)}).then(async r=>console.log(r.status,await r.text())).catch(e=>console.log(e.cause?.code||e.message))"], {encoding:'utf8',windowsHide:true,timeout:5000});
      fs.writeFileSync(path.join(dir, `health-${n}.log`), probe.stdout || probe.stderr || 'probe timeout');
      if (probe.stdout?.includes('200 {')) {
        healthy = true;
        const script = `(async()=>{
          const {Connection,Client}=require('@temporalio/client');
          const connection=await Connection.connect({address:'temporal:7233'});
          try {
            const client=new Client({connection,namespace:'default'});
            const pollers={};
            for(const [kind,taskQueueType] of [['workflow',1],['activity',2]]){
              const result=await connection.workflowService.describeTaskQueue({namespace:'default',taskQueue:{name:'main'},taskQueueType});
              pollers[kind]=result.pollers?.length||0;
            }
            if(!pollers.workflow||!pollers.activity)throw Error('Missing actual server pollers: '+JSON.stringify(pollers));
            const handle=await client.workflow.start('sendEmailWorkflow',{workflowId:'isolated-startup-empty-queue',taskQueue:'main',args:[{queue:[]}]});
            let types=[],workflowTaskStarted=false,workflowTaskCompleted=false;
            for(let n=0;n<20;n++){const h=await handle.fetchHistory();types=h.events.map(e=>e.eventType);workflowTaskStarted=h.events.some(e=>e.workflowTaskStartedEventAttributes);workflowTaskCompleted=h.events.some(e=>e.workflowTaskCompletedEventAttributes);if(workflowTaskStarted&&workflowTaskCompleted)break;await new Promise(r=>setTimeout(r,250));}
            console.log(JSON.stringify({pollers,eventTypes:types,workflowTaskStarted,workflowTaskCompleted}));
            if(!workflowTaskStarted||!workflowTaskCompleted)throw Error('No completed Workflow Task in isolated probe');
          } finally {await connection.close();}
        })().catch(e=>{console.error(e.message);process.exitCode=1});`;
        const evidence=spawnSync('docker',['exec',app,'node','-e',script],{encoding:'utf8',windowsHide:true,timeout:30000});
        fs.writeFileSync(path.join(dir,'server-probe.json'),evidence.stdout||evidence.stderr||'probe timed out');
        if(evidence.status!==0)throw new Error('Actual server polling/history probe failed: '+(evidence.stderr||evidence.stdout));
        console.log('Healthy startup with actual server pollers and completed Workflow Task:',evidence.stdout.trim());
        break;
      }
    }
  }
  const logs = run(['logs', app]);
  if (!withoutTrace) run(['cp', app + ':/tmp/trace.jsonl', path.join(dir, 'trace.jsonl')]);
  fs.writeFileSync(path.join(dir, 'app.log'), logs);
  const asyncFault = process.argv.includes('--async-create-stall');
  const syncFault = process.argv.includes('--sync-create-stall');
  const trace = !withoutTrace ? fs.readFileSync(path.join(dir,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.threadId===0) : [];
  const stalledHealth = fs.readdirSync(dir).filter(p=>/^health-.*\.log$/.test(p)).map(p=>fs.readFileSync(path.join(dir,p),'utf8'));
  const expectedFailureObserved = asyncFault
    ? state?.ExitCode===1 && logs.includes('Startup did not finish within 120 seconds.')
    : syncFault
    ? state?.Running===true && trace.some(r=>r.event==='injected:sync-create-stall') && stalledHealth.some(s=>s.includes('futex')&&s.includes('ECONNREFUSED')) && !logs.includes('Startup did not finish within 120 seconds.')
    : undefined;
  const result = { mode:asyncFault?'async-create-stall':syncFault?'sync-create-stall':process.argv.includes('--sentry')?'sentry':withoutTrace?'untraced':'normal',
    healthy, expectedFailureObserved, running:state?.Running, exitCode:state?.ExitCode, oomKilled:state?.OOMKilled,
    phases:trace.filter(r=>!r.event.startsWith('require:')&&!r.event.startsWith('event-loop:')), artifacts:dir };
  fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,phases:undefined,logTail:logs.slice(-1800)}));
  if (state?.Running && !healthy) console.log('External diagnostic deadline reached. Only this owned disposable process will be stopped.');
  if ((asyncFault||syncFault) ? !expectedFailureObserved : ((!importOnly && !healthy) || (importOnly && state?.ExitCode !== 0))) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  for (const resource of resources.reverse()) {
    const owner = run([resource.type === 'container' ? 'inspect' : 'network', ...(resource.type === 'container' ? [] : ['inspect']), '--format', '{{ index .Labels "trendpostiz.startup-test" }}', resource.value].map((arg, i) => resource.type === 'container' && arg.includes('.Labels') ? '{{ index .Config.Labels "trendpostiz.startup-test" }}' : arg));
    if (owner !== id) throw new Error('Refusing to remove a resource not owned by this run');
    run(resource.type === 'container' ? ['rm', '--force', resource.value] : ['network', 'rm', resource.value]);
  }
  console.log('Removed only disposable resources owned by this run.');
}
