// Local-only Prisma 6.5 baseline proposal and metadata checks. No .env, dump,
// client data, configured DB, remote Docker, Temporal, or worker initialization.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { spawnSync,execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sections,hashQuery,entityHashQuery,checkQuery,consolidatedQuery,locateQuery,detailQuery } from './baseline-metadata.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const req=createRequire(path.join(root,'package.json'));
const {Client}=req('pg');
assert.equal(req('prisma/package.json').version,'6.5.0');
const revision='36f4cd9971d5f304b0ab94f373160ea632341ac4';
const baselineName='00000000000000_v1_7_4_baseline';
const nextName='20261114000000_safe_recovery_foundation';
const schemaRoot=path.join(root,'libraries/nestjs-libraries/src/database/prisma');
const proposal=path.join(schemaRoot,'baseline-proposal');
const audit=path.join(root,'diagnostics/recovery/baseline-audit');
const productionReportPath=path.join(audit,'production-result.json');
const productionAudit=fs.existsSync(productionReportPath)?JSON.parse(fs.readFileSync(productionReportPath,'utf8')):null;
const productionCompatibility=productionAudit?'BLOCKED_REPORTED_MISMATCHES_PENDING_TARGETED_DIAGNOSIS':'ENUM_ORDER_CONFIRMED_CONSOLIDATED_CHECK_PENDING';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trendpostiz-baseline-'));
const label='baseline-'+randomUUID();
const clients=[],results=[],connectionErrors=[];
let container,network;
const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const docker=args=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.error?.message);return r.stdout.trim()};
const sha=s=>createHash('sha256').update(s).digest('hex');
const cli=(args,url)=>spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),...args],{cwd:dir,
  env:{...env,DATABASE_URL:url||'postgresql://synthetic:test@127.0.0.1:1/test'},encoding:'utf8',windowsHide:true});
