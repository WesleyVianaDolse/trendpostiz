const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),http=require('node:http');
const {generateKeyPairSync,sign,randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const [root,url,address]=process.argv.slice(2);assert.equal(new URL(url).hostname,'127.0.0.1');assert.equal(new URL(url).pathname,'/guard_test');
let server,e,client,conn,native;const workers=[],runs=[],results=[],calls=[];const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function test(id,fn){await fn();results.push({id,result:'PASS'});console.log('PASS',id);}
(async()=>{try{
 server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);calls.push({path:req.url,body});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url.startsWith('/publication')?[{id:body.id,postId:'remote-'+body.id,releaseURL:'https://example.test/'+body.id,status:'posted'}]:{accepted:true}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const endpoint='http://127.0.0.1:'+server.address().port;
 e=require('./fg-fixture-support.cjs')(root,url,endpoint);const {db,get,req}=e;
 const {Client,Connection}=req('@temporalio/client'),{NativeConnection,Worker,bundleWorkflowCode,Runtime,DefaultLogger}=req('@temporalio/worker');Runtime.install({logger:new DefaultLogger('ERROR')});
 conn=await Connection.connect({address});client=new Client({connection:conn,namespace:'default'});e.setClient(client);native=await NativeConnection.connect({address});
 await conn.operatorService.addSearchAttributes({namespace:'default',searchAttributes:{organizationId:1,postId:1}});
 const {inventoryHash,uncertainLegacySlot,classifyRecoveryInventory}=get('automation-recovery/recovery-inventory'),{captureRecoveryInventory}=get('automation-recovery/recovery-inventory-source');
 const {RecoveryManifestService}=get('automation-recovery/recovery-manifest.service'),{RecoveryApplicationService,databaseInventoryHash,applicationArtifactHash}=get('automation-recovery/recovery-application.service');
 const {publicationRequestHash}=get('automation-recovery/recovery-policy');
 const keys=generateKeyPairSync('ed25519'),keyFile=path.join(process.cwd(),'handoff-public.pem');fs.writeFileSync(keyFile,keys.publicKey.export({type:'spki',format:'pem'}));process.env.RECOVERY_APPROVAL_PUBLIC_KEY_FILE=keyFile;
 const signature=p=>sign(null,Buffer.from(inventoryHash(p)),keys.privateKey).toString('base64');
 await db.user.create({data:{id:'operator',email:'operator@example.test',timezone:0,providerName:'LOCAL',isSuperAdmin:true}});
 await db.organization.create({data:{id:'org',name:'Synthetic recovery'}});
 await db.integration.create({data:{id:'integration',organizationId:'org',providerIdentifier:'threads',internalId:'synthetic',name:'Synthetic',type:'social',token:'synthetic-only'}});
 await db.integration.create({data:{id:'legacy-integration',organizationId:'org',providerIdentifier:'threads',internalId:'legacy-synthetic',name:'Synthetic legacy',type:'social',token:'synthetic-only'}});
 const cutoff=new Date(Date.now()+60000),queues=['main','instagram','facebook','threads'];
 const createPost=(id,at,extra={})=>db.post.create({data:{id,organizationId:'org',integrationId:'integration',group:id,content:'Synthetic',image:'[]',settings:'{}',state:'QUEUE',scheduleRevision:1,publishDate:at,...extra}});
 const occurrence=(p,id)=>db.publicationOccurrence.create({data:{id,organizationId:'org',postId:p.id,scheduleRevision:p.scheduleRevision,scheduledAt:p.publishDate,groupSnapshot:p.group}});
 const expired=await createPost('expired',new Date(+cutoff-1));await occurrence(expired,'old-occ');
 const future=await createPost('future',new Date(+cutoff+1),{integrationId:'legacy-integration'});await occurrence(future,'future-occ');
 const abandoned=await createPost('legacy-now',new Date(+cutoff+3),{integrationId:'legacy-integration',scheduleRevision:0});await occurrence(abandoned,'noncanonical-root');
 const thread=await createPost('legacy-thread',abandoned.publishDate,{integrationId:'legacy-integration',scheduleRevision:0,parentPostId:abandoned.id,group:abandoned.group,delay:0});await occurrence(thread,'noncanonical-child');
 const oldNow=await client.workflow.start('postWorkflowV105',{workflowId:'legacy-post-now',taskQueue:'main',args:[{postId:abandoned.id,organizationId:'org',taskQueue:'threads',postNow:true}],workflowExecutionTimeout:'4 minutes'});
 await db.publicationScheduleIntent.create({data:{occurrenceId:'noncanonical-root',organizationId:'org',workflowId:oldNow.workflowId,generation:0,source:'LEGACY_REVIEW',snapshot:{integrationId:'legacy-integration',members:[abandoned,thread].map(p=>({id:p.id,group:p.group,publishDate:p.publishDate.toISOString(),scheduleRevision:p.scheduleRevision,scheduledAt:p.publishDate.toISOString()}))}}});
 await createPost('replacement',new Date(+cutoff+2));
 const series=await createPost('series',new Date(+cutoff-3*86400000),{intervalInDays:1});await occurrence(series,'series-old');
 await db.publicationScheduleIntent.create({data:{occurrenceId:'series-old',organizationId:'org',workflowId:'prior-series',generation:0,snapshot:{},source:'PREVIOUS_REVIEW',seriesAnchor:series.publishDate,intervalDays:1}});
 await db.plugs.create({data:{id:'plug',organizationId:'org',integrationId:'integration',plugFunction:'autoPlugPost',data:'{"configuration":"preserved"}'}});
 e.manager.getAllPlugs=()=>[{identifier:'threads',plugs:[{methodName:'autoPlugPost',runEveryMilliseconds:1000,totalRuns:2}]}];
 const uncertain=await createPost('uncertain',new Date(+cutoff-1));await occurrence(uncertain,'uncertain-occ');
 await db.automationEffectAttempt.create({data:{id:'unknown-attempt',organizationId:'org',subjectKey:'occurrence:uncertain-occ',actionKey:'publication:uncertain',occurrenceId:'uncertain-occ',postId:'uncertain',requestHash:'unknown',claimId:'unknown',generation:0,phase:'UNCERTAIN'}});
 const manual=await createPost('manual',new Date(+cutoff-1));await occurrence(manual,'manual-occ');await db.publicationEvidence.create({data:{organizationId:'org',occurrenceId:'manual-occ',origin:'manual',remoteId:'manual-proof',confirmedById:'operator'}});
 await db.instagramWebhookEvent.create({data:{id:'old-comment',integrationId:'integration',instagramAccountId:'synthetic',commentText:'Synthetic',status:'RECEIVED',payload:{},receivedAt:new Date(+cutoff-1000)}});
 const legacy=await client.workflow.start('postWorkflowV105',{workflowId:'legacy-future',taskQueue:'main',args:[{postId:future.id,organizationId:'org',taskQueue:'threads',postNow:false}],workflowExecutionTimeout:'4 minutes'});
 const context={workflowId:legacy.workflowId,runId:legacy.firstExecutionRunId,protocolVersion:1,organizationId:'org',integrationId:'legacy-integration',snapshots:[future],actionKey:'publication:future',plannedAt:future.publishDate};
 await db.automationWorkflowBinding.create({data:{workflowId:context.workflowId,runId:context.runId,organizationId:'org',occurrenceId:'future-occ',actionKey:context.actionKey,expectedRequestHash:publicationRequestHash(context)}});
 const capture=()=>captureRecoveryInventory(db,client,['org'],queues);
 const source=await capture(),manifests=new RecoveryManifestService(db),application=new RecoveryApplicationService(db,e.scheduling);
 await test('R14 pre-ledger started remote work is retained; only a proven different slot is excluded',async()=>{
  const uncertain=JSON.parse(JSON.stringify(source));uncertain.workflows.find(w=>w.workflowId==='legacy-future').pendingActivities=[{type:'postSocial',state:2,lastStartedAt:new Date().toISOString()}];
  assert(uncertainLegacySlot(uncertain,'future',future.publishDate));
  assert.equal(classifyRecoveryInventory(uncertain,cutoff).find(i=>i.subjectKey==='occurrence:future-occ').decision,'RETAIN');
  assert(!uncertainLegacySlot(uncertain,'future',new Date(+future.publishDate+86400000)));
  uncertain.tables.automationWorkflowBinding=[];uncertain.workflows.find(w=>w.workflowId==='legacy-future').input.postNow=true;
  assert(uncertainLegacySlot(uncertain,'future',new Date(+future.publishDate+86400000)));
 });
 const m=await manifests.draft('operator','handoff',cutoff,source);assert((await manifests.revalidate('operator',m.id,source,cutoff)).matches);
 const plan=m.items.map(i=>({ordinal:i.ordinal,mode:'APPLY',...(i.subjectKey==='post:replacement'?{future:{scheduledAt:new Date(+cutoff+2).toISOString(),anchor:new Date(+cutoff+2).toISOString()}}:{}),...(i.subjectKey==='occurrence:noncanonical-root'?{future:{scheduledAt:abandoned.publishDate.toISOString(),anchor:abandoned.publishDate.toISOString()}}:{}),...(i.subjectKey.startsWith('series:series:')?{future:{scheduledAt:i.metadata.nextScheduledAt,anchor:i.metadata.anchor}}:{}),...(i.subjectKey.startsWith('workflow:legacy-future:')?{bindings:[context]}:{})}));
 const approval={purpose:'RECOVERY_APPROVAL',contractProtocol:2,recoveryProtocol:1,workerProtocol:2,scope:'ISOLATED_LAB',authorizationId:'authorization',manifestId:m.id,manifestHash:m.manifestHash,inventoryHash:m.sourceHash,inventoryVersion:m.version,recoveryId:'handoff',cutoffAt:cutoff.toISOString(),resumeNotAfter:new Date(+cutoff+30000).toISOString(),generation:1,planHash:inventoryHash(plan),sourceDigest:'a'.repeat(64),imageDigest:'sha256:'+'b'.repeat(64),containment:{kind:'OWNED_ISOLATED_LAB',environmentId:randomUUID(),evidenceDigest:'c'.repeat(64)},approvedById:'operator',validUntil:new Date(Date.now()+3600000).toISOString(),temporalAddress:address,namespace:'default',queues};approval.containmentHash=inventoryHash(approval.containment);
 approval.applicationDigest=applicationArtifactHash();
 await test('R04 changed signature, cutoff, generation, artifact, inventory and containment cannot approve',async()=>{
  for(const patch of [{cutoffAt:new Date(+cutoff-1).toISOString()},{generation:2},{sourceDigest:'c'.repeat(64)},{inventoryHash:'d'.repeat(64)},{inventoryVersion:99},{workerProtocol:1},{containmentHash:'e'.repeat(64)}])await assert.rejects(application.approve('operator',{...approval,...patch},signature(approval),source,plan));
  assert.equal(await db.recoveryAuthorization.count(),0);
  const wrong={...approval,applicationDigest:'0'.repeat(64)};await assert.rejects(application.approve('operator',wrong,signature(wrong),source,plan),e=>e.reason==='APPLICATION_ARTIFACT_CHANGED');
 });
 await application.approve('operator',approval,signature(approval),source,plan);
 await test('R04 approval alone and altered OPEN flags cannot authorize any publication',async()=>{
  await db.automationRecoveryControl.update({where:{id:'global'},data:{phase:'OPEN',runId:'handoff',generation:1}});
  await assert.rejects(e.recovery.withOpenPolicy(async()=>true));
  await db.automationRecoveryControl.update({where:{id:'global'},data:{phase:'BLOCKED',runId:null,generation:0}});
 });
 await test('R14 changed source prevents a batch without moving cursor',async()=>{
  await db.post.update({where:{id:'future'},data:{content:'Changed'}});await assert.rejects(application.applyBatch('operator','authorization',1));
  assert.equal((await db.recoveryAuthorization.findUnique({where:{id:'authorization'}})).cursor,0);await db.post.update({where:{id:'future'},data:{content:'Synthetic',updatedAt:source.tables.post.find(p=>p.id==='future').updatedAt}});
 });
 for(const mode of ['before','after'])await test('R14 actual process crash '+mode+' commit preserves atomic cursor and decisions',async()=>{
  const child=spawn(process.execPath,[path.join(root,'diagnostics/recovery/handoff-crash-child.cjs'),root,url,'authorization',mode,keyFile],{env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',b=>error+=b);
  const status=await new Promise((resolve,reject)=>{const t=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Application child deadline'));},180000);child.on('exit',c=>{clearTimeout(t);resolve(c);});});assert.equal(status,88,error.slice(0,500));
  const row=await db.recoveryAuthorization.findUnique({where:{id:'authorization'}});assert.equal(row.cursor,mode==='before'?0:1);assert.equal(await db.recoveryApplicationItem.count(),row.cursor);
 });
 await test('R14 concurrent batches resume without duplicate audit or effects',async()=>{
  for(;;){const row=await db.recoveryAuthorization.findUnique({where:{id:'authorization'}});if(row.phase==='APPLIED')break;
   const result=await Promise.allSettled([application.applyBatch('operator','authorization',2),application.applyBatch('operator','authorization',2)]);assert(result.some(r=>r.status==='fulfilled'));}
  const before=await db.recoveryApplicationItem.count();await application.applyBatch('operator','authorization',2);assert.equal(await db.recoveryApplicationItem.count(),before);assert.equal(calls.length,0);
 });
 await test('R14 expiry, manual/unknown, future recurrence/config, legacy bindings and old comments survive application',async()=>{
  assert.equal((await db.post.findUnique({where:{id:'expired'}})).state,'ERROR');assert.equal((await db.publicationOccurrence.findUnique({where:{id:'old-occ'}})).outcome,'EXPIRED');
  assert.equal((await db.automationEffectAttempt.findUnique({where:{id:'unknown-attempt'}})).phase,'UNCERTAIN');assert.equal(await db.publicationEvidence.count({where:{origin:'manual',remoteId:'manual-proof'}}),1);
  assert.equal(await db.automationWorkflowBinding.count({where:{workflowId:'legacy-future'}}),1);
  assert.equal((await db.instagramWebhookEvent.findUnique({where:{id:'old-comment'}})).status,'SKIPPED');
  assert.equal((await db.plugs.findUnique({where:{id:'plug'}})).data,'{"configuration":"preserved"}');
  const actions=await db.publicationDerivedAction.findMany({where:{postId:'series'}});assert(actions.length);assert(actions.some(a=>a.schedule.every(s=>+new Date(s.scheduledAt)>=+cutoff)));
  assert.equal((await db.post.findUnique({where:{id:'series'}})).intervalInDays,1);
 });
 let applied=await db.recoveryAuthorization.findUnique({where:{id:'authorization'}}),fresh=await capture();
 const admission={purpose:'WORKER_ADMISSION',contractProtocol:2,scope:'ISOLATED_LAB',authorizationId:'authorization',approvalHash:inventoryHash(approval),applicationHash:applied.resultHash,expectedDbHash:applied.expectedDbHash,cutoffAt:approval.cutoffAt,resumeNotAfter:approval.resumeNotAfter,generation:1,sourceDigest:approval.sourceDigest,imageDigest:approval.imageDigest,containmentHash:approval.containmentHash,temporalHash:inventoryHash({workflows:fresh.workflows,queues:fresh.queues,warnings:fresh.warnings}),validUntil:approval.validUntil};
 await test('R04 admission rejects a valid signature bound to another application or artifact',async()=>{
  for(const patch of [{applicationHash:'c'.repeat(64)},{imageDigest:'sha256:'+'d'.repeat(64)},{generation:2},{cutoffAt:new Date(+cutoff-1).toISOString()}]){const p={...admission,...patch};await assert.rejects(application.admit('operator','authorization',p,signature(p),fresh));}
 });
 await test('R04 delayed resumption cannot reuse the previous cutoff even with a valid signature',async()=>{
  const now=Date.now;Date.now=()=>+cutoff+30001;try{await assert.rejects(application.admit('operator','authorization',admission,signature(admission),fresh));}finally{Date.now=now;}
  assert.equal((await db.automationRecoveryControl.findUnique({where:{id:'global'}})).phase,'BLOCKED');
 });
 while(Date.now()<+cutoff)await pause(Math.min(500,+cutoff-Date.now()));
 await application.admit('operator','authorization',admission,signature(admission),fresh);
 await test('R04 exact signed application admits the intended generation; audit tampering closes policy',async()=>{
  assert.equal((await e.recovery.withOpenPolicy(async(_tx,p)=>p)).generation,1);
  const first=await db.recoveryApplicationItem.findFirst({where:{authorizationId:'authorization'},orderBy:{ordinal:'asc'}});
  await db.recoveryApplicationItem.update({where:{authorizationId_ordinal:{authorizationId:'authorization',ordinal:first.ordinal}},data:{result:{outcome:'forged'}}});await assert.rejects(e.recovery.withOpenPolicy(async()=>true));
  await db.recoveryApplicationItem.update({where:{authorizationId_ordinal:{authorizationId:'authorization',ordinal:first.ordinal}},data:{result:first.result}});
 });
 await test('R04 second recovery supersedes the previous signed epoch and blocks flag rollback',async()=>{
  await db.automationRecoveryControl.update({where:{id:'global'},data:{phase:'BLOCKED'}});
  const cut2=new Date(+cutoff+1),source2=await capture(),m2=await manifests.draft('operator','handoff-2',cut2,source2);
  assert((await manifests.revalidate('operator',m2.id,source2,cut2)).matches);
  const plan2=m2.items.map(i=>({ordinal:i.ordinal,mode:'APPLY',...(i.subjectKey.startsWith('series:series:')?{future:{scheduledAt:i.metadata.nextScheduledAt,anchor:i.metadata.anchor}}:{}),...(i.subjectKey.startsWith('workflow:legacy-future:')?{bindings:[context]}:{})}));
  const p2={...approval,authorizationId:'authorization-2',manifestId:m2.id,manifestHash:m2.manifestHash,inventoryHash:m2.sourceHash,inventoryVersion:m2.version,recoveryId:'handoff-2',cutoffAt:cut2.toISOString(),resumeNotAfter:new Date(+cut2+30000).toISOString(),generation:2,planHash:inventoryHash(plan2)};
  await application.approve('operator',p2,signature(p2),source2,plan2);
  while(!(await application.applyBatch('operator','authorization-2',50)).complete){}
  await db.automationRecoveryControl.update({where:{id:'global'},data:{phase:'OPEN',runId:'handoff',generation:1}});
  await assert.rejects(e.recovery.withOpenPolicy(async()=>true),e=>e.reason==='RECOVERY_GENERATION_ROLLBACK');
  await db.automationRecoveryControl.update({where:{id:'global'},data:{phase:'BLOCKED'}});
  const a2=await db.recoveryAuthorization.findUnique({where:{id:'authorization-2'}}),fresh2=await capture();
  const t2={...admission,authorizationId:a2.id,approvalHash:inventoryHash(p2),applicationHash:a2.resultHash,expectedDbHash:a2.expectedDbHash,cutoffAt:p2.cutoffAt,resumeNotAfter:p2.resumeNotAfter,generation:2,temporalHash:inventoryHash({workflows:fresh2.workflows,queues:fresh2.queues,warnings:fresh2.warnings})};
  await application.admit('operator',a2.id,t2,signature(t2),fresh2);
  assert.equal((await e.recovery.withOpenPolicy(async(_tx,p)=>p)).generation,2);
 });
 await test('R14 preserved legacy future and prepared V106 occurrence publish once after admission',async()=>{
  const bundle=await bundleWorkflowCode({workflowsPath:path.join(root,'diagnostics/recovery/fixture-workflows.ts'),webpackConfigHook:config=>{config.resolve.alias={...config.resolve.alias,...Object.fromEntries(Object.entries(e.aliases).map(([k,v])=>[k.slice(0,-1),path.join(root,v)]))};for(const r of config.module.rules||[])for(const l of Array.isArray(r.use)?r.use:[r.use])if(l&&typeof l==='object'&&String(l.loader).includes('swc-loader'))l.options={...l.options,swcrc:false,configFile:false};return config;}});
  for(const queue of ['main','threads']){const w=await Worker.create({connection:native,namespace:'default',taskQueue:queue,workflowBundle:bundle,activities:e.activities,maxCachedWorkflows:8,workflowThreadPoolSize:1});workers.push(w);runs.push(w.run());}
  await legacy.result();
  const all=await db.publicationScheduleIntent.findMany({where:{source:'APPROVED_RECOVERY'}});
  const replacement=await db.publicationOccurrence.findFirst({where:{postId:'replacement'}}),item=all.find(i=>i.occurrenceId===replacement.id);
  const h=await client.workflow.start('postWorkflowV106',{workflowId:item.workflowId,taskQueue:'main',args:[{organizationId:'org',occurrenceId:replacement.id,workflowId:item.workflowId,scheduledAt:replacement.scheduledAt.toISOString(),taskQueue:'threads'}],workflowExecutionTimeout:'1 minute'});await h.result();
  const restored=await db.publicationScheduleIntent.findUniqueOrThrow({where:{occurrenceId:'noncanonical-root'}});
  const next=await client.workflow.start('postWorkflowV106',{workflowId:restored.workflowId,taskQueue:'main',args:[{organizationId:'org',occurrenceId:'noncanonical-root',workflowId:restored.workflowId,scheduledAt:abandoned.publishDate.toISOString(),taskQueue:'threads'}],workflowExecutionTimeout:'1 minute'});await next.result();await oldNow.result().catch(()=>undefined);
  assert.equal(calls.filter(c=>c.path.startsWith('/publication')&&c.body.id==='future').length,1);assert.equal(calls.filter(c=>c.path.startsWith('/publication')&&c.body.id==='replacement').length,1);assert.equal(calls.filter(c=>c.body.id==='expired'||c.body.id==='uncertain'||c.body.id==='manual').length,0);
  assert.equal(calls.filter(c=>c.path.startsWith('/publication')&&c.body.id==='legacy-now').length,1);assert.equal(calls.filter(c=>c.path.startsWith('/publication')&&c.body.id==='legacy-thread').length,1);
  assert.equal((await db.post.findUnique({where:{id:'future'}})).state,'PUBLISHED');assert.equal((await db.publicationOccurrence.findUnique({where:{id:'noncanonical-child'}})).outcome,'CONFIRMED');
  assert(await db.automationRecoveryDecision.findFirst({where:{subjectKey:`workflow:${oldNow.workflowId}:${oldNow.firstExecutionRunId}`,action:'HOLD_WORKFLOW'}}));
  assert((await db.recoveryApplicationItem.findMany({where:{authorizationId:'authorization'}})).some(r=>r.result.priorIntent?.workflowId===oldNow.workflowId));
  for(const handle of [legacy,h,next,oldNow])await Worker.runReplayHistory({workflowBundle:bundle},await handle.fetchHistory(),handle.workflowId);
 });
 fs.writeFileSync(path.join(root,'diagnostics/recovery/handoff-recovery-results.json'),JSON.stringify({scope:'ISOLATED_R04_R14',results,checks:results.length,httpCalls:calls.length,productionAuthorized:false,operationalR28Certified:false},null,2)+'\n');
 console.log(JSON.stringify({checks:results.length,passed:results.length,productionAuthorized:false}));
}finally{for(const w of workers)w.shutdown();await Promise.allSettled(runs);await native?.close();await conn?.close();await e?.db.$disconnect();if(server)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
