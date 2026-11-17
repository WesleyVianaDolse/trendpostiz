// Explicit local worker-only image. No Compose, credentials, app execution or push.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync,spawn} from 'node:child_process';
import {createRequire,isBuiltin} from 'node:module';import {fileURLToPath} from 'node:url';import {randomUUID,createHash} from 'node:crypto';import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),req=createRequire(path.join(root,'package.json')),ts=req('typescript'),yaml=req('yaml');
const docker=args=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^(npipe|unix):\/\//);
if(process.env.DOCKER_HOST)assert.match(process.env.DOCKER_HOST,/^(npipe|unix):\/\//);
const compiled=path.join(root,'apps/orchestrator/dist'),pending=[path.join(compiled,'apps/orchestrator/src/admitted-main.js')],visited=new Set(),packages=new Set(['prisma']);
while(pending.length){const file=pending.pop();if(visited.has(file)||!file.endsWith('.js'))continue;visited.add(file);
 const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);const visit=n=>{
 if(ts.isCallExpression(n)&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])&&['require','require.resolve'].includes(n.expression.getText(source))){const name=n.arguments[0].text;
 if(!isBuiltin(name)){if(name.startsWith('.')){const target=createRequire(file).resolve(name);assert(target.startsWith(compiled+path.sep));pending.push(target);}else packages.add(name.startsWith('@')?name.split('/').slice(0,2).join('/'):name.split('/')[0]);}}
 ts.forEachChild(n,visit);};visit(source);
}
const lock=yaml.parse(fs.readFileSync(path.join(root,'pnpm-lock.yaml'),'utf8')),original=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),im=lock.importers['.'],dependencies={};
for(const name of [...packages].sort()){let entry=im.dependencies[name]||im.devDependencies?.[name];if(!entry){const version=req(name+'/package.json').version;assert(lock.snapshots[name+'@'+version],'Unreviewed dependency '+name);entry={specifier:version,version};}dependencies[name]=entry;}
lock.importers={'.':{dependencies}};
const id='v175-candidate-'+randomUUID(),dir=fs.mkdtempSync(path.join(os.tmpdir(),id)),tag='trendpostiz-v175-worker:'+id;
fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'trendpostiz-worker-candidate',private:true,dependencies:Object.fromEntries(Object.entries(dependencies).map(([k,v])=>[k,v.specifier])),pnpm:original.pnpm}));
fs.writeFileSync(path.join(dir,'pnpm-lock.yaml'),yaml.stringify(lock));fs.copyFileSync(path.join(root,'docker/recovery/Dockerfile.candidate'),path.join(dir,'Dockerfile'));
fs.copyFileSync(path.join(root,'libraries/nestjs-libraries/src/database/prisma/schema.prisma'),path.join(dir,'schema.prisma'));
fs.cpSync(compiled,path.join(dir,'dist'),{recursive:true});fs.mkdirSync(path.join(dir,'scripts/recovery'),{recursive:true});
for(const file of ['runtime-artifact.cjs','preflight.cjs'])fs.copyFileSync(path.join(root,'scripts/recovery',file),path.join(dir,'scripts/recovery',file));
const base=JSON.parse(docker(['image','inspect','node:22.20-bookworm-slim','--format','{{json .RepoDigests}}']))[0];
const child=spawn('docker',['build','--build-arg','NODE_IMAGE='+base,'--label','trendpostiz.recovery-candidate='+id,'--tag',tag,'--iidfile',path.join(dir,'image-id'),dir],{stdio:'inherit',windowsHide:true});
assert.equal(await new Promise(r=>child.on('exit',r)),0,'Candidate image build failed');
const digest=fs.readFileSync(path.join(dir,'image-id'),'utf8').trim();assert.match(digest,/^sha256:[a-f0-9]{64}$/);
const localImageId=docker(['image','inspect',tag,'--format','{{.Id}}']);
const info={scope:'LOCAL_UNPUBLISHED_WORKER_IMAGE',tag,imageDigest:digest,localImageId,baseImage:base,context:dir,compiledModules:visited.size,packages:packages.size,rootLockSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'pnpm-lock.yaml'))).digest('hex'),registryManifestDigest:null,productionAuthorized:false};
fs.writeFileSync(path.join(root,'diagnostics/recovery/linux-candidate-image.json'),JSON.stringify(info,null,2)+'\n');console.log(JSON.stringify(info));
