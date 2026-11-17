const assert = require('node:assert/strict'),
  http = require('node:http'),
  path = require('node:path');
const [root, url] = process.argv.slice(2);
assert.equal(new URL(url).hostname, '127.0.0.1');
assert.equal(new URL(url).username, 'guard_test');
require(path.join(root, 'node_modules/ts-node')).register({
  project: path.join(root, 'tsconfig.base.json'),
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', target: 'es2020', incremental: false },
});
const { assertWorkerConsumptionPrepared } = require(path.join(
  root,
  'libraries/nestjs-libraries/src/automation-recovery/worker-consumption.ts'
));
assert.throws(assertWorkerConsumptionPrepared, /ACTIVATION_UNAVAILABLE/);
const { PrismaClient } = require(path.join(
    root,
    'node_modules/@prisma/client'
  )),
  db = new PrismaClient({ datasources: { db: { url } } });
(async () => {
  const control = await db.automationRecoveryControl.findUnique({
    where: { id: 'global' },
  });
  await db.$disconnect();
  const server = http.createServer((_, r) => r.end('synthetic'));
  server.listen(0, '127.0.0.1', () =>
    process.send(
      {
        port: server.address().port,
        runId: control.runId,
        generation: control.generation,
        consumptionBlocked: true,
      },
      () => {
        setTimeout(() => process.stdout.write('INTERNAL_TIMER_FIRED'), 100);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
    )
  );
})().catch(() => process.exit(1));
