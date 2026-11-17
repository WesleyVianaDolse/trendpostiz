// Local review metadata, not a release manifest and never an activation switch.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const critical=[
 'libraries/nestjs-libraries/src/automation-recovery/worker-consumption.ts','scripts/recovery/preflight.cjs',
 'libraries/nestjs-libraries/src/automation-recovery/automation-recovery.service.ts','libraries/nestjs-libraries/src/automation-recovery/recovery-policy.ts',
 'libraries/nestjs-libraries/src/automation-recovery/recovery-manifest.service.ts','libraries/nestjs-libraries/src/temporal/temporal-tls.ts',
 'libraries/nestjs-libraries/src/database/prisma/baseline-proposal/prisma-owned/manifest.json','recovery-release.json',
 'apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.6.ts','apps/orchestrator/src/activities/recovery-publication.activity.ts',
];
function createReviewArtifact(){
 const inputs=new Set([...critical,'version.txt','package.json','pnpm-lock.yaml','apps/orchestrator/package.json','tsconfig.base.json','apps/orchestrator/tsconfig.build.json','apps/orchestrator/nest-cli.json','Dockerfile.dev','docker-compose.yaml','.dockerignore']);
 for(const file of ['.swcrc','nest-cli.json','nx.json','pnpm-workspace.yaml','tsconfig.json'])if(fs.existsSync(path.join(root,file)))inputs.add(file);
 const walk=relative=>{const directory=path.join(root,relative);if(!fs.existsSync(directory))return;
   for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=relative+'/'+entry.name;
     if(entry.isSymbolicLink())throw Error('Linked artifact input requires separate review');
     if(entry.isDirectory())walk(file);else if(entry.isFile())inputs.add(file);
   }
 };
 for(const directory of ['apps/orchestrator/src','apps/orchestrator/dist','libraries/nestjs-libraries/src','libraries/helpers/src','scripts/recovery'])walk(directory);
 const files=[...inputs].sort().map(file=>({file,sha256:hash(fs.readFileSync(path.join(root,file)))}));
 return {kind:'LOCAL_REVIEW_CANDIDATE',targetVersion:'1.7.5',sourceVersion:fs.readFileSync(path.join(root,'version.txt'),'utf8').trim(),protocolVersion:1,
  files,sourceDigest:hash(JSON.stringify(files)),imageDigest:null,oldConsumersContained:false,activationAuthorized:false};
}
function verifyReviewArtifact(artifact){
 if(artifact.kind!=='LOCAL_REVIEW_CANDIDATE'||artifact.protocolVersion!==1||artifact.activationAuthorized!==false||artifact.oldConsumersContained!==false||artifact.imageDigest!==null)throw Error('Unreviewed worker protocol or activation claim');
 const expected=createReviewArtifact();if(artifact.targetVersion!==expected.targetVersion||artifact.sourceVersion!==expected.sourceVersion||artifact.sourceDigest!==expected.sourceDigest||JSON.stringify(artifact.files)!==JSON.stringify(expected.files))throw Error('Artifact source differs from reviewed guards');
 return {protocolVerified:1,sourceDigest:expected.sourceDigest,productionContainmentVerified:false,activationAuthorized:false};
}
module.exports={createReviewArtifact,verifyReviewArtifact};
if(require.main===module){try{const output=process.argv[2];if(!output)throw Error('Explicit new output path required');fs.writeFileSync(path.resolve(output),JSON.stringify(createReviewArtifact(),null,2)+'\n',{flag:'wx'});console.log('Local review metadata written; release and activation remain unavailable.');}catch{console.error('Review artifact unavailable; no activation attempted.');process.exitCode=1;}}
