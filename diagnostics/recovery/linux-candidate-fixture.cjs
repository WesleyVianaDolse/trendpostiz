// Real compiled NestJS image, actual native workers/providers. No module hooks
// or synthetic activities are installed inside the image. Namespace is empty.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{generateKeyPairSync,sign,randomUUID}=require('node:crypto');
const [root,url,address,pg,temporal]=process.argv.slice(2);assert.equal(new URL(url).hostname,'127.0.0.1');assert.equal(new URL(url).pathname,'/guard_test');
const label='linux-admission-'+randomUUID(),labelKey='trendpostiz.recovery-admission',owned=[],results=[];let network,worker,e;
const docker=args=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,(r.stderr||r.stdout).slice(-5000));return (args[0]==='logs'?r.stdout+r.stderr:r.stdout).trim();};
const pause=ms=>new Promise(r=>setTimeout(r,ms));const test=async(id,fn)=>{await fn();results.push({id,result:'PASS'});console.log('PASS',id);};
const run=args=>{const id=docker(['run','--detach','--label',labelKey+'='+label,...args]);owned.push(id);return id;};
(async()=>{try{
 assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^(npipe|unix):\/\//);
 assert.match(docker(['inspect','--format','{{ index .Config.Labels "trendpostiz.recovery-temporal" }}',pg]),/^recovery-temporal-/);
 assert.equal(docker(['inspect','--format','{{ index .Config.Labels "trendpostiz.recovery-temporal" }}',pg]),docker(['inspect','--format','{{ index .Config.Labels "trendpostiz.recovery-temporal" }}',temporal]));
 const info=JSON.parse(fs.readFileSync(path.join(root,'diagnostics/recovery/linux-candidate-image.json'),'utf8'));
 const image=docker(['image','inspect',info.tag,'--format','{{.Id}}']);assert.match(image,/^sha256:[a-f0-9]{64}$/);
 const probe=run(['--network','none','--read-only','--tmpfs','/tmp','--tmpfs','/uploads:uid=1000,gid=1000',image]);
 await test('L01 unsigned candidate exits 78 without starting consumers',async()=>{
  assert.equal(docker(['wait',probe]),'78');assert.match(docker(['logs',probe]),/SIGNED_WORKER_ADMISSION_REFUSED/);
 });
 const artifactFile=path.join(process.cwd(),'worker-artifact.json');docker(['cp',probe+':/app/worker-artifact.json',artifactFile]);const artifact=JSON.parse(fs.readFileSync(artifactFile,'utf8'));
 const catalogText=docker(['run','--rm','--network','none','--entrypoint','node',image,'--experimental-require-module','-e',"const s=require('./dist/libraries/nestjs-libraries/src/integrations/integration.manager.js').socialIntegrationList;console.log(JSON.stringify(['main',...s.filter(p=>!p.identifier.includes('-')).map(p=>p.identifier)]))"]);
 const queues=JSON.parse(catalogText.split('\n').at(-1));assert(queues.length>=32);
 await test('L02 runtime rejects old protocol and altered artifact without relying on flags',async()=>{
  const output=docker(['run','--rm','--network','none','--entrypoint','node',image,'-e',"const fs=require('fs'),a=JSON.parse(fs.readFileSync('worker-artifact.json')),v=require('./scripts/recovery/runtime-artifact.cjs'),assert=require('assert');for(const p of [{protocol:1},{sourceDigest:'old'},{files:[]}])assert.throws(()=>v.verify(process.cwd(),{...a,...p}));console.log('rejected')"]);assert.match(output,/rejected/);
 });
 await test('L02b quarantined consumer without application guards cannot reach Temporal',async()=>{
  const interfaces=JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Networks}}',temporal])),ip=Object.values(interfaces)[0].IPAddress;assert.match(ip,/^172\./);
  const output=docker(['run','--rm','--label',labelKey+'='+label,'--network','none','--entrypoint','node',image,'-e',"const net=require('net'),s=net.connect({host:"+JSON.stringify(ip)+",port:7233});s.setTimeout(800);s.on('connect',()=>process.exit(1));s.on('error',()=>{console.log('blocked');process.exit(0)});s.on('timeout',()=>{s.destroy();console.log('blocked');process.exit(0)})"]);assert.match(output,/blocked/);
 });
 network=docker(['network','create','--internal','--label',labelKey+'='+label,label]);
 docker(['network','connect','--alias','postgres',network,pg]);docker(['network','connect','--alias','temporal',network,temporal]);
 const redis=run(['--name',label+'-redis','--network',network,'--network-alias','redis','redis:7.2']);
 const keys=generateKeyPairSync('ed25519'),keyFile=path.join(process.cwd(),'authority.pem');fs.writeFileSync(keyFile,keys.publicKey.export({type:'spki',format:'pem'}));process.env.RECOVERY_APPROVAL_PUBLIC_KEY_FILE=keyFile;
 e=require('./fg-fixture-support.cjs')(root,url,'http://127.0.0.1:1');const {db,get,req}=e;
 const {Connection,Client}=req('@temporalio/client'),connection=await Connection.connect({address}),client=new Client({connection,namespace:'default'});
 const {captureRecoveryInventory}=get('automation-recovery/recovery-inventory-source'),{inventoryHash}=get('automation-recovery/recovery-inventory');
 const {RecoveryManifestService}=get('automation-recovery/recovery-manifest.service'),{RecoveryApplicationService,applicationArtifactHash}=get('automation-recovery/recovery-application.service');
 await db.user.create({data:{id:'operator',email:'operator@example.test',providerName:'LOCAL',timezone:0,isSuperAdmin:true}});await db.organization.create({data:{id:'org-linux',name:'Synthetic image validation'}});
 await db.automationRecoveryDecision.create({data:{recoveryId:'lab-seal',organizationId:'__lab__',subjectKey:'environment:'+label,action:'ISOLATED_LAB',reason:'Owned Docker containers and internal network verified by local controller'}});
 const source=await captureRecoveryInventory(db,client,['org-linux'],queues),cutoff=new Date(Date.now()-100),manifest=new RecoveryManifestService(db),app=new RecoveryApplicationService(db,e.scheduling);
 const m=await manifest.draft('operator','linux-run',cutoff,source);assert((await manifest.revalidate('operator',m.id,source,cutoff)).matches);assert.equal(m.itemCount,0);
 const approval={purpose:'RECOVERY_APPROVAL',contractProtocol:2,recoveryProtocol:1,workerProtocol:2,scope:'ISOLATED_LAB',authorizationId:'linux-authorization',manifestId:m.id,manifestHash:m.manifestHash,inventoryHash:m.sourceHash,inventoryVersion:m.version,recoveryId:'linux-run',cutoffAt:cutoff.toISOString(),resumeNotAfter:new Date(+cutoff+30000).toISOString(),generation:1,planHash:inventoryHash([]),sourceDigest:artifact.sourceDigest,imageDigest:image,containment:{kind:'OWNED_ISOLATED_LAB',environmentId:label,evidenceDigest:inventoryHash({network,pg,temporal,redis,isolated:true})},approvedById:'operator',validUntil:new Date(Date.now()+3600000).toISOString(),temporalAddress:'temporal:7233',namespace:'default',queues};approval.containmentHash=inventoryHash(approval.containment);
 approval.applicationDigest=applicationArtifactHash();
 const signature=p=>sign(null,Buffer.from(inventoryHash(p)),keys.privateKey).toString('base64');await app.approve('operator',approval,signature(approval),source,[]);await app.applyBatch('operator','linux-authorization');
 const a=await db.recoveryAuthorization.findUnique({where:{id:'linux-authorization'}}),fresh=await captureRecoveryInventory(db,client,['org-linux'],queues);
 const ticket={purpose:'WORKER_ADMISSION',contractProtocol:2,scope:'ISOLATED_LAB',authorizationId:a.id,approvalHash:inventoryHash(approval),applicationHash:a.resultHash,expectedDbHash:a.expectedDbHash,cutoffAt:approval.cutoffAt,resumeNotAfter:approval.resumeNotAfter,generation:1,sourceDigest:artifact.sourceDigest,imageDigest:image,containmentHash:approval.containmentHash,temporalHash:inventoryHash({workflows:fresh.workflows,queues:fresh.queues,warnings:fresh.warnings}),validUntil:approval.validUntil};
 await app.admit('operator',a.id,ticket,signature(ticket),fresh);
 worker=run(['--name',label+'-worker','--network',network,'--read-only','--tmpfs','/tmp','--tmpfs','/uploads:uid=1000,gid=1000','--mount','type=bind,source='+keyFile+',target=/run/recovery/public.pem,readonly',
  '-e','DATABASE_URL=postgresql://guard_test:synthetic-only@postgres:5432/guard_test','-e','REDIS_URL=redis://redis:6379','-e','TEMPORAL_ADDRESS=temporal:7233','-e','TEMPORAL_NAMESPACE=default','-e','RECOVERY_IMAGE_DIGEST='+image,'-e','RECOVERY_APPROVAL_PUBLIC_KEY_FILE=/run/recovery/public.pem','-e','JWT_SECRET=synthetic-only','-e','OPENAI_API_KEY=synthetic-only','-e','FRONTEND_URL=http://127.0.0.1:4200','-e','BACKEND_INTERNAL_URL=http://127.0.0.1:3000','-e','RUN_CRON=false',image]);
 let health;
 await test('L03 real compiled NestJS starts every expected native worker and reports readiness',async()=>{
  const started=Date.now();while(Date.now()-started<180000){const state=docker(['inspect','--format','{{.State.Status}}',worker]);if(state==='exited')throw Error(docker(['logs',worker]).slice(-12000));
   const r=spawnSync('docker',['exec',worker,'node','-e',"fetch('http://127.0.0.1:3002/health/status').then(async r=>{console.log(JSON.stringify({status:r.status,body:await r.json()}));if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],{encoding:'utf8',windowsHide:true});if(r.status===0){health=JSON.parse(r.stdout.trim());break;}await pause(1000);}
  assert(health,'Readiness deadline');assert.equal(health.status,200);assert.deepEqual(health.body.workers.map(w=>w.taskQueue).sort(),[...queues].sort());
  assert.equal(docker(['inspect','--format','{{.Image}}',worker]),image);
 });
 await test('L04 all workflow/activity queues have actual pollers; liveness and isolation hold',async()=>{
  for(const name of queues)for(const kind of [1,2]){const q=await client.workflowService.describeTaskQueue({namespace:'default',taskQueue:{name},taskQueueType:kind});assert(q.pollers.length,'Missing poller '+name+'/'+kind);}
  assert.match(docker(['exec',worker,'node','-e',"fetch('http://127.0.0.1:3002/health/live').then(async r=>{if(r.status!==200)process.exit(1);console.log((await r.json()).status)})"]),/alive/);
  assert.equal(docker(['network','inspect','--format','{{.Internal}}',network]),'true');
 });
 await test('L05 revocation fails readiness and an old admission cannot restart the process',async()=>{
  await db.recoveryAuthorization.update({where:{id:a.id},data:{phase:'REVOKED'}});
  const r=spawnSync('docker',['exec',worker,'node','-e',"fetch('http://127.0.0.1:3002/health/status').then(r=>{console.log(r.status);if(r.status!==503)process.exit(1)})"],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0);assert.match(r.stdout,/503/);
  const replay=run(['--network',network,'--read-only','--tmpfs','/tmp','--tmpfs','/uploads:uid=1000,gid=1000','--mount','type=bind,source='+keyFile+',target=/run/recovery/public.pem,readonly','-e','DATABASE_URL=postgresql://guard_test:synthetic-only@postgres:5432/guard_test','-e','TEMPORAL_ADDRESS=temporal:7233','-e','RECOVERY_IMAGE_DIGEST='+image,'-e','RECOVERY_APPROVAL_PUBLIC_KEY_FILE=/run/recovery/public.pem',image]);
  assert.equal(docker(['wait',replay]),'78');
  // The observer is never asked to restart it; the normal entrypoint remains closed.
 });
 await connection.close();
 fs.writeFileSync(path.join(root,'diagnostics/recovery/linux-candidate-results.json'),JSON.stringify({scope:'ISOLATED_REAL_LINUX_IMAGE',results,imageDigest:image,buildManifestDigest:info.imageDigest,sourceDigest:artifact.sourceDigest,queues,actualWorkflowPollers:queues.length,actualActivityPollers:queues.length,realCompiledNestJS:true,nativeLibrariesVerified:true,readiness:health,productionInfrastructureVerified:false,operationalR28Certified:false,productionAuthorized:false},null,2)+'\n');
 console.log(JSON.stringify({checks:results.length,workers:queues.length,imageDigest:image,operationalR28Certified:false}));
}finally{await e?.db.$disconnect();for(const id of owned.reverse()){assert.equal(docker(['inspect','--format','{{ index .Config.Labels "'+labelKey+'" }}',id]),label);docker(['rm','--force',id]);}
 if(network){for(const id of [pg,temporal])docker(['network','disconnect',network,id]);assert.equal(docker(['network','inspect','--format','{{ index .Labels "'+labelKey+'" }}',network]),label);docker(['network','rm',network]);}
}})().catch(error=>{console.error(error);process.exitCode=1;});
