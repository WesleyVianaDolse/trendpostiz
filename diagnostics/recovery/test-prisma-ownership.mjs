// Builds a NEW candidate; leaves the old whole-schema proposal/audits intact.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { spawnSync,execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sections,hashQuery } from './baseline-metadata.mjs';
import { diagnosticSettings } from './baseline-diagnostics.mjs';
import { migrationSchema,ownedHashQuery,ownedMetadataSql,boundaryQuery } from './prisma-ownership.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const req=createRequire(path.join(root,'package.json'));
const {Client}=req('pg'),storage=req('@mastra/core/storage');
const schemaRoot=path.join(root,'libraries/nestjs-libraries/src/database/prisma');
const proposal=path.join(schemaRoot,'baseline-proposal'),target=path.join(proposal,'prisma-owned');
const audit=path.join(root,'diagnostics/recovery/baseline-audit');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'trendpostiz-ownership-'));
const revision='36f4cd9971d5f304b0ab94f373160ea632341ac4';
const baselineName='00000000000000_v1_7_4_prisma_owned',nextName='20261114000000_safe_recovery_foundation';
const runtimePath=path.join(schemaRoot,'schema.prisma'),runtime=fs.readFileSync(runtimePath,'utf8');
const source=fs.readFileSync(path.join(proposal,'schema.reconciled.prisma'),'utf8');
const sha=x=>createHash('sha256').update(x).digest('hex');
const oldBaselinePath=path.join(proposal,'00000000000000_v1_7_4_baseline/migration.sql');
const oldBaselineHash=sha(fs.readFileSync(oldBaselinePath));
const oldAuditHash=sha(fs.readFileSync(path.join(audit,'production-check.sql')));
const externalModels=[...source.matchAll(/^model (mastra_\w+) \{/gm)].map(m=>m[1]).sort();
const sdkTableNames=Object.entries(storage).filter(([k,v])=>k.startsWith('TABLE_')&&typeof v==='string'&&v.startsWith('mastra_')).map(([,v])=>v);
// Explicit legacy archive created by AgentsPG.migrateLegacyTable(), not a prefix wildcard.
const sdkArchiveNames=[storage.TABLE_AGENTS+'_legacy'];
const externalTables=[...new Set([...externalModels,...sdkTableNames,...sdkArchiveNames])].sort();
const baselineSchema=migrationSchema(source,externalModels),currentSchema=migrationSchema(runtime,externalModels);
const modelNames=s=>[...s.matchAll(/^model (\w+) \{/gm)].map(m=>m[1]).sort();
assert(!/@@map\(/.test(baselineSchema),'Review explicit model-table mappings before generation');
const policy={status:'LOCAL_PROPOSAL',schema:'public',ddlOwners:{
  prisma:'Only models in schema.baseline.prisma/schema.current.prisma in this candidate; additive recovery migration.',
  mastra:'Known tables from locked @mastra/core/storage constants plus legacy runtime client models; attached objects and verified timestamp routine.',
  runtimeClient:'schema.prisma retains Mastra DML models; that file is never a shared-schema DDL target.',
},versions:{prisma:req('prisma/package.json').version,mastraPg:req('@mastra/pg/package.json').version,
 mastraCore:JSON.parse(fs.readFileSync(path.join(root,'node_modules/@mastra/core/package.json'),'utf8')).version},
 externalModels,externalTables,managedBaselineTables:modelNames(baselineSchema),managedCurrentTables:modelNames(currentSchema),
 externalTableProvenance:{sdkConstants:[...new Set(sdkTableNames)].sort(),legacyRuntimeModels:externalModels,sdkMigrationArchives:sdkArchiveNames},
 unknownMastraNames:'BLOCK_REVIEW_REQUIRED; no blanket prefix exclusion',
 timestampRoutine:{schema:'public',name:'trigger_set_timestamps',arguments:[],returns:'trigger',owner:'@mastra/pg; verify definition hash and attachment boundary'},
};
assert.equal(policy.versions.prisma,'6.5.0');assert.equal(policy.versions.mastraPg,'1.8.5');assert.equal(externalModels.length,8);
const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const cli=(args,url)=>spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),...args],{
 cwd:temp,env:{...env,DATABASE_URL:url||'postgresql://synthetic:test@127.0.0.1:1/test'},encoding:'utf8',windowsHide:true});
