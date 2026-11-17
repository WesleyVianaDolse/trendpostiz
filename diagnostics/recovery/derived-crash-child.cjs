const assert = require('node:assert/strict'),
  path = require('node:path');
const [root, url, endpoint, serialized] = process.argv.slice(2),
  input = JSON.parse(serialized),
  u = new URL(url);
assert.equal(u.hostname, '127.0.0.1');
assert.equal(u.username, 'guard_test');
assert.equal(u.pathname, '/guard_test');
assert.equal(new URL(endpoint).hostname, '127.0.0.1');
const env = require('./derived-fixture-support.cjs')(
    root,
    url,
    endpoint,
    () => input.caseId
  ),
  { db } = env;
let reserve = false,
  confirmed = false;
const proxy = new Proxy(db, {
  get(target, key) {
    if (key === '$transaction')
      return async (fn, options) => {
        const result = await target.$transaction(
          async (tx) =>
            fn(
              new Proxy(tx, {
                get(t, k) {
                  if (k !== 'automationEffectAttempt') return t[k];
                  return new Proxy(t[k], {
                    get(delegate, method) {
                      if (method === 'create')
                        return async (args) => {
                          const row = await delegate.create(args);
                          if (args.data.subjectKey?.startsWith('derived:'))
                            reserve = true;
                          return row;
                        };
                      if (method === 'updateMany')
                        return async (args) => {
                          if (args.data.phase === 'CONFIRMED') {
                            if (input.mode === 'before-confirmation')
                              process.exit(86);
                            confirmed = true;
                          }
                          return delegate.updateMany(args);
                        };
                      return delegate[method];
                    },
                  });
                },
              })
            ),
          options
        );
        if (
          (input.mode === 'after-reservation' && reserve) ||
          (input.mode === 'after-confirmation' && confirmed)
        )
          process.exit(86);
        return result;
      };
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
(async () => {
  const recovery = new env.AutomationRecoveryService(proxy),
    derived = new env.DerivedPublicationService(proxy, recovery, env.manager);
  await derived.bind(input.context, input.actionId, 0);
  if (input.mode === 'before-reservation') process.exit(86);
  await derived.executeScheduled(
    input.context,
    'org-a',
    input.rootOccurrenceId,
    input.actionId,
    0
  );
  throw Error('Expected controlled synthetic process loss');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
