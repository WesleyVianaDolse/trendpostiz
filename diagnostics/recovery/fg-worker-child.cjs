// A second actual Node worker process. Owned loopback fixtures only.
const path = require('node:path'),
  assert = require('node:assert/strict');
const [root, url, endpoint, address, bundlePath, queue, options = '{}'] =
  process.argv.slice(2);
assert.equal(new URL(url).hostname, '127.0.0.1');
assert.equal(new URL(url).username, 'guard_test');
assert.equal(new URL(endpoint).hostname, '127.0.0.1');
assert.match(address, /^127\.0\.0\.1:\d+$/);
const stage=value=>{if(process.send)process.send({stage:value});};
stage('loading-activity-dependencies');
const e = require('./fg-fixture-support.cjs')(
  root,
  url,
  endpoint,
  { ...JSON.parse(options), onStage: stage }
);
assert(!Object.keys(require.cache).some((file) => file.replace(/\\/g,'/').endsWith('/integrations/integration.manager.ts')), 'Unused provider registry loaded by fixture metadata');
const { Worker, NativeConnection, Runtime, DefaultLogger } =
    e.req('@temporalio/worker'),
  { Client, Connection } = e.req('@temporalio/client');
Runtime.install({ logger: new DefaultLogger('ERROR') });
stage('connecting-clients');
(async () => {
  const connection = await Connection.connect({ address }),
    native = await NativeConnection.connect({ address });
  e.setClient(new Client({ connection, namespace: 'default' }));
  stage('creating-activity-worker');
  const activities = Object.fromEntries(Object.entries(e.activities).map(([name, activity]) => [name, async (...args) => {
    if (process.send) process.send({activityStarted:name});
    return activity(...args);
  }]));
  const worker = await Worker.create({
    connection: native,
    namespace: 'default',
    taskQueue: queue,
    // This queue receives publication activities; workflows run in the parent.
    // Avoid allocating unused workflow isolates in every synthetic child.
    activities,
    maxConcurrentActivityTaskExecutions:1,
  });
  let requested = false;
  process.on('SIGTERM', () => {
    if (!requested) {
      requested = true;
      worker.shutdown();
    }
  });
  if (process.send)
    process.on('message', (m) => {
      if (m === 'stop' && !requested) {
        requested = true;
        worker.shutdown();
      }
    });
  const running=worker.run();
  if (process.send) process.send({ ready: true, pid: process.pid,role:'ACTIVITY_ONLY' });
  try {
    await running;
  } finally {
    await native.close();
    await connection.close();
    await e.db.$disconnect();
    if (process.connected) process.disconnect();
  }
})().catch(() => {
  console.error('Isolated child worker failed');
  process.exitCode = 1;
});
