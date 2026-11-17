// Installs only the compiled orchestrator's runtime graph in an owned Linux
// volume, with unchanged locked snapshots. No .env or application execution.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire, isBuiltin } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const root=fileURLToPath(new URL('../../',import.meta.url));
const req=createRequire(path.join(root,'package.json'));
const ts=req('typescript'), yaml=req('yaml');
const id='temporal-startup-deps-'+randomUUID();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),id+'-'));
const compiled=path.join(root,'apps/orchestrator/dist');
const pending=[path.join(compiled,'apps/orchestrator/src/main.js')];
const visited=new Set(), packages=new Set();
while(pending.length){
  const file=pending.pop();
  if(visited.has(file)||!file.endsWith('.js'))continue;
  visited.add(file);
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const visit=node=>{
    if(ts.isCallExpression(node)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&
      ['require','require.resolve'].includes(node.expression.getText(source))){
      const request=node.arguments[0].text;
      if(!isBuiltin(request)){
        if(request.startsWith('.')){
          const resolved=createRequire(file).resolve(request);
          if(!resolved.startsWith(compiled+path.sep))throw new Error('Dependency outside compiled app');
          pending.push(resolved);
        }else packages.add(request.startsWith('@')?request.split('/').slice(0,2).join('/'):request.split('/')[0]);
      }
    }
    ts.forEachChild(node,visit);
  };
  visit(source);
}
const lock=yaml.parse(fs.readFileSync(path.join(root,'pnpm-lock.yaml'),'utf8'));
const original=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const importer=lock.importers['.'];
const dependencies={};
for(const name of [...packages].sort()){
  if(!importer.dependencies[name]){
    if(importer.devDependencies?.[name]) importer.dependencies[name]=importer.devDependencies[name];
  }
  if(!importer.dependencies[name]){
    const version=req(name+'/package.json').version;
    if(!lock.snapshots[name+'@'+version])throw new Error('Dependency absent from locked snapshots: '+name);
    importer.dependencies[name]={specifier:version,version};
  }
  dependencies[name]=importer.dependencies[name].specifier;
}
lock.importers={'.':{dependencies:Object.fromEntries([...packages].sort().map(n=>[n,importer.dependencies[n]]))}};
fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'isolated-orchestrator-dependencies',private:true,dependencies,pnpm:original.pnpm},null,2));
fs.writeFileSync(path.join(dir,'pnpm-lock.yaml'),yaml.stringify(lock));
const run=args=>{
  const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});
  if(r.status!==0)throw new Error(r.stderr||r.error?.message);
  return r.stdout.trim();
};
if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))throw new Error('Remote DOCKER_HOST forbidden');
if(!/^(npipe|unix):\/\//.test(run(['context','inspect','--format','{{.Endpoints.docker.Host}}'])))throw new Error('Local Docker required');
run(['volume','create','--label','trendpostiz.startup-cache='+id,id]);
console.log(JSON.stringify({volume:id,input:dir,compiledModules:visited.size,directPackages:packages.size}));
const command='cp /input/package.json /input/pnpm-lock.yaml /app/ && npm install --prefix /tool pnpm@10.6.1 --ignore-scripts --no-audit --no-fund && node /tool/node_modules/pnpm/bin/pnpm.cjs install --frozen-lockfile --ignore-scripts --prod --config.node-linker=hoisted --config.inject-workspace-packages=true && mkdir -p /app/node_modules/bcrypt/lib/binding/napi-v3 /app/node_modules/.prisma/client /app/apps/orchestrator/dist && touch /app/node_modules/bcrypt/lib/binding/napi-v3/bcrypt_lib.node';
const child=spawn('docker',['run','--rm','--name',id,'--label','trendpostiz.startup-cache='+id,
  '--mount','type=volume,source='+id+',target=/app','--mount','type=bind,source='+dir+',target=/input,readonly',
  '--workdir','/app','node:22.20-bookworm-slim','sh','-c',command],{windowsHide:true,stdio:'inherit'});
const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});
if(status!==0)throw new Error('Linux dependency preparation failed: '+status);
console.log('TEMPORAL_DIAG_DEPENDENCIES_VOLUME='+id);
