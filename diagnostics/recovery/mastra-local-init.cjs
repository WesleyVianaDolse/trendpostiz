// Disposable DB child only. Never import the application's store or .env.
const assert = require('node:assert/strict');
const { PostgresStore } = require(process.argv[2]);
const address = new URL(process.argv[3]);
assert.equal(address.hostname, '127.0.0.1');
assert.equal(address.pathname, '/shared');
assert.equal(address.username, 'mastra_owner');
const store = new PostgresStore({ id: 'isolated-ownership-test', connectionString: address.href, max: 4 });
(async () => {
  try {
    await store.init();
    console.log('ISOLATED_MASTRA_STORAGE_INITIALIZED');
  } finally { await store.close(); }
})().catch(() => { console.error('ISOLATED_MASTRA_INIT_FAILED'); process.exitCode = 1; });
