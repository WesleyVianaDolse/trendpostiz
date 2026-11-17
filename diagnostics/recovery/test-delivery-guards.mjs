// Isolated PostgreSQL 17.11 + loopback HTTP. Never reads .env or starts workers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url)), req = createRequire(path.join(root, 'package.json'));
req(path.join(root, 'scripts/recovery/verify-owned-chain.cjs')).verifyOwnedChain();
const candidate = path.join(root, 'libraries/nestjs-libraries/src/database/prisma/baseline-proposal/prisma-owned');
const label = 'delivery-guards-' + randomUUID(), temp = fs.mkdtempSync(path.join(os.tmpdir(), label + '-'));
const env = Object.fromEntries(['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const docker = args => { const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true }); if (r.status !== 0) throw Error(r.stderr || r.error?.message); return r.stdout.trim(); };
let container, network;
try {
  if (process.env.DOCKER_HOST && !/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST)) throw Error('Remote Docker forbidden');
  assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']), /^(npipe|unix):\/\//);
  network = docker(['network','create','--label','trendpostiz.guards=' + label, label]);
  container = docker(['run','--detach','--rm','--name',label,'--label','trendpostiz.guards=' + label,'--network',network,
    '--publish','127.0.0.1::5432','-e','POSTGRES_USER=guard_test','-e','POSTGRES_PASSWORD=synthetic-only','-e','POSTGRES_DB=guard_test','postgres:17.11']);
  let ready = false;
  for (let n = 0; n < 60; n++) { if (spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','guard_test'],{stdio:'ignore',windowsHide:true}).status === 0) { ready = true; break; } await new Promise(r => setTimeout(r,300)); }
  assert(ready); const address = docker(['port',container,'5432/tcp']); assert.match(address,/^127\.0\.0\.1:\d+$/);
  const url = `postgresql://guard_test:synthetic-only@${address}/guard_test`;
  fs.copyFileSync(path.join(candidate,'schema.current.prisma'),path.join(temp,'schema.prisma'));
  fs.cpSync(path.join(candidate,'migrations'),path.join(temp,'migrations'),{recursive:true});
  const migration = spawnSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','deploy','--schema',path.join(temp,'schema.prisma')],
    {cwd:temp,env:{...env,DATABASE_URL:url},encoding:'utf8',windowsHide:true});
  assert.equal(migration.status,0,migration.stdout + migration.stderr);
  const child = spawnSync(process.execPath,[path.join(root,'diagnostics/recovery/delivery-guards-fixture.cjs'),root,url,path.join(root,'diagnostics/recovery/delivery-guards-results.json')],
    {cwd:temp,env:{...env,DATABASE_URL:url},encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
  process.stdout.write(child.stdout || ''); assert.equal(child.status,0,child.stderr || child.error?.message);
} finally {
  if (container) { assert.equal(docker(['inspect','--format','{{ index .Config.Labels "trendpostiz.guards" }}',container]),label); docker(['rm','--force',container]); }
  if (network) { assert.equal(docker(['network','inspect','--format','{{ index .Labels "trendpostiz.guards" }}',network]),label); docker(['network','rm',network]); }
}
