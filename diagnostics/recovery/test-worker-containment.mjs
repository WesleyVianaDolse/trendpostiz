// Isolated proof of the proposed mTLS boundary. No existing container is changed.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),req=createRequire(path.join(root,'package.json'));
const label='recovery-containment-'+randomUUID(),temp=fs.mkdtempSync(path.join(os.tmpdir(),label+'-'));
const docker=(args)=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout.trim();};
const pause=ms=>new Promise(r=>setTimeout(r,ms));let pg,temporal,network,connection;
const results=[],test=async(name,fn)=>{await fn();results.push({name,result:'PASS'});console.log('PASS',name);};
try{
 assert(!process.env.DOCKER_HOST||/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST));assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^(npipe|unix):\/\//);
 fs.writeFileSync(path.join(temp,'server.ext'),'subjectAltName=DNS:temporal,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth,clientAuth\n');
 fs.writeFileSync(path.join(temp,'client.ext'),'extendedKeyUsage=clientAuth\n');
 const makeCerts=`set -e
cd /certs
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca-key.pem -out ca.pem -days 1 -subj /CN=fixture-release-ca >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout server-key.pem -out server.csr -subj /CN=temporal >/dev/null 2>&1
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out server.pem -days 1 -extfile server.ext >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout client-key.pem -out client.csr -subj /CN=fixture-protocol-1 >/dev/null 2>&1
openssl x509 -req -in client.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out client.pem -days 1 -extfile client.ext >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -keyout stale-key.pem -out stale.pem -days 1 -subj /CN=fixture-stale-ca >/dev/null 2>&1
chown -R 1000:1000 /certs
chmod 600 *key.pem
`;
 docker(['run','--rm','--network','none','--mount',`type=bind,src=${temp},dst=/certs`,'--entrypoint','bash','postgres:17.11','-lc',makeCerts]);
 // A loopback-published bridge permits the host SDK to test TLS. The separate
 // network-none case proves forensic quarantine; no production network changes.
 network=docker(['network','create','--label','trendpostiz.recovery-containment='+label,label]);
 pg=docker(['run','-d','--rm','--name',label+'-pg','--label','trendpostiz.recovery-containment='+label,'--network',network,'--network-alias','postgres',
  '-e','POSTGRES_USER=guard_test','-e','POSTGRES_PASSWORD=synthetic-only','postgres:17.11']);
 for(let n=0;n<60;n++){if(spawnSync('docker',['exec',pg,'pg_isready','-U','guard_test'],{stdio:'ignore',windowsHide:true}).status===0)break;await pause(500);}
 const tlsEnv={TEMPORAL_TLS_REQUIRE_CLIENT_AUTH:'true',TEMPORAL_TLS_SERVER_CERT:'/certs/server.pem',TEMPORAL_TLS_SERVER_KEY:'/certs/server-key.pem',
 TEMPORAL_TLS_SERVER_CA_CERT:'/certs/ca.pem',TEMPORAL_TLS_FRONTEND_CERT:'/certs/server.pem',TEMPORAL_TLS_FRONTEND_KEY:'/certs/server-key.pem',
 TEMPORAL_TLS_CLIENT1_CA_CERT:'/certs/ca.pem',TEMPORAL_TLS_CLIENT2_CA_CERT:'/certs/ca.pem',TEMPORAL_TLS_INTERNODE_SERVER_NAME:'temporal',TEMPORAL_TLS_FRONTEND_SERVER_NAME:'temporal'};
 temporal=docker(['run','-d','--name',label+'-temporal','--label','trendpostiz.recovery-containment='+label,'--network',network,'--network-alias','temporal',
 '--mount',`type=bind,src=${temp},dst=/certs,readonly`,'--publish','127.0.0.1::7233','-e','DB=postgres12','-e','DB_PORT=5432','-e','POSTGRES_USER=guard_test','-e','POSTGRES_PWD=synthetic-only','-e','POSTGRES_SEEDS=postgres',
 '-e','SKIP_DEFAULT_NAMESPACE_CREATION=true','-e','SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES=true',...Object.entries(tlsEnv).flatMap(([k,v])=>['-e',`${k}=${v}`]),'temporalio/auto-setup:1.28.2']);
 const address=docker(['port',temporal,'7233/tcp']);assert.match(address,/^127\.0\.0\.1:\d+$/);
 const {Connection,Client}=req('@temporalio/client');
 const tls={serverNameOverride:'temporal',serverRootCACertificate:fs.readFileSync(path.join(temp,'ca.pem')),clientCertPair:{crt:fs.readFileSync(path.join(temp,'client.pem')),key:fs.readFileSync(path.join(temp,'client-key.pem'))}};
 for(let n=0;n<60;n++){try{connection=await Connection.connect({address,tls,connectTimeout:'1 second'});break;}catch{await pause(500);}}
 assert(connection,'Owned TLS server unavailable; no containment certificate');
 await connection.workflowService.registerNamespace({namespace:'default',workflowExecutionRetentionPeriod:{seconds:86400}});
 const client=new Client({connection,namespace:'default'});
 await test('K01 new release client authenticates with a private mTLS certificate',async()=>{await connection.workflowService.getSystemInfo({});});
 await test('K02 legacy plaintext connection is denied before polling',async()=>{await assert.rejects(Connection.connect({address,connectTimeout:'2 seconds'}));});
 await test('K03 TLS without client cert and untrusted old cert are denied',async()=>{
  await assert.rejects(Connection.connect({address,tls:{serverNameOverride:'temporal',serverRootCACertificate:tls.serverRootCACertificate},connectTimeout:'2 seconds'}));
  await assert.rejects(Connection.connect({address,tls:{...tls,clientCertPair:{crt:fs.readFileSync(path.join(temp,'stale.pem')),key:fs.readFileSync(path.join(temp,'stale-key.pem'))}},connectTimeout:'2 seconds'}));
 });
 await test('K04 pending test workflow remains unconsumed with zero pollers',async()=>{
  const h=await client.workflow.start('syntheticNeverConsumed',{workflowId:'containment-pending',taskQueue:'protected-main',workflowExecutionTimeout:'30 seconds'});
  const history=await h.fetchHistory();assert(history.events.some(e=>e.workflowTaskScheduledEventAttributes));assert(!history.events.some(e=>e.workflowTaskStartedEventAttributes));
  for(const kind of [1,2])assert.equal((await connection.workflowService.describeTaskQueue({namespace:'default',taskQueue:{name:'protected-main'},taskQueueType:kind})).pollers.length,0);
 });
 await test('K05 stale forensic process with network none has no outbound route',async()=>{
  const routes=docker(['run','--rm','--network','none','--entrypoint','cat','postgres:17.11','/proc/net/route']);assert.equal(routes.trim().split('\n').length,1);
 });
 const report={postgres:'17.11',temporal:'1.28.2',results,productionContainmentVerified:false,activationAuthorized:false,
  limitation:'mTLS rejects clients without release credentials; binary identity additionally requires stopped old consumers, exclusive key mounts and pinned image/protocol attestation. No existing server or worker was changed.'};
 fs.writeFileSync(path.join(root,'diagnostics/recovery/worker-containment-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({tests:results.length,productionContainmentVerified:false}));
}finally{
 if(connection)await connection.close();
 for(const id of [temporal,pg].filter(Boolean)){const info=JSON.parse(docker(['inspect',id]))[0];assert.equal(info.Config.Labels['trendpostiz.recovery-containment'],label);docker(['rm','-f',id]);}
 if(network){const info=JSON.parse(docker(['network','inspect',network]))[0];assert.equal(info.Labels['trendpostiz.recovery-containment'],label);docker(['network','rm',network]);}
}