const ok=r=>{assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout};
const connect=async url=>{const c=new Client({connectionString:url});c.on('error',error=>connectionErrors.push(error.message));await c.connect();clients.push(c);return c};
const test=async(name,fn)=>{await fn();results.push({name,result:'PASS'});console.log('PASS',name)};
async function metadata(c,insideTransaction=false){
  if(!insideTransaction)await c.query('BEGIN READ ONLY');
  try{
    await c.query('SET LOCAL search_path=pg_catalog,public');
    const out={};
    for(const section of Object.keys(sections))out[section]={
      digest:(await c.query(hashQuery(section))).rows[0].digest,
      entities:Object.fromEntries((await c.query(entityHashQuery(section))).rows.map(r=>[r.entity,r.digest])),
      rows:(await c.query(sections[section].sql)).rows,
    };
    return out;
  }finally{if(!insideTransaction)await c.query('ROLLBACK')}
}
const changes=(a,b)=>Object.keys(a).filter(k=>a[k].digest!==b[k].digest);
try{
  if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))throw Error('Remote Docker forbidden');
  assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^(npipe|unix):\/\//);
  const oldSchema=execFileSync('git',['show',revision+':libraries/nestjs-libraries/src/database/prisma/schema.prisma'],{cwd:root,encoding:'utf8',windowsHide:true});
  const evidence=JSON.parse(fs.readFileSync(path.join(proposal,'production-evidence.json'),'utf8'));
  const enumName='InstagramWebhookEventStatus',confirmedOrder=evidence.enumOrders[enumName];
  // Only the operator-confirmed order may differ from the pinned source. Keep
  // the original snapshot intact; never invent other production reconciliation.
  const enumPattern=/enum InstagramWebhookEventStatus \{[^}]+\}/;
  const originalEnum=oldSchema.match(enumPattern)?.[0];assert(originalEnum);
  const sourceOrder=originalEnum.replace(/^enum \w+ \{\s*|\s*\}$/g,'').trim().split(/\s+/);
  assert.deepEqual([...confirmedOrder].sort(),[...sourceOrder].sort());
  assert.notDeepEqual(confirmedOrder,sourceOrder);
  const reconciledSchema=oldSchema.replace(enumPattern,`enum ${enumName} {\n${confirmedOrder.map(v=>'  '+v).join('\n')}\n}`);
  assert.equal(reconciledSchema.replace(enumPattern,originalEnum),oldSchema);
  fs.writeFileSync(path.join(dir,'source.prisma'),oldSchema);
  fs.writeFileSync(path.join(dir,'baseline.prisma'),reconciledSchema);
  fs.copyFileSync(path.join(schemaRoot,'schema.prisma'),path.join(dir,'schema.prisma'));
  assert.deepEqual(fs.readFileSync(path.join(dir,'schema.prisma'),'utf8').match(enumPattern)[0].match(/\{([^}]+)\}/)[1].trim().split(/\s+/),confirmedOrder);
  const sourceBaseline=ok(cli(['migrate','diff','--from-empty','--to-schema-datamodel',path.join(dir,'source.prisma'),'--script']));
  const baseline=ok(cli(['migrate','diff','--from-empty','--to-schema-datamodel',path.join(dir,'baseline.prisma'),'--script']));
  const enumDdl=order=>`CREATE TYPE "${enumName}" AS ENUM (${order.map(v=>"'"+v+"'").join(', ')});`;
  assert(sourceBaseline.includes(enumDdl(sourceOrder)));
  assert.equal(baseline,sourceBaseline.replace(enumDdl(sourceOrder),enumDdl(confirmedOrder)));
  const next=fs.readFileSync(path.join(schemaRoot,'migrations',nextName,'migration.sql'),'utf8');
  const historical=fs.readdirSync(path.join(schemaRoot,'migrations')).filter(n=>n<nextName).sort().map(name=>{
    const file=path.join(schemaRoot,'migrations',name,'migration.sql'),working=fs.readFileSync(file,'utf8');
    const sql=execFileSync('git',['show',revision+':libraries/nestjs-libraries/src/database/prisma/migrations/'+name+'/migration.sql'],{cwd:root,encoding:'utf8',windowsHide:true});
    assert.equal(working.replaceAll('\r\n','\n'),sql.replaceAll('\r\n','\n'),'Historical SQL differs from the pinned revision: '+name);
    return {name,file,sql,sha256:sha(sql),workingTreeSha256:sha(working)};
  });
  fs.mkdirSync(path.join(proposal,baselineName),{recursive:true});
  fs.writeFileSync(path.join(proposal,baselineName,'migration.sql'),baseline);
  fs.writeFileSync(path.join(proposal,'schema.v1.7.4.prisma'),oldSchema);
  fs.writeFileSync(path.join(proposal,'schema.reconciled.prisma'),reconciledSchema);
  fs.mkdirSync(audit,{recursive:true});
  const manifest={status:'PROPOSAL_ONLY',productionCompatibility:productionAudit?productionCompatibility:'PARTIAL_ENUM_CONFIRMED_OTHER_METADATA_PENDING',revision,prisma:'6.5.0',postgres:'17.11',
    ...(productionAudit?{productionAuditReport:path.relative(proposal,productionReportPath).replaceAll('\\','/')}:{}),
    schemaSha256:sha(oldSchema),baseline:{name:baselineName,sha256:sha(baseline)},
    originalUnreconciledBaselineSha256:sha(sourceBaseline),reconciledSchemaSha256:sha(reconciledSchema),
    reconciliation:[{object:enumName,property:'enum_label_order',sourceOrder,confirmedProductionOrder:confirmedOrder,
      evidence:'production-evidence.json',scope:'Local baseline CREATE TYPE and declarative schema only; no production ALTER TYPE'}],
    proposedActiveChain:[baselineName,nextName],
    nextMigration:{name:nextName,source:'migrations/'+nextName+'/migration.sql',sha256:sha(next)},
    historical:historical.map(({name,file,sha256,workingTreeSha256})=>({name,source:path.relative(schemaRoot,file).replaceAll('\\','/'),sha256,workingTreeSha256,
      disposition:'PRESERVE_AS_ARCHIVE_IN_A_FUTURE_APPROVED_REORGANIZATION; DO_NOT_REPLAY_AFTER_FULL_BASELINE'}))};
  fs.writeFileSync(path.join(proposal,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  for(const [name,sql] of [[baselineName,baseline],[nextName,next]]){
    fs.mkdirSync(path.join(dir,'migrations',name),{recursive:true});fs.writeFileSync(path.join(dir,'migrations',name,'migration.sql'),sql);
  }
  fs.writeFileSync(path.join(dir,'migrations/migration_lock.toml'),'provider = "postgresql"\n');
  network=docker(['network','create','--label','trendpostiz.baseline='+label,label]);
  container=docker(['run','--detach','--rm','--name',label,'--label','trendpostiz.baseline='+label,'--network',network,
    '--publish','127.0.0.1::5432','-e','POSTGRES_USER=baseline_test','-e','POSTGRES_PASSWORD=synthetic-only','-e','POSTGRES_DB=reference','postgres:17.11']);
  let ready=false;
  for(let n=0;n<60;n++){if(spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','baseline_test'],{stdio:'ignore',windowsHide:true}).status===0){ready=true;break}await new Promise(r=>setTimeout(r,300))}
  assert(ready,'PostgreSQL did not become ready');
  const address=docker(['port',container,'5432/tcp']);assert.match(address,/^127\.0\.0\.1:\d+$/);
  const url=name=>`postgresql://baseline_test:synthetic-only@${address}/${name}`;
  const reference=await connect(url('reference'));
  assert.equal((await reference.query("SELECT current_setting('server_version_num') AS n")).rows[0].n,'170011');
  await reference.query('CREATE DATABASE deploy_empty');await reference.query('CREATE DATABASE adopt_existing');await reference.query('CREATE DATABASE historical_replay');
  await reference.query('CREATE DATABASE unreconciled_source');
  await test('BL01 baseline derives from exact v1.7.4 source with only the confirmed enum-order correction',async()=>{
    await reference.query(baseline);
    assert.equal((await reference.query("SELECT to_regclass('public.\"AutomationRecoveryControl\"') AS name")).rows[0].name,null);
    ok(cli(['migrate','diff','--from-url',url('reference'),'--to-schema-datamodel',path.join(dir,'baseline.prisma'),'--exit-code']));
  });
  const expected=await metadata(reference);
  fs.writeFileSync(path.join(audit,'expected-metadata.json'),JSON.stringify({revision,baselineSha256:sha(baseline),reconciliation:manifest.reconciliation,sections:expected},null,2)+'\n');
  let number=0;
  for(const section of Object.keys(sections))fs.writeFileSync(path.join(audit,String(++number).padStart(2,'0')+'-'+section+'.sql'),
    '-- Read-only production check. Return only section and MATCH/MISMATCH.\n'+checkQuery(section,expected[section].digest));
  const consolidated=consolidatedQuery(expected);
  fs.writeFileSync(path.join(audit,'production-check.sql'),consolidated);
  await test('BL02 fresh deploy applies only baseline then additive recovery',async()=>{
    ok(cli(['migrate','deploy','--schema',path.join(dir,'schema.prisma')],url('deploy_empty')));
    const db=await connect(url('deploy_empty'));
    assert.deepEqual((await db.query('SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name')).rows.map(r=>r.migration_name),[baselineName,nextName]);
    assert.equal((await db.query('SELECT phase FROM "AutomationRecoveryControl"')).rows[0].phase,'BLOCKED');
    ok(cli(['migrate','diff','--from-url',url('deploy_empty'),'--to-schema-datamodel',path.join(dir,'schema.prisma'),'--exit-code']));
    ok(cli(['migrate','deploy','--schema',path.join(dir,'schema.prisma')],url('deploy_empty')));
  });
  await test('BL03 local-only adoption preserves synthetic rows then deploys recovery once',async()=>{
    const db=await connect(url('adopt_existing'));await db.query(baseline);
    await db.query(`INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('fixture-org','Synthetic',CURRENT_TIMESTAMP);
      INSERT INTO "Integration" (id,"internalId","organizationId",name,"providerIdentifier",type,token)
      VALUES ('fixture-ig','synthetic','fixture-org','Synthetic','instagram','social','synthetic-only');
      INSERT INTO "Post" (id,"organizationId","integrationId",content,"group","publishDate","updatedAt",state,"releaseId")
      VALUES ('fixture-post','fixture-org','fixture-ig','Synthetic','synthetic','2030-01-01',CURRENT_TIMESTAMP,'PUBLISHED','confirmed-synthetic');`);
    await db.query(`INSERT INTO "InstagramWebhookEvent" (id,"instagramAccountId",payload,status)
      SELECT 'fixture-comment-'||s::text,'synthetic-account','{"synthetic":true}'::jsonb,s
      FROM unnest(enum_range(NULL::"InstagramWebhookEventStatus")) AS p(s)`);
    const enumIdentity=()=>db.query(`SELECT e.oid::text,e.enumlabel,e.enumsortorder FROM pg_enum e
      JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typname='InstagramWebhookEventStatus' ORDER BY e.enumsortorder`);
    const history=()=>db.query(`SELECT id,status::text,payload,"receivedAt" FROM "InstagramWebhookEvent" ORDER BY id`);
    const beforeEnum=(await enumIdentity()).rows,beforeHistory=(await history()).rows;
    assert.deepEqual(changes(expected,await metadata(db)),[]);
    // This command is executed ONLY against the freshly created owned local DB.
    ok(cli(['migrate','resolve','--applied',baselineName,'--schema',path.join(dir,'schema.prisma')],url('adopt_existing')));
    ok(cli(['migrate','deploy','--schema',path.join(dir,'schema.prisma')],url('adopt_existing')));
    assert.equal((await db.query('SELECT "releaseId" FROM "Post" WHERE id=\'fixture-post\'')).rows[0].releaseId,'confirmed-synthetic');
    assert.equal((await db.query('SELECT "scheduleRevision" FROM "Post" WHERE id=\'fixture-post\'')).rows[0].scheduleRevision,0);
    assert.deepEqual((await enumIdentity()).rows,beforeEnum,'Adoption/upgrade must not recreate or reorder the existing enum');
    assert.deepEqual((await history()).rows,beforeHistory,'All nine persisted statuses and historical event contents must remain intact');
  });
  await test('BL04 legacy files remain byte-for-byte unchanged and cannot replay after full baseline',async()=>{
    for(const h of historical)assert.equal(sha(fs.readFileSync(h.file,'utf8')),h.workingTreeSha256);
    await assert.rejects(reference.query(historical[0].sql),e=>e.code==='42701');
    assert.deepEqual(changes(expected,await metadata(reference)),[]);
  });
  // Derive a pre-feature fixture from v1.7.4 ONLY, removing exactly the footprint
  // of the six partial migrations, then execute their original SQL unchanged.
  await test('BL05 six historical migrations replay on a local pre-feature fixture; semantic drift is inventoried',async()=>{
    const db=await connect(url('historical_replay'));await db.query(baseline);
    await db.query(`DROP TABLE "InstagramCommentAutomationExecution","InstagramCommentAutomationTrigger","InstagramCommentAutomation";
      DROP TYPE "InstagramCommentDeliveryStatus","InstagramCommentMatchType";
      DROP TABLE "InstagramWebhookEvent"; DROP TYPE "InstagramWebhookEventStatus";
      DROP TABLE "PlatformSettings","AdminAuditLog";
      ALTER TABLE "Integration" DROP COLUMN "webhookCommentsSubscribed",DROP COLUMN "webhookSubscriptionLastAttemptAt",DROP COLUMN "webhookSubscriptionError",DROP COLUMN "webhookMessagesSubscribed",DROP COLUMN "facebookPageId";
      ALTER TABLE "Organization" DROP COLUMN "suspendedAt",DROP COLUMN "suspensionReason",DROP COLUMN "deletionRequestedAt",DROP COLUMN "deletionRequestedById",DROP COLUMN "deletionProcessingAt",DROP COLUMN "deletionError";
      ALTER TABLE "User" DROP COLUMN "isPlatformAdmin",DROP COLUMN "disabledAt",DROP COLUMN "disabledReason";
      ALTER TABLE "Post" DROP COLUMN "adminPausedAt",DROP COLUMN "youtubeUploadKey",DROP COLUMN "youtubeUploadState",DROP COLUMN "youtubeVideoId",DROP COLUMN "youtubeThumbnailPath",DROP COLUMN "youtubeThumbnailStatus",DROP COLUMN "youtubeThumbnailAttempts",DROP COLUMN "youtubeThumbnailError",DROP COLUMN "youtubeThumbnailNextAt";`);
    for(const h of historical)await db.query(h.sql);
    const actual=await metadata(db),drift=[];
    for(const section of changes(expected,actual)){
      const keys=new Set([...actual[section].rows,...expected[section].rows].map(r=>JSON.stringify([r.entity,r.member])));
      for(const key of keys){const [entity,member]=JSON.parse(key),row=actual[section].rows.find(r=>r.entity===entity&&r.member===member),
          before=expected[section].rows.find(r=>r.entity===entity&&r.member===member);
        const normalizeIndex=s=>s?.replace(/^CREATE (UNIQUE )?INDEX (?:"(?:[^"]|"")*"|\S+)/,'CREATE $1INDEX <name>');
        const equivalent=section==='indexes'&&row&&!before?expected[section].rows.find(r=>r.entity===entity&&
          normalizeIndex(r.signature[0])===normalizeIndex(row.signature[0])&&JSON.stringify(r.signature.slice(1))===JSON.stringify(row.signature.slice(1))):undefined;
        if(JSON.stringify(before?.signature)!==JSON.stringify(row?.signature))drift.push({section,object:entity,member,
          status:!row?'MISSING_FROM_REPLAY':!before?'EXTRA_IN_REPLAY':'DIFFERENT',
          ...(equivalent?{sameDefinitionExceptNameAs:equivalent.member}:{}),
          properties:sections[section].fields.filter((_,i)=>JSON.stringify(before?.signature[i])!==JSON.stringify(row?.signature[i]))});}
    }
    fs.writeFileSync(path.join(audit,'historical-drift.json'),JSON.stringify(drift,null,2)+'\n');
    assert.deepEqual(changes(expected,actual),['indexes']);
    assert(drift.every(d=>['InstagramCommentAutomationTrigger','InstagramCommentAutomationExecution'].includes(d.object)));
    console.log('Historical semantic differences:',JSON.stringify(drift));
  });
  const mutate=async(section,sql,check)=>{await reference.query('BEGIN');try{await reference.query(sql);const m=await metadata(reference,true);assert(changes(expected,m).includes(section));if(check)await check(m)}finally{await reference.query('ROLLBACK')}};
  await test('BL06 equal column counts with changed SQL type are detected',()=>mutate('columns','ALTER TABLE "Post" ALTER COLUMN "delay" TYPE bigint'));
  await test('BL07 nullability changes are detected',()=>mutate('columns','ALTER TABLE "Post" ALTER COLUMN "content" DROP NOT NULL'));
  await test('BL08 changed defaults are detected without returning the literal',()=>mutate('columns',"ALTER TABLE \"Post\" ALTER COLUMN \"delay\" SET DEFAULT 47"));
  await test('BL09 FK referential actions are detected',()=>mutate('constraints',`ALTER TABLE "Post" DROP CONSTRAINT "Post_integrationId_fkey";
    ALTER TABLE "Post" ADD CONSTRAINT "Post_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"(id) ON DELETE CASCADE ON UPDATE CASCADE`));
  await test('BL10 uniqueness changes are detected',()=>mutate('indexes',`DROP INDEX "Integration_organizationId_internalId_key";
    CREATE INDEX "Integration_organizationId_internalId_key" ON "Integration"("organizationId","internalId")`));
  await test('BL11 missing index is detected',()=>mutate('indexes','DROP INDEX "Post_publishDate_idx"'));
  await test('BL12 enum values/order changes are detected',()=>mutate('enums',`ALTER TYPE "State" RENAME VALUE 'ERROR' TO 'ERROR_CHANGED'`));
  await test('BL13 extra columns and objects are detected',async()=>{
    await mutate('columns','ALTER TABLE "Post" ADD COLUMN unexpected_metadata_probe integer');
    await mutate('extras','CREATE VIEW baseline_extra_view AS SELECT 1 AS probe');
    await mutate('extras','CREATE DOMAIN public.baseline_extra_domain AS integer');
    await mutate('extras','CREATE RULE baseline_extra_rule AS ON INSERT TO "Post" DO INSTEAD NOTHING');
  });
  await test('BL14 production checks are SELECT/catalog-only and work without client-table privileges',async()=>{
    await reference.query("CREATE ROLE baseline_auditor LOGIN PASSWORD 'synthetic-audit-only'");
    const auditUrl=`postgresql://baseline_auditor:synthetic-audit-only@${address}/reference`;
    const c=await connect(auditUrl);
    for(const section of Object.keys(sections)){
      const rows=await c.query(checkQuery(section,expected[section].digest));
      const result=rows.find(r=>r.fields?.length)?.rows;assert.equal(result[0].status,'MATCH');
      assert.deepEqual(Object.keys(result[0]).sort(),['section','status']);
    }
    await c.query('BEGIN READ ONLY');await assert.rejects(c.query('CREATE TABLE public.must_not_exist(id integer)'),e=>e.code==='25006');await c.query('ROLLBACK');
  });
  await test('BL15 targeted diagnosis locates member and property without exporting definitions or literals',async()=>{
    await mutate('columns',"ALTER TABLE \"Post\" ALTER COLUMN \"delay\" SET DEFAULT 47",async()=>{
      const located=await reference.query(locateQuery('columns',expected.columns.entities).replace('BEGIN READ ONLY;','').replace('ROLLBACK;',''));
      assert(located.find(r=>r.fields?.length)?.rows.some(r=>r.object==='Post'));
      const detail=await reference.query(detailQuery('columns','Post',expected.columns.rows).replace('BEGIN READ ONLY;','').replace('ROLLBACK;',''));
      const rows=detail.find(r=>r.fields?.length)?.rows;
      assert(rows.some(r=>r.member==='delay'&&r.properties.includes('default')));
      assert(!JSON.stringify(rows).includes('47'));
    });
  });
  await test('BL16 metadata ignores application rows and physical column order',async()=>{
    const db=await connect(url('adopt_existing'));
    // Recovery objects are intentionally extra to the v1.7.4 contract, not hidden.
    assert(changes(expected,await metadata(db)).includes('tables'));
    await reference.query('BEGIN');
    try{
      await reference.query('INSERT INTO "Organization" (id,name,"updatedAt") VALUES (\'metadata-row-probe\',\'Synthetic\',CURRENT_TIMESTAMP)');
      assert.deepEqual(changes(expected,await metadata(reference,true)),[]);
      await reference.query('CREATE TABLE public.column_order_probe(id integer,content text)');
      const first=await metadata(reference,true);
      await reference.query('DROP TABLE public.column_order_probe; CREATE TABLE public.column_order_probe(content text,id integer)');
      assert.deepEqual(changes(first,await metadata(reference,true)),[]);
    }finally{await reference.query('ROLLBACK')}
  });
  await test('BL17 identical enum label sets in a different order are detected',async()=>{
    await reference.query('BEGIN');
    try{
      await reference.query("CREATE TYPE public.enum_order_probe AS ENUM ('a','b')");
      const first=await metadata(reference,true);
      await reference.query("DROP TYPE public.enum_order_probe; CREATE TYPE public.enum_order_probe AS ENUM ('b','a')");
      assert(changes(first,await metadata(reference,true)).includes('enums'));
    }finally{await reference.query('ROLLBACK')}
  });
  await test('BL18 production and targeted results never return a changed default literal',async()=>{
    await mutate('columns',"ALTER TABLE \"Post\" ALTER COLUMN content SET DEFAULT 'synthetic-private-marker'",async()=>{
      for(const sql of [checkQuery('columns',expected.columns.digest),detailQuery('columns','Post',expected.columns.rows,'content')]){
        const r=await reference.query(sql.replace('BEGIN READ ONLY;','').replace('ROLLBACK;',''));
        const output=r.find(x=>x.fields?.length)?.rows;
        assert(output.length>0);assert(!JSON.stringify(output).includes('synthetic-private-marker'));
      }
    });
  });
  await test('BL19 optional locate/detail SQL parses and runs read-only for every category',async()=>{
    for(const section of Object.keys(sections)){
      const entity=Object.keys(expected[section].entities)[0]||'no_extra_object_expected';
      for(const sql of [locateQuery(section,expected[section].entities),detailQuery(section,entity,expected[section].rows)]){
        const all=await reference.query(sql),rows=all.find(r=>r.fields?.length)?.rows;
        assert.deepEqual(rows,[]);
      }
    }
  });
  await test('BL20 reconciled enum matches the exact production order; unreconciled source is still detected',async()=>{
    const labels=(await reference.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
      JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname=$1 ORDER BY e.enumsortorder`,[enumName])).rows.map(r=>r.enumlabel);
    assert.deepEqual(labels,confirmedOrder);
    const db=await connect(url('unreconciled_source'));await db.query(sourceBaseline);
    assert.deepEqual(changes(expected,await metadata(db)),['enums']);
    const result=(await db.query(consolidated)).find(r=>r.fields?.length).rows;
    assert.deepEqual(result.filter(r=>r.status==='MISMATCH'),[{section:'enums',status:'MISMATCH'}]);
  });
  await test('BL21 consolidated SQL returns exactly seven pairs without application-table SELECT privileges',async()=>{
    const c=await connect(`postgresql://baseline_auditor:synthetic-audit-only@${address}/reference`);
    assert.equal((await c.query(`SELECT has_table_privilege(current_user,'public."Post"','SELECT') AS allowed`)).rows[0].allowed,false);
    const all=await c.query(consolidated),selects=all.filter(r=>r.fields?.length);
    assert.equal(selects.length,1);
    assert.deepEqual(selects[0].fields.map(f=>f.name),['section','status']);
    assert.deepEqual(selects[0].rows,Object.keys(sections).map(section=>({section,status:'MATCH'})));
    assert(all.every(r=>['BEGIN','SET','SELECT','ROLLBACK'].includes(r.command)));
    const transactionProbe=consolidated.replace('SELECT section,status FROM checks ORDER BY ordinal;',
      `SELECT section,status,current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation,
       current_setting('statement_timeout') AS timeout,current_setting('lock_timeout') AS lock_timeout FROM checks ORDER BY ordinal;`);
    const probe=(await c.query(transactionProbe)).find(r=>r.fields?.length).rows;
    assert(probe.every(r=>r.readonly==='on'&&r.isolation==='repeatable read'&&r.timeout==='10s'&&r.lock_timeout==='2s'));
  });
  await test('BL22 consolidated SQL detects additional drift with equal column counts without returning literals',async()=>{
    await mutate('columns',`ALTER TABLE "Post" ALTER COLUMN "delay" TYPE bigint;
      ALTER TABLE "Post" ALTER COLUMN content SET DEFAULT 'synthetic-consolidated-private-marker'`,async()=>{
      // Same production SELECT, inside this disposable DB's mutation transaction.
      const sql=consolidated.replace('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;','').replace('ROLLBACK;','');
      const all=await reference.query(sql),rows=all.find(r=>r.fields?.length).rows;
      assert.equal(rows.length,7);
      assert.deepEqual(rows.filter(r=>r.status==='MISMATCH'),[{section:'columns',status:'MISMATCH'}]);
      assert(!JSON.stringify(rows).includes('synthetic-consolidated-private-marker'));
    });
  });
  await test('BL23 historical index-name differences remain visible and targeted diagnosis identifies only affected objects',async()=>{
    const db=await connect(url('historical_replay'));
    const rows=(await db.query(consolidated)).find(r=>r.fields?.length).rows;
    assert.deepEqual(rows.filter(r=>r.status==='MISMATCH'),[{section:'indexes',status:'MISMATCH'}]);
    const located=(await db.query(locateQuery('indexes',expected.indexes.entities))).find(r=>r.fields?.length).rows;
    assert.deepEqual(located.map(r=>r.object).sort(),['InstagramCommentAutomationExecution','InstagramCommentAutomationTrigger']);
    for(const {object} of located){
      const detail=(await db.query(detailQuery('indexes',object,expected.indexes.rows))).find(r=>r.fields?.length).rows;
      assert.equal(detail.length,2);assert(detail.every(r=>r.object===object));
    }
  });
  assert.deepEqual(connectionErrors,[],'Unexpected DB connection failure during test');
  const report={status:'LOCAL_BASELINE_AND_CANDIDATE_CHAIN_VALIDATED',productionCompatibility,revision,
    reconciliation:manifest.reconciliation,productionSqlSha256:sha(consolidated),
    postgres:'17.11',postgresImageId:docker(['inspect','--format','{{.Image}}',container]),prisma:'6.5.0',baselineSha256:sha(baseline),results,historicalMigrationsPreserved:historical.length};
  fs.writeFileSync(path.join(audit,'local-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,tests:results.length,artifacts:dir}));
}finally{
  await Promise.allSettled(clients.map(c=>c.end()));
  if(container){assert.equal(docker(['inspect','--format','{{ index .Config.Labels "trendpostiz.baseline" }}',container]),label);docker(['rm','--force',container]);}
  if(network){assert.equal(docker(['network','inspect','--format','{{ index .Labels "trendpostiz.baseline" }}',network]),label);docker(['network','rm',network]);}
}
