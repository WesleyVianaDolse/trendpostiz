// Only validates proposed document snippets with fake IPC/synthetic input.
// Never runs Docker, PM2, Temporal, shell blocks or production commands.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const doc=fs.readFileSync('docs/v1.7.5-r28-operational-containment-plan.md','utf8');
const code=doc.match(/<<'NODE'\n([\s\S]*?)\nNODE/)[1];
new vm.Script(code);
const secret='SYNTHETIC_PRIVATE_VALUE_DO_NOT_EXPORT';let checks=0;
function query(mode,rows){const output=[],methods=[],imports=[],handlers={},process={argv:['node','-','/synthetic/pm2'],kill:(_pid,sig)=>assert.equal(sig,0)};
 const socket={once:(name,fn)=>{handlers[name]=fn;},close:()=>{},connect:path=>{assert.equal(path,'/synthetic/pm2/rpc.sock');handlers.connect();}};
 const sandbox={process,console:{log:value=>output.push(value)},setTimeout,clearTimeout,require:name=>{
  imports.push(name);
  if(name==='node:fs')return {readFileSync:path=>path.endsWith('package.json')?JSON.stringify({version:mode==='version'?'0.0.0':'7.1.2'}):'42',statSync:()=>({isSocket:()=>mode!=='socket'})};
  if(name==='node:path')return require(name).posix;
  if(name==='node:crypto')return require(name);
  if(name.endsWith('/modules/pm2-axon'))return {socket:()=>socket};
  if(name.endsWith('/modules/pm2-axon-rpc'))return {Client:function(){this.call=(method,_args,cb)=>{assert.equal(method,'getMonitorData');methods.push(method);cb(mode==='rpc'?Error(secret):null,rows);};}};
  throw Error('Unreviewed import');
 }};
 vm.runInNewContext(code,sandbox,{timeout:1000});
 assert.equal(output.length,1);assert(!output[0].includes(secret));assert(!imports.some(x=>x.includes('/lib/Client')||x==='pm2'));
 return {data:JSON.parse(output[0]),methods};
}
const normal=['orchestrator','frontend','backend'].map((name,i)=>({pm_id:i,pid:100+i,pm2_env:{name,status:'online',pm_uptime:1,restart_time:0,env:{TOKEN:secret}}}));
let r=query('ok',normal);assert.equal(r.data.processes.length,3);assert.equal(r.data.processes[0].pm_id,0);assert.deepEqual(r.methods,['getMonitorData']);checks++;
r=query('ok',[{pid:secret,pm_id:secret,pm2_env:{name:secret,pm_id:secret,status:secret,args:secret}}]);assert.equal(r.data.processes[0].pm_id,null);assert.equal(r.data.processes[0].pid,null);checks++;
for(const mode of ['version','socket','rpc']){r=query(mode,normal);assert.equal(r.data.status,'GAP');checks++;}
r=query('ok',[null]);assert.equal(r.data.status,'GAP');checks++;
const blocks=[...doc.matchAll(/```sh\n([\s\S]*?)\n```/g)].map(m=>m[1]),python=[];
for(const block of blocks){const marker="python3 -I -B -c '\n",start=block.indexOf(marker);if(start>=0)python.push(block.slice(start+marker.length,block.indexOf("\n'",start+marker.length)));}
assert.equal(python.length,2);
const executable=process.env.R28_TEST_PYTHON||'python3';
let result=spawnSync(executable,['-I','-B','-c',python[1]],{input:JSON.stringify({id:'a'.repeat(64),image:'sha256:'+'b'.repeat(64),restart:'always',state:'running',pid:1,health_status:'unhealthy',health_test:['CMD',secret,'http://localhost:3002/health/status'],cmd:['TOKEN='+secret+' pm2 start pnpm --name orchestrator && pm2 delete all && pnpm run prisma-db-push'],compose_files:'/private/'+secret+'/compose.yaml',traefik:'true'}),encoding:'utf8',windowsHide:true});
assert.equal(result.status,0);assert(!result.stdout.includes(secret));let p=JSON.parse(result.stdout);assert(p.health_uses_3002&&p.launcher_has_delete_all&&p.launcher_has_schema_push&&p.launcher_has_orchestrator);checks++;
result=spawnSync(executable,['-I','-B','-c',python[1]],{input:'invalid '+secret,encoding:'utf8',windowsHide:true});assert.equal(result.status,2);assert(!result.stdout.includes(secret));assert.equal(JSON.parse(result.stdout).status,'GAP');checks++;
console.log(JSON.stringify({scope:'LOCAL_PLAN_SNIPPETS_ONLY',checks,result:'PASS',dockerExecuted:false,pm2Executed:false,productionOperations:false}));
