// Only used by the isolated test harness; creates no external effect.
const path = require('node:path'),
  assert = require('node:assert/strict');
const root = process.argv[2],
  url = new URL(process.argv[3]),
  context = JSON.parse(process.argv[4]),
  mode = process.argv[5];
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.username, 'guard_test');
assert.equal(url.pathname, '/guard_test');
require(path.join(root, 'node_modules/reflect-metadata'));
require(path.join(root, 'node_modules/ts-node')).register({
  project: path.join(root, 'tsconfig.base.json'),
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', incremental: false },
});
const { PrismaClient } = require(path.join(
  root,
  'node_modules/@prisma/client'
));
const { AutomationRecoveryService } = require(path.join(
  root,
  'libraries/nestjs-libraries/src/automation-recovery/automation-recovery.service.ts'
));
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
(async () => {
  if (mode === 'before-commit')
    await db.$transaction(async (tx) => {
      await tx.automationRecoveryDecision.create({
        data: {
          recoveryId: 'run-1',
          organizationId: 'org-a',
          subjectKey: 'crash-uncommitted',
          action: 'EXPIRE',
          reason: 'synthetic rollback proof',
        },
      });
      process.exit(86);
    });
  try {
    await new AutomationRecoveryService(db).executePublication(
      context,
      async () => {
        throw Error('HTTP forbidden in crash fixture');
      }
    );
  } catch (error) {
    assert(
      ['BEFORE_RECOVERY_CUTOFF', 'OCCURRENCE_TERMINALLY_HELD'].includes(
        error.reason
      )
    );
  }
  // Intentional owned-child crash after a committed decision, before the next
  // batch item. No disconnect/finally simulates process loss, not a lease retry.
  process.exit(86);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
