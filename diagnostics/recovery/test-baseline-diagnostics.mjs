// Local PostgreSQL 17.11 only; no .env, app imports, external APIs or migrations.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID,createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sections,hashQuery,locateQuery } from './baseline-metadata.mjs';
import { diagnosticSettings,sessionContextSql,reportedLocateQuery,targetedDetailQuery } from './baseline-diagnostics.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const {Client}=createRequire(path.join(root,'package.json'))('pg');
const audit=path.join(root,'diagnostics/recovery/baseline-audit');
const baselinePath=path.join(root,'libraries/nestjs-libraries/src/database/prisma/baseline-proposal/00000000000000_v1_7_4_baseline/migration.sql');
const contract=JSON.parse(fs.readFileSync(path.join(audit,'expected-metadata.json'),'utf8'));
const report=JSON.parse(fs.readFileSync(path.join(audit,'production-result.json'),'utf8'));
const baseline=fs.readFileSync(baselinePath,'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const expectedHashes=Object.fromEntries(Object.entries(contract.sections).map(([s,c])=>[s,c.digest]));
const sql=reportedLocateQuery(contract,report);
const label='baseline-diagnostics-'+randomUUID();
const clients=[],results=[],connectionErrors=[];
let network,container;
const docker=args=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.error?.message);return r.stdout.trim()};
const connect=async(url,user='baseline_test',password='synthetic-only')=>{
  assert.match(url,/^postgresql:\/\/127\.0\.0\.1:\d+\//);
  const parsed=new URL(url);
  const c=new Client({host:parsed.hostname,port:Number(parsed.port),database:parsed.pathname.slice(1),user,password,ssl:false});
  c.on('error',e=>connectionErrors.push(e.message));await c.connect();clients.push(c);return c;
};
const test=async(name,fn)=>{await fn();results.push({name,result:'PASS'});console.log('PASS',name)};
const selects=r=>r.filter(x=>x.fields?.length);
const body=s=>s.replace(/^BEGIN TRANSACTION[^;]+;/m,'').replace(/ROLLBACK;\s*$/,'');
const hashes=async c=>{
  const result={};
  for(const section of Object.keys(sections))result[section]=(await c.query(hashQuery(section))).rows[0].digest;
  return result;
};
const changed=h=>Object.keys(expectedHashes).filter(k=>h[k]!==expectedHashes[k]);
async function mutate(c,ddl,fn){await c.query('BEGIN');try{await c.query(ddl);await fn()}finally{await c.query('ROLLBACK')}}
try{
  if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))throw Error('Remote Docker forbidden');
  assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^(npipe|unix):\/\//);
  assert.equal(sha(baseline),contract.baselineSha256);
  assert.equal(sha(fs.readFileSync(path.join(audit,'production-check.sql'))),report.localArtifactSha256AtReport);
  assert.equal(sha(baseline),report.baselineSha256AtReport);
  network=docker(['network','create','--label','trendpostiz.baseline.diagnostics='+label,label]);
  container=docker(['run','--detach','--rm','--name',label,'--label','trendpostiz.baseline.diagnostics='+label,'--network',network,
    '--publish','127.0.0.1::5432','-e','POSTGRES_USER=baseline_test','-e','POSTGRES_PASSWORD=synthetic-only','-e','POSTGRES_DB=reference','postgres:17.11']);
  let ready=false;
  for(let n=0;n<60;n++){
    if(spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','baseline_test'],{stdio:'ignore',windowsHide:true}).status===0){ready=true;break}
    await new Promise(r=>setTimeout(r,300));
  }
  assert(ready,'Disposable PostgreSQL did not become ready');
  const address=docker(['port',container,'5432/tcp']);assert.match(address,/^127\.0\.0\.1:\d+$/);
  const url=db=>`postgresql://${address}/${db}`;
  const c=await connect(url('reference'));
  assert.equal((await c.query("SELECT current_setting('server_version_num') AS n")).rows[0].n,'170011');
  await c.query(baseline);
  await c.query(diagnosticSettings.replaceAll('SET LOCAL','SET'));
  await test('D01 pinned diagnostic settings reproduce the existing expected contract without baseline changes',async()=>{
    assert.deepEqual(await hashes(c),expectedHashes);
    const originalSql=fs.readFileSync(path.join(audit,'production-locate.sql'),'utf8').replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
    assert.equal(originalSql,sql);
  });
  await test('D02 consolidated locate returns safe environment context and no matching object names',async()=>{
    const all=await c.query(sql),data=selects(all);
    assert.equal(data.length,2);assert.equal(data[0].rows.length,1);assert.deepEqual(data[1].rows,[]);
    assert.deepEqual(data[1].fields.map(f=>f.name),['section','object','status']);
    const env=data[0].rows[0];assert.equal(env.section,'database');assert(env.actual_environment.stored_version_matches_runtime);
    assert(!/database_name|user_name|host_name/.test(JSON.stringify(env)));
    assert(all.every(r=>['BEGIN','SET','SELECT','ROLLBACK'].includes(r.command)));
  });
  await test('D03 missing and extra tables/columns are located without listing the whole schema',async()=>{
    await mutate(c,'DROP TABLE "PlatformSettings"; CREATE UNLOGGED TABLE public.diagnostic_extra_table(id integer)',async()=>{
      const rows=selects(await c.query(body(sql)))[1].rows;
      for(const section of ['tables','columns'])assert.deepEqual(rows.filter(r=>r.section===section),[
        {section,object:'PlatformSettings',status:'MISSING'},
        {section,object:'diagnostic_extra_table',status:'EXTRA'},
      ]);
      assert(rows.every(r=>['PlatformSettings','diagnostic_extra_table'].includes(r.object)));
    });
  });
  await test('D04 table property differences are functional candidates; targeted detail returns only changed properties',async()=>{
    await mutate(c,'ALTER TABLE "Post" ENABLE ROW LEVEL SECURITY',async()=>{
      const rows=selects(await c.query(body(sql)))[1].rows;
      assert.deepEqual(rows,[{section:'tables',object:'Post',status:'DIFFERENT'}]);
      const detail=selects(await c.query(body(targetedDetailQuery(contract,'tables','Post'))))[0].rows;
      assert.equal(detail.length,1);assert.equal(detail[0].properties,'row_security');
      assert.equal(detail[0].expected_rls,'false');assert.equal(detail[0].actual_rls,'true');
    });
  });
  await test('D05 column type/nullability/default changes identify Post only and never return default literals',async()=>{
    await mutate(c,`ALTER TABLE "Post" ALTER COLUMN "delay" TYPE bigint;
      ALTER TABLE "Post" ALTER COLUMN content DROP NOT NULL;
      ALTER TABLE "Post" ALTER COLUMN content SET DEFAULT 'synthetic-private-default-marker'`,async()=>{
      const rows=selects(await c.query(body(sql)))[1].rows;
      assert.deepEqual(rows,[{section:'columns',object:'Post',status:'DIFFERENT'}]);
      const detail=selects(await c.query(body(targetedDetailQuery(contract,'columns','Post'))))[0].rows;
      assert.deepEqual(detail.map(r=>r.member),['content','delay']);
      assert(detail.some(r=>r.properties.includes('default')&&r.properties.includes('not_null')));
      assert(detail.some(r=>r.actual_type==='bigint'));
      assert(!JSON.stringify([...rows,...detail]).includes('synthetic-private-default-marker'));
    });
  });
  await test('D06 renamed indexes/constraints are strict mismatches pending structural comparison',async()=>{
    await mutate(c,`ALTER TABLE "Post" RENAME CONSTRAINT "Post_integrationId_fkey" TO diagnostic_renamed_fk;
      ALTER INDEX "Post_publishDate_idx" RENAME TO diagnostic_renamed_index`,async()=>{
      const rows=selects(await c.query(body(sql)))[1].rows;
      assert.deepEqual(rows,[{section:'constraints',object:'Post',status:'DIFFERENT'},{section:'indexes',object:'Post',status:'DIFFERENT'}]);
      for(const section of ['constraints','indexes']){
        const detail=selects(await c.query(body(targetedDetailQuery(contract,section,'Post'))))[0].rows;
        assert.equal(detail.length,2);assert.deepEqual(detail.map(r=>r.status).sort(),['EXTRA','MISSING']);
      }
    });
  });
  await test('D07 different database locale and instance OIDs do not change ordinary table/column hashes',async()=>{
    await c.query(`CREATE DATABASE locale_c TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    const other=await connect(url('locale_c'));await other.query(baseline);
    await other.query(diagnosticSettings.replaceAll('SET LOCAL','SET'));
    assert.deepEqual(changed(await hashes(other)),['database']);
    const rows=selects(await other.query(sql));assert.deepEqual(rows[1].rows,[]);
    assert.equal(rows[0].rows[0].actual_environment.collation,'C');
    // No catalog OIDs are included in any signature.
    assert.notEqual((await c.query('SELECT \'public."Post"\'::regclass::oid AS oid')).rows[0].oid,
      (await other.query('SELECT \'public."Post"\'::regclass::oid AS oid')).rows[0].oid);
  });
  const alternateSettings=`SET LOCAL DateStyle='German, DMY';SET LOCAL IntervalStyle='sql_standard';
    SET LOCAL TimeZone='America/Sao_Paulo';SET LOCAL extra_float_digits=-1;SET LOCAL standard_conforming_strings=off;`;
  await test('D08 current baseline signatures survive tested display-setting differences; diagnostics pin settings',async()=>{
    await mutate(c,alternateSettings,async()=>{
      assert.deepEqual(await hashes(c),expectedHashes);
      const data=selects(await c.query(body(sql)));
      assert.equal(data[0].rows[0].initial_session.DateStyle,'German, DMY');
      assert.deepEqual(data[1].rows,[]);
      assert.equal((await c.query(sessionContextSql)).rows[0].settings.TimeZone,'UTC');
    });
  });
  await test('D09 deparser text is not semantic equivalence; date/time defaults vary with display settings',async()=>{
    await mutate(c,`${diagnosticSettings}
      CREATE TABLE public.diagnostic_expression_probe(dt date DEFAULT DATE '2030-02-01',
       tz timestamptz DEFAULT TIMESTAMPTZ '2030-02-01 10:00:00+00',iv interval DEFAULT INTERVAL '2 months 3 days')`,async()=>{
      const canonical=await hashes(c);
      await c.query(alternateSettings);const alternate=await hashes(c);
      assert.notEqual(canonical.columns,alternate.columns);
      assert.equal(canonical.tables,alternate.tables);
      await c.query(diagnosticSettings);assert.deepEqual(await hashes(c),canonical);
    });
  });
  await test('D10 extra views/routines are located without exporting definitions or function bodies',async()=>{
    await mutate(c,`CREATE VIEW public.diagnostic_extra_view AS SELECT 1 AS v;
      CREATE FUNCTION public.diagnostic_extra_routine() RETURNS text LANGUAGE sql
       AS $$ SELECT 'synthetic-private-function-marker'::text $$`,async()=>{
      const rows=selects(await c.query(body(sql)))[1].rows;
      assert.deepEqual(rows,[{section:'extras',object:'diagnostic_extra_routine',status:'EXTRA'},
        {section:'extras',object:'diagnostic_extra_view',status:'EXTRA'}]);
      assert(!JSON.stringify(rows).includes('synthetic-private-function-marker'));
    });
  });
  await test('D11 consolidated locate and targeted detail run read-only without SELECT on application tables',async()=>{
    await c.query("CREATE ROLE diagnostic_auditor LOGIN PASSWORD 'synthetic-audit-only'");
    const other=await connect(url('reference'),'diagnostic_auditor','synthetic-audit-only');
    assert.equal((await other.query(`SELECT has_table_privilege(current_user,'public."Post"','SELECT') AS ok`)).rows[0].ok,false);
    assert.deepEqual(selects(await other.query(sql))[1].rows,[]);
    for(const section of ['tables','columns','constraints','indexes']){
      assert.deepEqual(selects(await other.query(targetedDetailQuery(contract,section,'Post')))[0].rows,[]);
    }
    await other.query('BEGIN READ ONLY');
    await assert.rejects(other.query('CREATE TABLE public.must_not_exist(id integer)'),e=>e.code==='25006');await other.query('ROLLBACK');
    const probe=sql.replace('SELECT section,object,status FROM differences ORDER BY priority,object COLLATE "C";',
      `SELECT current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation,
       current_setting('statement_timeout') AS timeout,current_setting('lock_timeout') AS lock_timeout;`);
    assert.deepEqual(selects(await other.query(probe))[1].rows,[{readonly:'on',isolation:'repeatable read',timeout:'10s',lock_timeout:'2s'}]);
  });
  await test('D12 context flags missing public USAGE; visibility is not silently treated as schema equivalence',async()=>{
    await c.query('REVOKE USAGE ON SCHEMA public FROM PUBLIC');
    try{
      const other=await connect(url('reference'),'diagnostic_auditor','synthetic-audit-only');
      const data=selects(await other.query(sql));
      assert.equal(data[0].rows[0].initial_session.has_public_usage,false);
    }finally{await c.query('GRANT USAGE ON SCHEMA public TO PUBLIC')}
  });
  assert.equal(sha(fs.readFileSync(baselinePath)),report.baselineSha256AtReport);
  assert.equal(sha(fs.readFileSync(path.join(audit,'production-check.sql'))),report.localArtifactSha256AtReport);
  assert.deepEqual(connectionErrors,[]);
  fs.writeFileSync(path.join(audit,'diagnostic-results.json'),JSON.stringify({
    status:'LOCAL_FOLLOWUP_DIAGNOSTICS_VALIDATED',postgres:'17.11',baselineUnchanged:true,originalCheckUnchanged:true,
    followupSqlSha256:sha(fs.readFileSync(path.join(audit,'production-locate.sql'))),
    productionCompatibility:'BLOCKED_PENDING_LOCATE_RESULTS',results,
  },null,2)+'\n');
  console.log(JSON.stringify({tests:results.length,status:'PASS',production:'UNCHANGED'}));
}finally{
  await Promise.allSettled(clients.map(c=>c.end()));
  if(container){assert.equal(docker(['inspect','--format','{{ index .Config.Labels "trendpostiz.baseline.diagnostics" }}',container]),label);docker(['rm','--force',container]);}
  if(network){assert.equal(docker(['network','inspect','--format','{{ index .Labels "trendpostiz.baseline.diagnostics" }}',network]),label);docker(['network','rm',network]);}
}
