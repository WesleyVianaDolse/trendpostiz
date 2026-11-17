import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'trendpostiz-client-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const lock = hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml')));
const output = path.join(root, 'node_modules/.prisma/client').replaceAll('\\', '/');
const schema = fs.readFileSync(path.join(root, 'libraries/nestjs-libraries/src/database/prisma/schema.prisma'), 'utf8')
  .replace(/provider\s*=\s*"prisma-client-js"/, `provider = "prisma-client-js"\n  output = "${output}"`);
fs.writeFileSync(path.join(temp, 'schema.prisma'), schema);
const env = Object.fromEntries(['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP'].filter(k => process.env[k]).map(k => [k,process.env[k]]));
const r = spawnSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'generate', '--schema', path.join(temp,'schema.prisma')],
  { cwd: temp, env: { ...env, DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/no_database' }, encoding: 'utf8', windowsHide: true });
assert.equal(r.status, 0, r.stdout + r.stderr);
assert.equal(hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), lock);
console.log('Local Prisma client generated; no DB connection; project lockfile preserved.');
