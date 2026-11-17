// External process: can observe a blocked child/event loop; has no restart API.
// Running this file never launches an orchestrator or changes worker admission.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
async function observe(options = {}) {
  const release = JSON.parse(fs.readFileSync(path.join(root,'recovery-release.json'),'utf8'));
  let health = 'UNREACHABLE';
  const endpoint = new URL(options.endpoint || 'http://127.0.0.1:3002/health/status');
  const timeout = options.timeoutMs ?? 3000;
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.username||endpoint.password||!Number.isSafeInteger(timeout)||timeout<1||timeout>3000)throw Error('Invalid loopback observation');
  try { const response = await fetch(endpoint, { signal: AbortSignal.timeout(timeout), redirect:'error' }); health = response.ok ? 'HTTP_OK' : 'HTTP_ERROR'; }
  catch { /* no error bodies, command lines or environment values in output */ }
  return { mode:'OBSERVE_ONLY', restartEnabled:false, workerActivationEnabled:false, health,
    implementationStage:release.implementationStage, observedAt:new Date().toISOString() };
}
module.exports = { observe };
if (require.main === module) observe().then(value=>console.log(JSON.stringify(value))).catch(()=>{ console.error('Observation unavailable; no restart attempted.'); process.exitCode=1; });
