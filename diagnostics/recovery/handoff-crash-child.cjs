// Actual application transaction/process loss, with a DI-only scheduling type.
const path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const [root,url,id,mode,keyFile]=process.argv.slice(2);assert.equal(new URL(url).hostname,'127.0.0.1');assert.equal(new URL(url).pathname,'/guard_test');
process.env.RECOVERY_APPROVAL_PUBLIC_KEY_FILE=keyFile;
require('reflect-metadata');require('ts-node').register({project:path.join(root,'tsconfig.base.json'),transpileOnly:true,compilerOptions:{module:'commonjs',target:'es2020',incremental:false}});
const load=Module._load;Module._load=function(name,parent,...args){if(name.endsWith('/publication-scheduling.service'))return {PublicationSchedulingService:class{}};return load.call(this,name,parent,...args);};
const {PrismaClient}=require('@prisma/client'),db=new PrismaClient({datasources:{db:{url}}});
const {RecoveryApplicationService}=require(path.join(root,'libraries/nestjs-libraries/src/automation-recovery/recovery-application.service.ts'));
new RecoveryApplicationService(db,{prepareRecoverySlot(){throw Error('Unexpected staging in first audit batch');}}).applyBatch('operator',id,1,
 async()=>{if(mode==='before')process.exit(88);},async()=>{if(mode==='after')process.exit(88);}).then(()=>{process.exitCode=1;}).catch(()=>{process.exitCode=2;});
