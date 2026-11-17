// Initial authorized-state fixture only. Operational transitions are tested by
// handoff-recovery-fixture with the real approver/applicator/admission methods.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {generateKeyPairSync,sign,randomUUID}=require('node:crypto');
let keys;
module.exports=async function(db,url){
 const endpoint=new URL(url);assert.equal(endpoint.hostname,'127.0.0.1');assert.equal(endpoint.pathname,'/guard_test');assert.equal(endpoint.username,'guard_test');
 const {inventoryHash}=require('../../libraries/nestjs-libraries/src/automation-recovery/recovery-inventory.ts');
 const {authorityHash}=require('../../libraries/nestjs-libraries/src/automation-recovery/recovery-approval.ts');
 if(!keys){keys=generateKeyPairSync('ed25519');const file=path.join(os.tmpdir(),'recovery-fixture-public-'+randomUUID()+'.pem');fs.writeFileSync(file,keys.publicKey.export({type:'spki',format:'pem'}));process.env.RECOVERY_APPROVAL_PUBLIC_KEY_FILE=file;}
 const control=await db.automationRecoveryControl.findUniqueOrThrow({where:{id:'global'}}),run=await db.automationRecoveryRun.findUniqueOrThrow({where:{id:control.runId}});
 const actor='signed-fixture-operator';await db.user.upsert({where:{id:actor},create:{id:actor,email:'signed-fixture@example.test',providerName:'LOCAL',timezone:0,isSuperAdmin:true},update:{}});
 const scope=(await db.organization.findMany({select:{id:true}})).map(o=>o.id).sort(),source={scope,tables:{},workflows:[],queues:[],warnings:[]},sourceHash=inventoryHash(source),id=inventoryHash([run.id,+run.cutoffAt,control.generation]);
 const prior=await db.recoveryManifest.findUnique({where:{id}}),version=prior?.version||((await db.recoveryManifest.count({where:{recoveryId:run.id}}))+1);
 const manifestHash=inventoryHash({id,cutoffAt:run.cutoffAt,scope,sourceHash,items:[]});
 await db.recoveryManifest.upsert({where:{id},create:{id,recoveryId:run.id,version,cutoffAt:run.cutoffAt,scope,sourceHash,itemCount:0,cursor:0,phase:'REVALIDATED',manifestHash,createdById:actor,checkedById:actor,checkedAt:new Date()},update:{}});
 const approval={purpose:'RECOVERY_APPROVAL',contractProtocol:2,recoveryProtocol:1,workerProtocol:2,scope:'ISOLATED_LAB',authorizationId:id,manifestId:id,manifestHash,inventoryHash:sourceHash,inventoryVersion:version,recoveryId:run.id,cutoffAt:run.cutoffAt.toISOString(),generation:control.generation,planHash:inventoryHash([]),sourceDigest:'a'.repeat(64),imageDigest:'sha256:'+'b'.repeat(64),containment:{kind:'OWNED_ISOLATED_LAB',environmentId:'synthetic-fixture',evidenceDigest:'c'.repeat(64)},approvedById:actor,validUntil:new Date(Date.now()+86400000).toISOString(),temporalAddress:'127.0.0.1:1',namespace:'default',queues:['main','instagram','facebook']};
 approval.containmentHash=inventoryHash(approval.containment);
 approval.applicationDigest='f'.repeat(64);
 approval.resumeNotAfter=new Date(+run.cutoffAt+30000).toISOString();
 const signature=sign(null,Buffer.from(inventoryHash(approval)),keys.privateKey).toString('base64'),resultHash=inventoryHash({approval,signature}),expectedDbHash=inventoryHash({});
 const admitted={purpose:'WORKER_ADMISSION',contractProtocol:2,scope:approval.scope,authorizationId:id,approvalHash:inventoryHash(approval),applicationHash:resultHash,expectedDbHash,generation:control.generation,cutoffAt:approval.cutoffAt,sourceDigest:approval.sourceDigest,imageDigest:approval.imageDigest,containmentHash:approval.containmentHash,validUntil:approval.validUntil};
 admitted.resumeNotAfter=approval.resumeNotAfter;
 await db.recoveryAuthorization.upsert({where:{id},create:{id,manifestId:id,generation:control.generation,phase:'ADMITTED',approval,approvalSignature:signature,authorityHash:authorityHash(),plan:[],source,expectedDbHash,resultHash,admitted,admittedSignature:sign(null,Buffer.from(inventoryHash(admitted)),keys.privateKey).toString('base64'),approvedById:actor},update:{}});
 await db.automationRecoveryRun.update({where:{id:run.id},data:{manifestHash,authorizedById:actor,authorizedAt:new Date()}});
};
