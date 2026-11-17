// Fetch only platform-specific test binaries. Never modifies project node_modules.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const req = createRequire(path.join(root, 'package.json'));
const tar = req('tar');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trendpostiz-linux-test-overlay-'));
const packages = [
  ['@img/sharp-linux-x64', req('sharp/package.json').optionalDependencies['@img/sharp-linux-x64']],
  ['@img/sharp-libvips-linux-x64', req('sharp/package.json').optionalDependencies['@img/sharp-libvips-linux-x64']],
  ['@swc/core-linux-x64-gnu', req('@swc/core/package.json').version],
];
await Promise.all(packages.map(async ([name, version]) => {
  const metadata = await (await fetch(`https://registry.npmjs.org/${name}/${version}`)).json();
  const buffer = Buffer.from(await (await fetch(metadata.dist.tarball)).arrayBuffer());
  const integrity = 'sha512-' + createHash('sha512').update(buffer).digest('base64');
  if (integrity !== metadata.dist.integrity) throw new Error('npm integrity mismatch: ' + name);
  const target = path.join(dir, 'node_modules', name);
  fs.mkdirSync(target, { recursive: true });
  const archive = path.join(dir, name.replaceAll('/', '_') + '.tgz');
  fs.writeFileSync(archive, buffer);
  await tar.x({ file: archive, cwd: target, strip: 1 });
}));
const engineVersion = req('@prisma/engines-version').enginesVersion;
const engineUrl = `https://binaries.prisma.sh/all_commits/${engineVersion}/debian-openssl-3.0.x/libquery_engine.so.node.gz`;
const engine = gunzipSync(Buffer.from(await (await fetch(engineUrl)).arrayBuffer()));
const expected = (await (await fetch(engineUrl.replace(/\.gz$/, '.sha256'))).text()).trim().split(/\s+/)[0];
if (createHash('sha256').update(engine).digest('hex') !== expected) throw new Error('Prisma engine integrity mismatch');
fs.writeFileSync(path.join(dir, 'libquery_engine.so.node'), engine);
const bcryptVersion = req('bcrypt/package.json').version;
const bcryptResponse = await fetch(`https://github.com/kelektiv/node.bcrypt.js/releases/download/v${bcryptVersion}/bcrypt_lib-v${bcryptVersion}-napi-v3-linux-x64-glibc.tar.gz`);
if (!bcryptResponse.ok) throw new Error('Could not fetch Linux bcrypt test binary');
const bcryptArchive = path.join(dir, 'bcrypt-linux.tgz');
fs.writeFileSync(bcryptArchive, Buffer.from(await bcryptResponse.arrayBuffer()));
await tar.x({ file: bcryptArchive, cwd: dir });
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ packages, engineVersion, bcryptVersion }, null, 2));
console.log(dir);
