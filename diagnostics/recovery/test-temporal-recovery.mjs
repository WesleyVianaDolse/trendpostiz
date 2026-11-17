// Owned disposable server/DB only. No application startup or production env.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url)), req = createRequire(path.join(root, 'package.json'));
req(path.join(root, 'scripts/recovery/verify-owned-chain.cjs')).verifyOwnedChain();
const candidate = path.join(root, 'libraries/nestjs-libraries/src/database/prisma/baseline-proposal/prisma-owned');
const label = 'recovery-temporal-' + randomUUID(), temp = fs.mkdtempSync(path.join(os.tmpdir(), label + '-'));
const env = Object.fromEntries(['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP'].filter(k => process.env[k]).map(k => [k,process.env[k]]));
const docker = args => { const r = spawnSync('docker', args, { encoding:'utf8',windowsHide:true }); assert.equal(r.status,0,r.stderr || r.error?.message); return r.stdout.trim(); };
let pg, temporal, network;
const pause = ms => new Promise(r => setTimeout(r,ms));
try {
  if (process.env.DOCKER_HOST && !/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST)) throw Error('Remote Docker forbidden');
  assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']), /^(npipe|unix):\/\//);
  network = docker(['network','create','--label','trendpostiz.recovery-temporal='+label,label]);
  pg = docker(['run','--detach','--rm','--name',label+'-pg','--label','trendpostiz.recovery-temporal='+label,'--network',network,'--network-alias','postgres',
    '--publish','127.0.0.1::5432','-e','POSTGRES_USER=guard_test','-e','POSTGRES_PASSWORD=synthetic-only','-e','POSTGRES_DB=guard_test','postgres:17.11']);
  let ready = false;
  for(let n=0;n<60;n++){if(spawnSync('docker',['exec',pg,'pg_isready','-h','127.0.0.1','-U','guard_test'],{stdio:'ignore',windowsHide:true}).status===0){ready=true;break;}await pause(500);}
  assert(ready);
  temporal = docker(['run','--detach','--rm','--name',label+'-temporal','--label','trendpostiz.recovery-temporal='+label,'--network',network,'--network-alias','temporal',
    '--publish','127.0.0.1::7233','-e','DB=postgres12','-e','DB_PORT=5432','-e','POSTGRES_USER=guard_test','-e','POSTGRES_PWD=synthetic-only',
    '-e','POSTGRES_SEEDS=postgres','-e','DEFAULT_NAMESPACE=default','-e','SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES=true',...(process.argv.includes('--linux')?['-e','BIND_ON_IP=0.0.0.0']:[]),'temporalio/auto-setup:1.28.2']);
  ready = false;
  for(let n=0;n<120;n++){if(spawnSync('docker',['exec',temporal,'temporal','--address','temporal:7233','operator','namespace','describe','--namespace','default'],{stdio:'ignore',windowsHide:true}).status===0){ready=true;break;}await pause(500);}
  assert(ready,'Owned Temporal did not become ready');
  const pgAddress=docker(['port',pg,'5432/tcp']),temporalAddress=docker(['port',temporal,'7233/tcp']);
  assert.match(pgAddress,/^127\.0\.0\.1:\d+$/); assert.match(temporalAddress,/^127\.0\.0\.1:\d+$/);
  const url=`postgresql://guard_test:synthetic-only@${pgAddress}/guard_test`;
  fs.copyFileSync(path.join(candidate,'schema.current.prisma'),path.join(temp,'schema.prisma'));
  fs.cpSync(path.join(candidate,'migrations'),path.join(temp,'migrations'),{recursive:true});
  const migrate=spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',path.join(temp,'schema.prisma')],
    {cwd:temp,env:{...env,DATABASE_URL:url},encoding:'utf8',windowsHide:true}); assert.equal(migrate.status,0,migrate.stdout+migrate.stderr);
  console.log('Owned PostgreSQL17.11 and Temporal1.28.2 ready; synthetic data only.');
  const fixture = process.argv.includes('--linux') ? 'linux-candidate-fixture.cjs' : process.argv.includes('--handoff') ? 'handoff-recovery-fixture.cjs' : process.argv.includes('--fg') ? 'fg-recovery-fixture.cjs' : process.argv.includes('--derived') ? 'derived-recovery-fixture.cjs' : 'temporal-recovery-fixture.cjs';
  const child=spawn(process.execPath,[path.join(root,'diagnostics/recovery',fixture),root,url,temporalAddress,...(process.argv.includes('--linux')?[pg,temporal]:[])],{
    cwd:temp,env:{...env,DATABASE_URL:url,STORAGE_PROVIDER:'local',UPLOAD_DIRECTORY:path.join(temp,'uploads'),JWT_SECRET:'synthetic-only'},windowsHide:true,stdio:'inherit'});
  const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});assert.equal(status,0,'Recovery fixtures failed');
} finally {
  for(const container of [temporal,pg].filter(Boolean)){assert.equal(docker(['inspect','--format','{{ index .Config.Labels "trendpostiz.recovery-temporal" }}',container]),label);docker(['rm','--force',container]);}
  if(network){assert.equal(docker(['network','inspect','--format','{{ index .Labels "trendpostiz.recovery-temporal" }}',network]),label);docker(['network','rm',network]);}
}