const ok=r=>{assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout};
const docker=args=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.error?.message);return r.stdout.trim()};
const results=[],clients=[],connectionErrors=[],label='prisma-ownership-'+randomUUID();let network,container,sdkExternalTables;
const connect=async(url)=>{assert.equal(new URL(url).hostname,'127.0.0.1');const c=new Client({connectionString:url,ssl:false});c.on('error',e=>connectionErrors.push(e.message));await c.connect();clients.push(c);return c};
const test=async(name,fn)=>{await fn();results.push({name,result:'PASS'});console.log('PASS',name)};
const hashes=async(c,owned=false)=>{const result={};for(const s of Object.keys(sections))result[s]=(await c.query(owned?ownedHashQuery(s,policy):hashQuery(s))).rows[0].digest;return result};
const prepare=async c=>c.query(diagnosticSettings.replaceAll('SET LOCAL','SET'));
const select=r=>r.find(x=>x.fields?.length).rows;
const body=s=>s.replace(/^BEGIN TRANSACTION[^;]+;/m,'').replace(/ROLLBACK;\s*$/,'');
const mutate=async(c,ddl,fn)=>{await c.query('BEGIN');try{await c.query(ddl);await fn()}finally{await c.query('ROLLBACK')}};
try{
 if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))throw Error('Remote Docker forbidden');
 assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^(npipe|unix):\/\//);
 fs.mkdirSync(target,{recursive:true});
 fs.writeFileSync(path.join(target,'schema.baseline.prisma'),baselineSchema);fs.writeFileSync(path.join(target,'schema.current.prisma'),currentSchema);
 // Use a sanitized temp cwd and temp schema paths to avoid repository .env.
 fs.writeFileSync(path.join(temp,'baseline.prisma'),baselineSchema);fs.writeFileSync(path.join(temp,'schema.prisma'),currentSchema);
 const baselineSql=ok(cli(['migrate','diff','--from-empty','--to-schema-datamodel',path.join(temp,'baseline.prisma'),'--script']));
 const nextSql=fs.readFileSync(path.join(schemaRoot,'migrations',nextName,'migration.sql'),'utf8');
 const additiveMigrations=fs.readdirSync(path.join(schemaRoot,'migrations')).filter(name=>name>=nextName).sort()
  .map(name=>({name,sql:fs.readFileSync(path.join(schemaRoot,'migrations',name,'migration.sql'),'utf8')}));
 for(const [name,sql] of [[baselineName,baselineSql],...additiveMigrations.map(m=>[m.name,m.sql])]){
  assert(!/mastra_|trigger_set_timestamps/i.test(sql),'Candidate migration references external objects');
  for(const base of [target,temp]){fs.mkdirSync(path.join(base,'migrations',name),{recursive:true});fs.writeFileSync(path.join(base,'migrations',name,'migration.sql'),sql)}
 }
 for(const base of [target,temp])fs.writeFileSync(path.join(base,'migrations/migration_lock.toml'),'provider = "postgresql"\n');
 await test('O01 migration/client schemas are separated; all eight external client models remain intact',async()=>{
  ok(cli(['validate','--schema',path.join(temp,'baseline.prisma')]));ok(cli(['validate','--schema',path.join(temp,'schema.prisma')]));
  assert.equal(modelNames(baselineSchema).length,46);assert.equal(modelNames(currentSchema).length,modelNames(runtime).length-externalModels.length);
  assert.equal((runtime.match(/^model mastra_/gm)||[]).length,8);
  assert(fs.readFileSync(oldBaselinePath,'utf8').includes('CREATE TABLE "mastra_ai_spans"'),'@@ignore did not exclude DDL in old candidate');
  const dmmf=req('@prisma/client').Prisma.dmmf.datamodel.models;
  for(const name of ['mastra_threads','mastra_messages','mastra_resources','mastra_scorers','mastra_traces','mastra_workflow_snapshot'])assert(dmmf.some(m=>m.name===name));
 });
 const historical=fs.readdirSync(path.join(schemaRoot,'migrations')).filter(n=>n<nextName).sort().map(name=>{
  const sql=execFileSync('git',['show',revision+':libraries/nestjs-libraries/src/database/prisma/migrations/'+name+'/migration.sql'],{cwd:root,encoding:'utf8',windowsHide:true});
  const current=fs.readFileSync(path.join(schemaRoot,'migrations',name,'migration.sql'),'utf8');
  assert.equal(current.replaceAll('\r\n','\n'),sql.replaceAll('\r\n','\n'));assert(!/mastra_|trigger_set_timestamps/i.test(sql));return {name,sha256:sha(sql)};
 });
 await test('O02 six historical migrations and recovery foundation contain no direct external dependencies',async()=>{
  assert.equal(historical.length,6);assert(!/mastra_|trigger_set_timestamps/i.test(nextSql));
 });
 network=docker(['network','create','--label','trendpostiz.ownership='+label,label]);
 container=docker(['run','--detach','--rm','--name',label,'--label','trendpostiz.ownership='+label,'--network',network,
  '--publish','127.0.0.1::5432','-e','POSTGRES_USER=baseline_test','-e','POSTGRES_PASSWORD=synthetic-only','-e','POSTGRES_DB=reference','postgres:17.11']);
 let ready=false;for(let n=0;n<60;n++){if(spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','baseline_test'],{stdio:'ignore',windowsHide:true}).status===0){ready=true;break}await new Promise(r=>setTimeout(r,300))}assert(ready);
 const address=docker(['port',container,'5432/tcp']);assert.match(address,/^127\.0\.0\.1:\d+$/);
 const url=(db,user='baseline_test',pass='synthetic-only')=>`postgresql://${user}:${pass}@${address}/${db}`;
 const ref=await connect(url('reference'));assert.equal((await ref.query("SELECT current_setting('server_version_num') AS n")).rows[0].n,'170011');
 await ref.query(baselineSql);await prepare(ref);const expected=await hashes(ref,true);
 await test('O03 scoped baseline exactly preserves the previously audited application contract',async()=>{
  const old=JSON.parse(fs.readFileSync(path.join(audit,'expected-metadata.json'),'utf8'));
  for(const s of Object.keys(sections)){
   const actual=(await ref.query(ownedMetadataSql(s,policy))).rows.sort((a,b)=>JSON.stringify([a.entity,a.member]).localeCompare(JSON.stringify([b.entity,b.member]),'en'));
   const original=old.sections[s].rows.filter(r=>!externalTables.includes(r.entity)).sort((a,b)=>JSON.stringify([a.entity,a.member]).localeCompare(JSON.stringify([b.entity,b.member]),'en'));
   assert.deepEqual(actual,original,'Managed metadata differs in '+s);
  }
 });
 for(const ddl of ['CREATE DATABASE shared','CREATE DATABASE fresh',"CREATE DATABASE locale_c TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'"])await ref.query(ddl);
 await ref.query(`CREATE ROLE app_migrator LOGIN PASSWORD 'synthetic-app-only';CREATE ROLE mastra_owner LOGIN PASSWORD 'synthetic-mastra-only';
  GRANT CREATE ON DATABASE shared TO mastra_owner`);
 const admin=await connect(url('shared'));await prepare(admin);
 await admin.query('GRANT USAGE,CREATE ON SCHEMA public TO app_migrator,mastra_owner');
 const appUrl=url('shared','app_migrator','synthetic-app-only');
 const app=await connect(appUrl);await app.query(baselineSql);await prepare(app);
 await test('O04 real locked Mastra PostgresStore initializes external tables independently of Prisma Migrate',async()=>{
  const child=spawnSync(process.execPath,[path.join(root,'diagnostics/recovery/mastra-local-init.cjs'),req.resolve('@mastra/pg'),url('shared','mastra_owner','synthetic-mastra-only')],
   {cwd:temp,env,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024*1024});
  assert.equal(child.status,0,child.error?.message||child.stderr);assert(child.stdout.includes('ISOLATED_MASTRA_STORAGE_INITIALIZED'));
  const rows=(await admin.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND left(tablename,7)='mastra_'`)).rows;
  assert(rows.length>8);assert(rows.every(r=>externalTables.includes(r.tablename)));
  sdkExternalTables=rows.map(r=>r.tablename).sort();
  assert.equal((await admin.query("SELECT to_regclass('public._prisma_migrations') AS name")).rows[0].name,null);
 });
 const functionDigest=(await admin.query(`SELECT encode(sha256(convert_to(pg_get_functiondef('public.trigger_set_timestamps()'::regprocedure),'UTF8')),'hex') AS hash`)).rows[0].hash;
 policy.timestampRoutine.sdkDefinitionSha256=functionDigest;
 fs.writeFileSync(path.join(target,'ownership-policy.json'),JSON.stringify(policy,null,2)+'\n');
 const boundary=boundaryQuery(policy,functionDigest);
 fs.writeFileSync(path.join(target,'ownership-boundary-check.sql'),boundary);
 await test('O05 scoped hashes remain equal after real SDK init and every ownership guard passes',async()=>{
  assert.deepEqual(await hashes(admin,true),expected);
  assert(select(await admin.query(boundary)).every(r=>r.status==='MATCH'));
 });
 // All data below is synthetic and only inside the disposable DB.
 const mastra=await connect(url('shared','mastra_owner','synthetic-mastra-only'));await prepare(mastra);
 await mastra.query(`INSERT INTO "mastra_threads" (id,"resourceId",title,"createdAt","updatedAt") VALUES ('thread-test','org-test','Synthetic',NOW(),NOW());
  INSERT INTO "mastra_messages" (id,thread_id,content,role,type,"createdAt","resourceId") VALUES ('message-test','thread-test','Synthetic','user','text',NOW(),'org-test');
  INSERT INTO "mastra_ai_spans" ("traceId","spanId",name,"spanType","isEvent","startedAt") VALUES ('trace-test','span-test','Synthetic','agent',false,NOW());`);
 const snapshot=async()=>{
  const externalMetadata={};
  for(const s of ['tables','columns','constraints','indexes'])externalMetadata[s]=(await admin.query(sections[s].sql)).rows
   .filter(r=>externalTables.includes(r.entity)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
  const identities=(await admin.query(`WITH external_relations AS (
   SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])
  ), objects AS (
   SELECT 'relation'::text AS kind,c.oid::text AS identity FROM pg_class c WHERE c.oid IN (SELECT oid FROM external_relations)
    OR c.oid IN (SELECT indexrelid FROM pg_index WHERE indrelid IN (SELECT oid FROM external_relations))
   UNION ALL SELECT 'constraint',oid::text FROM pg_constraint WHERE conrelid IN (SELECT oid FROM external_relations)
   UNION ALL SELECT 'trigger',oid::text FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM external_relations)
   UNION ALL SELECT 'routine',p.oid::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='trigger_set_timestamps'
  ) SELECT * FROM objects ORDER BY kind,identity`,[externalTables])).rows;
  return {hashes:await hashes(admin),externalMetadata,identities,
   threads:(await mastra.query('SELECT to_jsonb(t) AS row FROM "mastra_threads" t ORDER BY id')).rows,
   messages:(await mastra.query('SELECT to_jsonb(t) AS row FROM "mastra_messages" t ORDER BY id')).rows,
   spans:(await mastra.query('SELECT to_jsonb(t) AS row FROM "mastra_ai_spans" t ORDER BY "traceId","spanId"')).rows};
 };
 const before=await snapshot();
 await app.query(`INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('org-test','Synthetic',CURRENT_TIMESTAMP);
  INSERT INTO "Integration" (id,"internalId","organizationId",name,"providerIdentifier",type,token)
   VALUES ('ig-test','synthetic','org-test','Synthetic','instagram','social','synthetic-only');
  INSERT INTO "Post" (id,"organizationId","integrationId",content,"group","publishDate","updatedAt",state,"releaseId")
   VALUES ('post-test','org-test','ig-test','Synthetic','test','2020-01-01',CURRENT_TIMESTAMP,'PUBLISHED','synthetic-confirmed');
  INSERT INTO "Post" (id,"organizationId","integrationId",content,"group","publishDate","updatedAt",state,"intervalInDays")
   VALUES ('future-test','org-test','ig-test','Synthetic','future','2030-01-01',CURRENT_TIMESTAMP,'QUEUE',2);`);
 const futureBefore=(await app.query('SELECT state,"publishDate","intervalInDays" FROM "Post" WHERE id=\'future-test\'')).rows;
 await test('O06 local-only baseline adoption and recovery deploy preserve external data/objects and confirmed application results',async()=>{
  ok(cli(['migrate','resolve','--applied',baselineName,'--schema',path.join(temp,'schema.prisma')],appUrl));
  ok(cli(['migrate','deploy','--schema',path.join(temp,'schema.prisma')],appUrl));
  const after=await snapshot();
  for(const s of ['extras','enums','database'])assert.equal(after.hashes[s],before.hashes[s]);
  // Full-table data and all external metadata must remain byte-logically equal.
  assert.deepEqual(after.threads,before.threads);assert.deepEqual(after.messages,before.messages);assert.deepEqual(after.spans,before.spans);
  assert.deepEqual(after.externalMetadata,before.externalMetadata);
  assert.deepEqual(after.identities,before.identities,'External tables/indexes/constraints/triggers/routine must retain their OIDs');
  assert.equal((await app.query('SELECT "releaseId","scheduleRevision" FROM "Post" WHERE id=\'post-test\'')).rows[0].releaseId,'synthetic-confirmed');
  assert.deepEqual((await app.query('SELECT state,"publishDate","intervalInDays" FROM "Post" WHERE id=\'future-test\'')).rows,futureBefore);
  assert.equal((await app.query('SELECT phase FROM "AutomationRecoveryControl"')).rows[0].phase,'BLOCKED');
 });
 await test('O07 migration role cannot ALTER external Mastra tables and second deploy is idempotent',async()=>{
  await assert.rejects(app.query('ALTER TABLE "mastra_threads" ADD COLUMN forbidden_probe text'),e=>e.code==='42501');
  const before=await snapshot();ok(cli(['migrate','deploy','--schema',path.join(temp,'schema.prisma')],appUrl));assert.deepEqual(await snapshot(),before);
 });
 await test('O08 empty-database deploy creates only owned tables and the closed recovery control',async()=>{
  ok(cli(['migrate','deploy','--schema',path.join(temp,'schema.prisma')],url('fresh')));
  const fresh=await connect(url('fresh'));await prepare(fresh);
  assert.equal((await fresh.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND left(tablename,7)='mastra_'")).rows[0].n,0);
  ok(cli(['migrate','diff','--from-url',url('fresh'),'--to-schema-datamodel',path.join(temp,'schema.prisma'),'--exit-code']));
 });
 await test('O09 new/unclassified names and application drift are never hidden by prefix exclusions',async()=>{
  await mutate(ref,'CREATE TABLE public.mastra_unclassified_probe(id text);CREATE TABLE public.mastrax_probe(id text)',async()=>{
   assert.notEqual((await hashes(ref,true)).tables,expected.tables);
   assert(select(await ref.query(body(boundary))).some(r=>r.section==='unclassified_mastra_name'&&r.status==='MISMATCH'));
  });
  await mutate(ref,'ALTER TABLE "Post" ALTER COLUMN delay TYPE bigint',async()=>assert.notEqual((await hashes(ref,true)).columns,expected.columns));
 });
 await test('O10 foreign keys across the ownership boundary block approval',async()=>{
  await mutate(admin,'ALTER TABLE "mastra_threads" ADD COLUMN ownership_probe text REFERENCES "Post"(id)',async()=>{
   assert(select(await admin.query(body(boundary))).some(r=>r.section==='cross_boundary_fk'&&r.status==='MISMATCH'));
  });
 });
 await test('O11 timestamp function attached to application tables is not exempted',async()=>{
  await mutate(admin,'CREATE TRIGGER ownership_probe BEFORE UPDATE ON "Post" FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps()',async()=>{
   assert(select(await admin.query(body(boundary))).some(r=>r.section==='timestamps_on_non_external_relation'&&r.status==='MISMATCH'));
   assert.notEqual((await hashes(admin,true)).extras,expected.extras);
  });
 });
 await test('O12 altered routine bodies and overloads require review without exposing their text',async()=>{
  await mutate(admin,`CREATE OR REPLACE FUNCTION public.trigger_set_timestamps() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,async()=>{
   assert(select(await admin.query(body(boundary))).some(r=>r.section==='timestamps_function_contract'&&r.status==='REVIEW_REQUIRED'));
  });
  await mutate(admin,`CREATE FUNCTION public.trigger_set_timestamps(integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$`,async()=>{
   assert(select(await admin.query(body(boundary))).some(r=>r.section==='timestamps_function_contract'&&r.status==='REVIEW_REQUIRED'));
  });
 });
 await test('O13 environmental collation differences remain visible while owned structures compare equally',async()=>{
  const c=await connect(url('locale_c'));await c.query(baselineSql);await prepare(c);
  const current=await hashes(c,true);assert.notEqual(current.database,expected.database);
  for(const s of Object.keys(sections).filter(s=>s!=='database'))assert.equal(current[s],expected[s]);
  assert(select(await c.query(boundary)).some(r=>r.status==='ABSENT_OPTIONAL'));
 });
 await test('O14 guarded shared-schema db push/reset helpers refuse before any Prisma or DB operation',async()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  for(const name of ['prisma-db-push','prisma-reset'])assert.equal(pkg.scripts[name],'node scripts/recovery/deny-shared-schema-push.cjs');
  const r=spawnSync(process.execPath,[path.join(root,'scripts/recovery/deny-shared-schema-push.cjs')],{cwd:temp,env,encoding:'utf8',windowsHide:true});assert.equal(r.status,78);
 });
 // This deliberately demonstrates why shared-DB introspection diffs are NOT a
 // safe migration generator, even with a separate datamodel.
 await test('O15 a live shared-DB diff would propose external drops and is explicitly not adopted',async()=>{
  const diff=ok(cli(['migrate','diff','--from-url',url('shared'),'--to-schema-datamodel',path.join(temp,'schema.prisma'),'--script']));
  assert(/DROP TABLE "mastra_/.test(diff));
 });
 assert.equal(sha(fs.readFileSync(runtimePath)),sha(runtime));assert.equal(sha(fs.readFileSync(oldBaselinePath)),oldBaselineHash);
 assert.equal(sha(fs.readFileSync(path.join(audit,'production-check.sql'))),oldAuditHash);
 assert.deepEqual(connectionErrors,[]);
 const scopedMetadata={};for(const s of Object.keys(sections))scopedMetadata[s]={digest:expected[s],rows:(await ref.query(ownedMetadataSql(s,policy))).rows};
 fs.writeFileSync(path.join(target,'expected-owned-metadata.json'),JSON.stringify(scopedMetadata,null,2)+'\n');
 const boundaryEvidencePath=path.join(target,'production-boundary-result.json');
 const boundaryEvidence=fs.existsSync(boundaryEvidencePath)?JSON.parse(fs.readFileSync(boundaryEvidencePath,'utf8')):null;
 const boundaryConfirmed=!!boundaryEvidence&&Object.keys(boundaryEvidence.sections).length===7&&
  Object.values(boundaryEvidence.sections).every(s=>s==='MATCH')&&boundaryEvidence.localArtifactSha256AtReport===sha(boundary);
 const manifest={status:boundaryConfirmed?'LOCAL_CHAIN_VALIDATED_PRODUCTION_BOUNDARY_CONFIRMED':'LOCAL_CANDIDATE_VALIDATED_PRODUCTION_BOUNDARY_ATTESTATION_PENDING',revision,prisma:'6.5.0',postgres:'17.11',
  productionBoundaryConfirmed:boundaryConfirmed,
  baseline:{name:baselineName,sha256:sha(baselineSql)},migrationChain:[{name:baselineName,sha256:sha(baselineSql)},...additiveMigrations.map(m=>({name:m.name,sha256:sha(m.sql)}))],
  runtimeSchemaSha256:sha(runtime),baselineSchemaSha256:sha(baselineSchema),currentSchemaSha256:sha(currentSchema),
  supersedesForFutureAdoption:'The older full-schema baseline includes Mastra DDL; retained only as source/audit evidence. Never adopt both baselines.',
  historicalMigrationsPreserved:historical,mastraPgSourceSha256:sha(fs.readFileSync(req.resolve('@mastra/pg'))),lockfileSha256:sha(fs.readFileSync(path.join(root,'pnpm-lock.yaml'))),
  ownershipPolicySha256:sha(fs.readFileSync(path.join(target,'ownership-policy.json'))),
  release:'No activation or production migration authorization. C-G not started by this test.'};
 fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 await test('O16 read-only artifact verifier rejects changed SQL and extra unreviewed migrations',async()=>{
  const {verifyOwnedChain}=req(path.join(root,'scripts/recovery/verify-owned-chain.cjs'));
  assert.equal(verifyOwnedChain(target,runtimePath).productionAuthorized,false);
  const changed=path.join(temp,'changed-candidate');fs.cpSync(target,changed,{recursive:true});
  const sqlPath=path.join(changed,'migrations',baselineName,'migration.sql');
  fs.appendFileSync(sqlPath,'\n-- changed test artifact; never executed\n');
  assert.throws(()=>verifyOwnedChain(changed,runtimePath),/Unreviewed migration SQL/);
  fs.writeFileSync(sqlPath,baselineSql);
  fs.mkdirSync(path.join(changed,'migrations/99999999999999_unreviewed'));
  assert.throws(()=>verifyOwnedChain(changed,runtimePath),/Unexpected or missing migration/);
 });
 await test('O17 cross-boundary inheritance cannot hide propagation of application ALTER TABLE into external tables',async()=>{
  await mutate(admin,'CREATE TABLE public.mastra_agents_legacy () INHERITS ("Post")',async()=>{
   assert(select(await admin.query(body(boundary))).some(r=>r.section==='cross_boundary_inheritance'&&r.status==='MISMATCH'));
  });
 });
 await test('O18 every additive migration rolls back all its DDL on an injected failure',async()=>{
  await ref.query('CREATE DATABASE rollback_migrations');
  const c=await connect(url('rollback_migrations'));await c.query(baselineSql);
  for(const migration of additiveMigrations){
   assert(/^BEGIN;/m.test(migration.sql)&&/COMMIT;\s*$/.test(migration.sql),'Explicit transaction required: '+migration.name);
   const before=await hashes(c,true);
   await assert.rejects(c.query(migration.sql.replace(/COMMIT;\s*$/,'SELECT 1/0;\nCOMMIT;')));
   await c.query('ROLLBACK');assert.deepEqual(await hashes(c,true),before,'Partial migration persisted: '+migration.name);
   await c.query(migration.sql);
  }
 });
 fs.writeFileSync(path.join(target,'local-results.json'),JSON.stringify({status:manifest.status,postgres:'17.11',tests:results,
  managedBaselineTables:46,managedCurrentTables:modelNames(currentSchema).length,knownExternalTableNames:externalTables.length,sdkCreatedTables:sdkExternalTables,realMastraInit:true,
  productionUnchanged:true,runtimeSchemaUnchanged:true,oldBaselineAndAuditPreserved:true},null,2)+'\n');
 console.log(JSON.stringify({tests:results.length,status:'PASS',knownExternalTableNames:externalTables.length,production:'UNCHANGED'}));
}finally{
 await Promise.allSettled(clients.map(c=>c.end()));
 if(container){assert.equal(docker(['inspect','--format','{{ index .Config.Labels "trendpostiz.ownership" }}',container]),label);docker(['rm','--force',container]);}
 if(network){assert.equal(docker(['network','inspect','--format','{{ index .Labels "trendpostiz.ownership" }}',network]),label);docker(['network','rm',network]);}
}
