// Phase B only. Never reads .env, contacts configured databases, or starts workers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const req=createRequire(path.join(root,'package.json'));
const {Client}=req('pg');
const label='recovery-foundation-'+randomUUID();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),label+'-'));
const results=[];
const clients=[];
let container,network;
const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const docker=args=>{
  const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});
  if(r.status!==0)throw new Error(r.stderr||r.error?.message);
  return r.stdout.trim();
};
const prisma=(args,url)=>spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),...args],{
  cwd:dir,env:{...env,DATABASE_URL:url||'postgresql://test:test@127.0.0.1:1/test'},encoding:'utf8',windowsHide:true});
const migrationName='20261114000000_safe_recovery_foundation';
const baselineRevision='36f4cd9971d5f304b0ab94f373160ea632341ac4';
const schemaRoot=path.join(root,'libraries/nestjs-libraries/src/database/prisma');
const connect=async url=>{const c=new Client({connectionString:url});await c.connect();clients.push(c);return c};
const test=async(name,fn)=>{await fn();results.push({name,result:'PASS'});console.log('PASS',name)};
try {
  if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))throw Error('Remote Docker forbidden');
  assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^(npipe|unix):\/\//);
  const oldSchema=execFileSync('git',['show',baselineRevision+':libraries/nestjs-libraries/src/database/prisma/schema.prisma'],{cwd:root,encoding:'utf8',windowsHide:true});
  fs.writeFileSync(path.join(dir,'before.prisma'),oldSchema);
  fs.copyFileSync(path.join(schemaRoot,'schema.prisma'),path.join(dir,'schema.prisma'));
  fs.cpSync(path.join(schemaRoot,'migrations'),path.join(dir,'migrations'),{recursive:true});
  const initial=prisma(['migrate','diff','--from-empty','--to-schema-datamodel',path.join(dir,'before.prisma'),'--script']);
  assert.equal(initial.status,0,initial.stderr);
  const sql=fs.readFileSync(path.join(schemaRoot,'migrations',migrationName,'migration.sql'),'utf8');
  assert(!/\b(DROP|TRUNCATE|DELETE|RENAME)\b/i.test(sql));
  // Schema-only test: PostgreSQL is exposed exclusively on loopback. No app,
  // Temporal worker, provider SDK or external HTTP client is instantiated.
  network=docker(['network','create','--label','trendpostiz.recovery-test='+label,label]);
  container=docker(['run','--detach','--rm','--name',label,'--label','trendpostiz.recovery-test='+label,
    '--network',network,'--publish','127.0.0.1::5432','-e','POSTGRES_USER=recovery_test',
    '-e','POSTGRES_PASSWORD=synthetic-only','-e','POSTGRES_DB=foundation','postgres:16-alpine']);
  for(let i=0;i<50;i++){
    const r=spawnSync('docker',['exec',container,'pg_isready','-U','recovery_test'],{windowsHide:true,stdio:'ignore'});
    if(r.status===0)break;
    await new Promise(r=>setTimeout(r,300));
  }
  const address=docker(['port',container,'5432/tcp']);assert.match(address,/^127\.0\.0\.1:\d+$/);
  const url=name=>`postgresql://recovery_test:synthetic-only@${address}/${name}`;
  const db=await connect(url('foundation'));
  await db.query('CREATE DATABASE chain_empty');
  await db.query(initial.stdout);
  const fixture=`
    INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('org-test','Synthetic organization',CURRENT_TIMESTAMP);
    INSERT INTO "Integration" (id,"internalId","organizationId",name,"providerIdentifier",type,token)
    VALUES ('integration-test','synthetic-ig','org-test','Synthetic IG','instagram','social','synthetic-only');
    INSERT INTO "Post" (id,"organizationId","integrationId",content,"group","publishDate","updatedAt",state,"releaseId","releaseURL","intervalInDays")
    VALUES ('expired','org-test','integration-test','Synthetic','expired-group','2026-01-01',CURRENT_TIMESTAMP,'QUEUE',NULL,NULL,NULL),
           ('future','org-test','integration-test','Synthetic','future-group','2030-01-01',CURRENT_TIMESTAMP,'QUEUE',NULL,NULL,NULL),
           ('series','org-test','integration-test','Synthetic','series-group','2026-01-01',CURRENT_TIMESTAMP,'PUBLISHED','confirmed-test','https://example.invalid/confirmed',1);
    INSERT INTO "InstagramWebhookEvent" (id,"instagramAccountId",payload,status,"receivedAt")
    VALUES ('old-event','synthetic-ig','{}','REPLIED','2026-01-01');`;
  await db.query(fixture);
  const snapshot=async()=>({posts:(await db.query('SELECT id,state,"publishDate","releaseId","releaseURL","intervalInDays" FROM "Post" ORDER BY id')).rows,
    events:(await db.query('SELECT id,status,"receivedAt",payload FROM "InstagramWebhookEvent" ORDER BY id')).rows});
  const before=await snapshot();
  await test('B01 additive upgrade preserves existing posts, future schedule, recurrence receipt and webhook history',async()=>{
    await db.query(sql);assert.deepEqual(await snapshot(),before);
    assert((await db.query('SELECT "scheduleRevision" FROM "Post"')).rows.every(r=>r.scheduleRevision===0));
    assert.equal((await db.query('SELECT "occurredAt" FROM "InstagramWebhookEvent"')).rows[0].occurredAt,null);
  });
  await test('B02 migration creates only a closed control without cutoff or authorization',async()=>{
    const c=(await db.query('SELECT * FROM "AutomationRecoveryControl"')).rows;
    assert.equal(c.length,1);assert.equal(c[0].phase,'BLOCKED');assert.equal(c[0].runId,null);
    assert.equal((await db.query('SELECT count(*) FROM "AutomationRecoveryRun"')).rows[0].count,'0');
  });
  await test('B03 closed control persists across independent connections',async()=>{
    const reopened=await connect(url('foundation'));
    assert.equal((await reopened.query('SELECT phase FROM "AutomationRecoveryControl" WHERE id=\'global\'')).rows[0].phase,'BLOCKED');
  });
  await test('B04 occurrence uniqueness rejects concurrent duplicate slots',async()=>{
    const other=await connect(url('foundation'));
    const insert='INSERT INTO "PublicationOccurrence" (id,"organizationId","postId","scheduleRevision","scheduledAt","groupSnapshot","updatedAt") VALUES ($1,\'org-test\',\'future\',0,\'2030-01-01\',\'future-group\',CURRENT_TIMESTAMP)';
    const attempts=await Promise.allSettled([db.query(insert,['occ-1']),other.query(insert,['occ-2'])]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(attempts.filter(r=>r.status==='rejected'&&r.reason.code==='23505').length,1);
  });
  await test('B05 evidence storage does not replace automatic failure or confirmed post receipt',async()=>{
    await db.query('INSERT INTO "PublicationOccurrence" (id,"organizationId","postId","scheduleRevision","scheduledAt","groupSnapshot",outcome,"failureReason","updatedAt") VALUES (\'expired-occ\',\'org-test\',\'expired\',0,\'2026-01-01\',\'expired-group\',\'ERROR\',\'EXPIRED_RECOVERY\',CURRENT_TIMESTAMP)');
    await db.query('INSERT INTO "PublicationEvidence" (id,"organizationId","occurrenceId",origin,"remoteUrl","confirmedById") VALUES (\'proof-test\',\'org-test\',\'expired-occ\',\'manual\',\'https://example.invalid/manual\',\'synthetic-actor\')');
    assert.equal((await db.query('SELECT outcome FROM "PublicationOccurrence" WHERE id=\'expired-occ\'')).rows[0].outcome,'ERROR');
    assert.deepEqual(await snapshot(),before);
  });
  await test('B06 upgraded schema matches the reviewed Prisma model',async()=>{
    const r=prisma(['migrate','diff','--from-url',url('foundation'),'--to-schema-datamodel',path.join(dir,'schema.prisma'),'--exit-code']);
    assert.equal(r.status,0,r.stderr||r.stdout);
  });
  await test('B07 existing migration chain cannot initialize a fresh database (confirmed blocker)',async()=>{
    const r=prisma(['migrate','deploy','--schema',path.join(dir,'schema.prisma')],url('chain_empty'));
    assert.notEqual(r.status,0);assert(/P3018/.test(r.stderr+r.stdout));assert(/Integration/.test(r.stderr+r.stdout));
    fs.writeFileSync(path.join(dir,'fresh-chain-error.log'),r.stdout+r.stderr);
  });
  await test('B08 automatic migration adoption of an untracked populated database is rejected (confirmed blocker)',async()=>{
    // A second database with the exact previous full schema, not invented migration history.
    await db.query('CREATE DATABASE adoption_probe');
    const populated=await connect(url('adoption_probe'));await populated.query(initial.stdout);
    const r=prisma(['migrate','deploy','--schema',path.join(dir,'schema.prisma')],url('adoption_probe'));
    assert.notEqual(r.status,0);assert(/P3005/.test(r.stderr+r.stdout));
    fs.writeFileSync(path.join(dir,'adoption-error.log'),r.stdout+r.stderr);
  });
  await test('B09 additive migration rolls back atomically on injected DDL failure',async()=>{
    await db.query('CREATE DATABASE rollback_probe');
    const rollback=await connect(url('rollback_probe'));await rollback.query(initial.stdout);await rollback.query(fixture);
    await assert.rejects(rollback.query(sql.replace(/COMMIT;\s*$/,'SELECT recovery_injected_failure(); COMMIT;')));
    await rollback.query('ROLLBACK');
    assert.equal((await rollback.query('SELECT to_regclass(\'"AutomationRecoveryControl"\') AS table_name')).rows[0].table_name,null);
    assert.equal((await rollback.query('SELECT count(*) FROM "Post"')).rows[0].count,'3');
    assert.equal((await rollback.query('SELECT "releaseId" FROM "Post" WHERE id=\'series\'')).rows[0].releaseId,'confirmed-test');
  });
  await test('B10 incomplete release refuses startup before application or environment loading',async()=>{
    const r=spawnSync(process.execPath,[path.join(root,'scripts/recovery/preflight.cjs')],{cwd:dir,env,encoding:'utf8',windowsHide:true});
    assert.equal(r.status,78);assert.match(r.stderr,/RECOVERY_IMPLEMENTATION_INCOMPLETE/);
    assert(!r.stdout.includes('Environment variables loaded'));
  });
  const report={phase:'B',status:'BLOCKED',blocker:'Existing migration history has no initial baseline. No production history/schema was consulted or adopted.',
    baselineCommit:baselineRevision,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),results,
    recoveryScenarios:Array.from({length:31},(_,i)=>({id:'R'+String(i+1).padStart(2,'0'),result:'BLOCKED',reason:'Phase B migration baseline must be reconciled before phases C-G.'}))};
  fs.writeFileSync(new URL('./foundation-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,tests:results.length,artifacts:dir}));
}finally{
  await Promise.allSettled(clients.map(c=>c.end()));
  if(container){assert.equal(docker(['inspect','--format','{{ index .Config.Labels "trendpostiz.recovery-test" }}',container]),label);docker(['rm','--force',container]);}
  if(network){assert.equal(docker(['network','inspect','--format','{{ index .Labels "trendpostiz.recovery-test" }}',network]),label);docker(['network','rm',network]);}
}
