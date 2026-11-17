// Read-only artifact verification; never load .env or invoke Prisma/DB/workers.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const defaultCandidate = path.join(root, 'libraries/nestjs-libraries/src/database/prisma/baseline-proposal/prisma-owned');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function verifyOwnedChain(candidate = defaultCandidate, runtimeSchema = path.join(root, 'libraries/nestjs-libraries/src/database/prisma/schema.prisma')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'manifest.json'), 'utf8'));
  const policyFile = path.join(candidate, 'ownership-policy.json');
  assert.equal(hash(policyFile), manifest.ownershipPolicySha256, 'Ownership policy changed');
  assert.equal(hash(runtimeSchema), manifest.runtimeSchemaSha256, 'Runtime schema changed; regenerate/review the migration projection');
  assert.equal(hash(path.join(candidate, 'schema.baseline.prisma')), manifest.baselineSchemaSha256);
  assert.equal(hash(path.join(candidate, 'schema.current.prisma')), manifest.currentSchemaSha256);
  assert.equal(hash(path.join(root, 'pnpm-lock.yaml')), manifest.lockfileSha256, 'Dependency lock changed');
  assert.equal(hash(require.resolve('@mastra/pg')), manifest.mastraPgSourceSha256, 'Mastra implementation changed');
  const expected = manifest.migrationChain.map(m => m.name).sort();
  assert(expected.every(n => /^\d{14}_[a-z0-9_]+$/.test(n)), 'Invalid migration name');
  const migrations = path.join(candidate, 'migrations');
  const actual = fs.readdirSync(migrations, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  assert.deepEqual(actual, expected, 'Unexpected or missing migration directory');
  for (const migration of manifest.migrationChain) {
    assert.equal(hash(path.join(migrations, migration.name, 'migration.sql')), migration.sha256, 'Unreviewed migration SQL: ' + migration.name);
  }
  return { status: 'OWNED_CANDIDATE_VERIFIED', productionAuthorized: false, workersAuthorized: false };
}
module.exports = { verifyOwnedChain };
if (require.main === module) {
  try { console.log(JSON.stringify(verifyOwnedChain())); }
  catch (error) { console.error('OWNED_CHAIN_REVIEW_REQUIRED: ' + error.message); process.exitCode = 78; }
}
