// Artifact membership is covered by the separate operator approval signature.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function files(root){const result=[];for(const base of ['dist','scripts/recovery']){const walk=relative=>{
 for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){
  const file=relative+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Linked artifact input');
  if(entry.isDirectory())walk(file);else result.push({file,sha256:hash(fs.readFileSync(path.join(root,file)))});
 }};walk(base);}for(const file of ['package.json','pnpm-lock.yaml'])result.push({file,sha256:hash(fs.readFileSync(path.join(root,file)))});return result.sort((a,b)=>a.file.localeCompare(b.file));}
function build(root){const inputs=files(root);return {format:'WORKER_RUNTIME_V2',protocol:2,files:inputs,sourceDigest:hash(JSON.stringify(inputs))};}
function verify(root,artifact){const actual=build(root);if(artifact.format!==actual.format||artifact.protocol!==2||artifact.sourceDigest!==actual.sourceDigest||JSON.stringify(artifact.files)!==JSON.stringify(actual.files))throw Error('WORKER_ARTIFACT_MISMATCH');return actual;}
module.exports={build,verify};
if(require.main===module){const root=process.cwd();fs.writeFileSync(path.join(root,'worker-artifact.json'),JSON.stringify(build(root)),{flag:'wx'});}
