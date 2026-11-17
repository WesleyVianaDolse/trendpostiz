// Runs the embedded SDK code with an allowlisted fake transport, no Docker/RPC.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('scripts/recovery/r28-infrastructure-readonly.py','utf8');
const embedded=source.match(/TEMPORAL_PROBE = r'''([\s\S]*?)'''/)[1];
const queueText=source.match(/^QUEUES = "([^"]+)"\.split/m)[1],queues=queueText.split(' ');
const secret='SYNTHETIC_CLIENT_TOKEN_DO_NOT_EXPORT';let tests=0;
async function run(extra={},failure){const calls=[],out=[],configs=[];
 const connection={withDeadline:async(_d,fn)=>fn(),close:async()=>calls.push('close'),workflowService:new Proxy({
  getSystemInfo:async()=>({serverVersion:'1.28.2'}),describeNamespace:async()=>({namespaceInfo:{state:1}}),
  describeTaskQueue:async request=>{calls.push(request);if(failure==='queue')throw Error(secret);return {pollers:[{identity:secret,workerVersionCapabilities:{buildId:secret}}],taskQueueStatus:{backlogCountHint:{toString:()=> '18'}}};}
 },{get:(target,key)=>{assert(key in target,'Mutating or unreviewed RPC '+String(key));return target[key];}})};
 const Connection={connect:async opts=>{configs.push(opts);if(failure==='connect')throw Error(secret);return connection;}};
 const sandbox={setTimeout,clearTimeout,process:{env:{TEMPORAL_ADDRESS:'postiz-temporal:7233',TEMPORAL_NAMESPACE:'default',...extra},versions:{node:'22.20.0',openssl:'3.0.0',modules:'127'},arch:'x64',platform:'linux',exit:()=>{throw Error('Unexpected diagnostic deadline')}},
  console:{log:s=>out.push(s)},require:name=>{assert(['node:crypto','node:fs','/app/node_modules/@temporalio/client'].includes(name),'Unexpected module '+name);if(name==='node:fs')return {readFileSync:()=>Buffer.from(secret)};if(name==='/app/node_modules/@temporalio/client')return {Connection};return require(name);}};
 await vm.runInNewContext(embedded.replace('__QUEUES_JSON__',JSON.stringify(queues)),sandbox,{timeout:1000});
 assert.equal(out.length,1);assert(!out[0].includes(secret));const result=JSON.parse(out[0].slice('R28_JSON='.length));return {result,calls,configs};
}
(async()=>{
 let r=await run({TEMPORAL_API_KEY:secret});assert.equal(r.result.rows.filter(x=>x.kind==='queue').length,32);assert.equal(r.calls.filter(x=>typeof x==='object').length,64);assert.equal(r.configs[0].apiKey,secret);tests++;
 r=await run({TEMPORAL_NAMESPACE:secret});assert(r.result.rows.find(x=>x.kind==='target').namespace_ref.startsWith('ref:'));tests++;
 r=await run({TEMPORAL_CLIENT_CERT_PATH:'/synthetic/cert'});assert.equal(r.configs.length,0);assert(r.result.rows.some(x=>x.reason==='INCOMPLETE_MTLS_CONFIGURATION'));tests++;
 r=await run({TEMPORAL_CLIENT_CERT_PATH:'/synthetic/cert',TEMPORAL_CLIENT_KEY_PATH:'/synthetic/key',TEMPORAL_SERVER_CA_PATH:'/synthetic/ca',TEMPORAL_TLS_SERVER_NAME:'temporal'});assert(r.configs[0].tls.clientCertPair.key);assert.equal(r.result.rows.find(x=>x.kind==='target').transport,'mtls');tests++;
 r=await run({},'connect');assert(r.result.rows.some(x=>x.reason==='TEMPORAL_SDK_OR_READ_CONNECTION_FAILED'));tests++;
 r=await run({},'queue');assert.equal(r.result.rows.filter(x=>x.kind==='queue').length,32);assert(r.result.rows.filter(x=>x.kind==='queue').every(x=>x.workflow.unavailable&&x.activity.unavailable));tests++;
 r=await run({TEMPORAL_ADDRESS:'https://user:'+secret+'@host'});assert.equal(r.configs.length,0);assert(r.result.rows.some(x=>x.reason==='TEMPORAL_ENDPOINT_FORMAT_REQUIRES_REVIEW'));tests++;
 assert(!/Worker|PrismaClient|NestFactory|fetch\(|\.workflow\.start|pollWorkflow|pollActivity/.test(embedded));tests++;
 console.log(JSON.stringify({scope:'SYNTHETIC_SDK_TRANSPORT_ONLY',checks:tests,result:'PASS',dockerUsed:false,networkUsed:false,productionAuthorized:false}));
})().catch(()=>{console.error('SDK_READONLY_CONTRACT_TEST_FAILED');process.exitCode=1;});
