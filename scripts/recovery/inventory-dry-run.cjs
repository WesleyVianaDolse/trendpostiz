// Manual preparation only. Never opens consumption, applies decisions or calls
// providers. Do not run against production without separate read authorization.
const path=require('node:path'),fs=require('node:fs'),Module=require('node:module');
const root=path.resolve(__dirname,'../..');
async function main(){
 const args=process.argv.slice(2), value=k=>args[args.indexOf(k)+1];
 if(!args.includes('--read-only')||!args.includes('--cutoff')||!args.includes('--scope')||!args.includes('--output'))throw Error('Required: --read-only --cutoff UTC_ISO --scope org1,org2 --output PATH');
 const cutoff=new Date(value('--cutoff')), scope=value('--scope').split(',').filter(Boolean);
 if(!value('--cutoff').endsWith('Z')||!Number.isFinite(+cutoff)||!scope.length)throw Error('Explicit UTC cutoff and scope required');
 if(!process.env.DATABASE_URL||!process.env.TEMPORAL_ADDRESS)throw Error('Explicit database and Temporal endpoints required');
 require('ts-node').register({project:path.join(root,'tsconfig.base.json'),transpileOnly:true,compilerOptions:{module:'commonjs',target:'es2020',incremental:false}});
 const resolve=Module._resolveFilename;
 Module._resolveFilename=function(name,parent,...rest){if(name.startsWith('@gitroom/nestjs-libraries/'))name=path.join(root,'libraries/nestjs-libraries/src',name.slice('@gitroom/nestjs-libraries/'.length));return resolve.call(this,name,parent,...rest);};
 const {PrismaClient}=require('@prisma/client'),{Client,Connection}=require('@temporalio/client');
 const {captureRecoveryInventory}=require(path.join(root,'libraries/nestjs-libraries/src/automation-recovery/recovery-inventory-source.ts'));
 const {classifyRecoveryInventory,inventoryHash}=require(path.join(root,'libraries/nestjs-libraries/src/automation-recovery/recovery-inventory.ts'));
 const {temporalClientTls}=require(path.join(root,'libraries/nestjs-libraries/src/temporal/temporal-tls.ts'));
 const prisma=new PrismaClient();let connection;
 try{
  connection=await Connection.connect({address:process.env.TEMPORAL_ADDRESS,...temporalClientTls()});
  const client=new Client({connection,namespace:process.env.TEMPORAL_NAMESPACE||'default'});
  const providerSource=fs.readFileSync(path.join(root,'libraries/nestjs-libraries/src/integrations/integration.manager.ts'),'utf8');
  // Require a reviewed list; do not guess provider queues from human labels.
  const queues=(process.env.RECOVERY_INVENTORY_QUEUES||'').split(',').filter(Boolean);
  if(!queues.includes('main')||!queues.includes('instagram')||!queues.includes('facebook'))throw Error('Reviewed complete RECOVERY_INVENTORY_QUEUES required');
  const source=await captureRecoveryInventory(prisma,client,scope,queues), items=classifyRecoveryInventory(source,cutoff);
  const artifact={format:'RECOVERY_DRY_RUN_V1',cutoffAt:cutoff.toISOString(),scope,sourceHash:inventoryHash(source),items,
    queueCatalogSourceHash:inventoryHash(providerSource),manifestHash:inventoryHash({cutoff,scope,source,items}),generatedAt:new Date().toISOString(),
    databaseReadOnly:true,preparationOnly:true,activationAuthorized:false,temporalCompletenessCertified:false};
  // Never overwrite an existing audit artifact or symlink.
  fs.writeFileSync(path.resolve(value('--output')),JSON.stringify(artifact,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'READ_ONLY_DRY_RUN_CREATED',items:items.length,holds:items.filter(i=>['RETAIN','REVIEW_BINDINGS'].includes(i.decision)).length,activationAuthorized:false}));
 }finally{if(connection)await connection.close();await prisma.$disconnect();}
}
if(require.main===module)main().catch(()=>{console.error('DRY_RUN_FAILED: consumption remains blocked; no recovery was applied.');process.exitCode=1;});
