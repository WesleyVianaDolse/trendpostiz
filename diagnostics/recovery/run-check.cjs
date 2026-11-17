// Credential-free build/test subprocesses. Never starts an application.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const commands = {
  typesBackend: ['node_modules/typescript/bin/tsc', '--project', 'apps/backend/tsconfig.build.json', '--noEmit', '--incremental', 'false'],
  typesOrchestrator: ['node_modules/typescript/bin/tsc', '--project', 'apps/orchestrator/tsconfig.build.json', '--noEmit', '--incremental', 'false'],
  typesFrontend: ['node_modules/typescript/bin/tsc', '--project', 'apps/frontend/tsconfig.json', '--noEmit', '--incremental', 'false'],
  buildBackend: ['node_modules/@nestjs/cli/bin/nest.js','build','--config','apps/backend/nest-cli.json','--path','apps/backend/tsconfig.build.json'],
  buildOrchestrator: ['node_modules/@nestjs/cli/bin/nest.js','build','--config','apps/orchestrator/nest-cli.json','--path','apps/orchestrator/tsconfig.build.json'],
  buildFrontend: ['node_modules/next/dist/bin/next','build','apps/frontend'],
  regression: ['node_modules/jest/bin/jest.js','--config','apps/backend/jest.instagram-webhook.config.js','--runInBand','--testPathPattern','instagram|post-access|youtube-publication'],
  frontendRegression: ['node_modules/jest/bin/jest.js','--config','apps/frontend/jest.instagram-automations.config.cjs','--runInBand'],
  recoveryUI: ['node_modules/jest/bin/jest.js','--config','apps/frontend/jest.recovery.config.cjs','--runInBand'],
  derived: ['node_modules/jest/bin/jest.js','--config','apps/backend/jest.instagram-webhook.config.js','--runInBand','--runTestsByPath','libraries/nestjs-libraries/src/automation-recovery/derived-effect-result.spec.ts'],
  instagram: ['node_modules/jest/bin/jest.js', '--config', 'apps/backend/jest.instagram-webhook.config.js', '--runInBand', '--runTestsByPath',
    'libraries/nestjs-libraries/src/instagram-comment-automation/instagram-comment-automation.service.spec.ts',
    'libraries/nestjs-libraries/src/database/prisma/instagram-comment-automations/instagram-comment-automation.repository.spec.ts',
    'libraries/nestjs-libraries/src/database/prisma/instagram-webhooks/instagram-webhook-events.repository.spec.ts',
    'libraries/nestjs-libraries/src/instagram-comment-automation/instagram-comment-automation-dispatcher.service.spec.ts'],
};
const args = commands[process.argv[2]];
if (!args) throw Error('Unknown local check');
const env = Object.fromEntries(['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP'].filter(k => process.env[k]).map(k => [k,process.env[k]]));
if (process.argv[2].startsWith('build')) {
  // Nest may remove its explicit outDir; verify it stays inside this workspace.
  const fs = require('node:fs');
  for(const app of ['backend','orchestrator']) {
    const config=JSON.parse(fs.readFileSync(path.join(root,`apps/${app}/tsconfig.build.json`),'utf8'));
    const target=path.resolve(root,`apps/${app}`,config.compilerOptions.outDir);
    if(target!==path.join(root,`apps/${app}/dist`))throw Error('Unexpected build outDir');
  }
  // Next's own env loader must also have nothing to inherit from files.
  for(const name of ['.env','.env.local','.env.production','.env.production.local']) {
    if(fs.existsSync(path.join(root,'apps/frontend',name)))throw Error('Isolate frontend environment files before building');
  }
  Object.assign(env,{NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_BACKEND_URL:'http://127.0.0.1:1',BACKEND_INTERNAL_URL:'http://127.0.0.1:1',
    FRONTEND_URL:'http://127.0.0.1:4200',STORAGE_PROVIDER:'local',UPLOAD_DIRECTORY:path.join(require('node:os').tmpdir(),'trendpostiz-build-synthetic'),JWT_SECRET:'synthetic-build-only'});
}
const r = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
process.exitCode = r.status ?? 1;
