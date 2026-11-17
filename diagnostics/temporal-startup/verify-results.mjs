// Verifies recorded real-server runs. Does not start or contact any service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const dirs=process.argv.slice(2);
assert.equal(dirs.length,5,'Supply normal, Sentry, untraced, async-stall, sync-stall artifact directories');
const names=['normal','sentry','untraced','async-create-stall','sync-create-stall'];
const results=dirs.map((dir,index)=>{
  const name=names[index];
  const log=fs.readFileSync(path.join(dir,'app.log'),'utf8');
  const tracePath=path.join(dir,'trace.jsonl');
  const trace=fs.existsSync(tracePath)?fs.readFileSync(tracePath,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.threadId===0):[];
  const result={name,passed:false,logSha256:createHash('sha256').update(log).digest('hex')};
  if(index<3){
    const probe=JSON.parse(fs.readFileSync(path.join(dir,'server-probe.json'),'utf8'));
    assert(probe.pollers.workflow>0&&probe.pollers.activity>0,name+': missing server pollers');
    assert(probe.workflowTaskStarted&&probe.workflowTaskCompleted,name+': no real Workflow Task completed');
    assert(log.includes('Started 32 workers successfully')&&log.includes('Orchestrator health check listening on port 3002'));
    result.pollers=probe.pollers;
    result.eventTypes=probe.eventTypes;
    if(index<2){
      assert.equal(trace.filter(r=>r.event==='Worker.create:end').length,32);
      assert.equal(trace.filter(r=>r.event==='Webpack.createBundle:end').length,32);
      result.importsMs=trace.find(r=>r.event==='NestFactory.create:begin').ms;
      result.nativeConnectMs=trace.find(r=>r.event==='NativeConnection.connect:end').elapsedMs;
      result.workersCreationMs=trace.find(r=>r.event==='WorkerManager.initializeMultipleWorkers:end').elapsedMs;
    }
  }else if(index===3){
    assert(trace.some(r=>r.event==='injected:async-create-stall'));
    assert(log.includes('Startup did not finish within 120 seconds.'));
    assert(trace.some(r=>r.event==='process:exit'&&r.code===1));
    result.watchdogElapsedMs=trace.find(r=>r.event==='process:exit').ms-trace.find(r=>r.event==='NestFactory.create:begin').ms;
    assert(result.watchdogElapsedMs>=119000&&result.watchdogElapsedMs<125000);
  }else{
    const injected=trace.find(r=>r.event==='injected:sync-create-stall');
    assert(injected);
    assert(!trace.some(r=>r.event==='event-loop:tick'&&r.ms>injected.ms));
    assert(!log.includes('Startup did not finish within 120 seconds.'));
    const lateHealth=fs.readdirSync(dir).filter(f=>/^health-(\d+)\.log$/.test(f)&&Number(f.match(/\d+/)[0])>=65);
    assert(lateHealth.some(f=>{const s=fs.readFileSync(path.join(dir,f),'utf8');return s.includes('futex')&&s.includes('ECONNREFUSED')}));
    result.observed='Injected synchronous stall: futex, refused health, timer unable to fire beyond deadline';
  }
  result.passed=true;
  return result;
});
const evidence={scope:'Local isolated tests only. No production root cause established.',commit:'36f4cd9971d5f304b0ab94f373160ea632341ac4',
  environment:{node:'22.20.0',temporalServer:'1.28.2',postgres:'16-alpine',nestjsTemporalCore:'3.2.3',temporalSDK:'1.15.0',clientCredentials:false},results};
fs.writeFileSync(new URL('./latest-results.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
