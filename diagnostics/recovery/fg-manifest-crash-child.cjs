const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  Module = require('node:module');
const [root, url, endpoint, inputFile, mode] = process.argv.slice(2);
assert.equal(new URL(url).hostname, '127.0.0.1');
assert.equal(new URL(url).username, 'guard_test');
assert.equal(new URL(url).pathname, '/guard_test');
require('reflect-metadata');
require('ts-node').register({project:path.join(root,'tsconfig.base.json'),transpileOnly:true,compilerOptions:{module:'commonjs',target:'es2020',incremental:false}});
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name,parent,...rest){
  if(name.startsWith('@gitroom/nestjs-libraries/'))name=path.join(root,'libraries/nestjs-libraries/src',name.slice('@gitroom/nestjs-libraries/'.length));
  return resolve.call(this,name,parent,...rest);
};
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({datasources:{db:{url}}});
const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const { RecoveryManifestService } = require(path.join(root,'libraries/nestjs-libraries/src/automation-recovery/recovery-manifest.service.ts'));
const proxy = new Proxy(db, {
  get(target, k) {
    if (k === '$transaction')
      return async (fn, opts) =>
        target.$transaction(
          (tx) =>
            fn(
              new Proxy(tx, {
                get(t, key) {
                  if (key === 'recoveryManifest' && mode === 'before-commit')
                    return new Proxy(t[key], {
                      get(delegate, method) {
                        if (method === 'update')
                          return async (args) => {
                            const result = await delegate.update(args);
                            if (args.data.cursor > 0) process.exit(87);
                            return result;
                          };
                        return delegate[method];
                      },
                    });
                  return t[key];
                },
              })
            ),
          opts
        );
    const v = target[k];
    return typeof v === 'function' ? v.bind(target) : v;
  },
});
new RecoveryManifestService(proxy)
  .draft(
    'operator',
    input.recoveryId,
    new Date(input.cutoffAt),
    input.source,
    1,
    async () => {
      if (mode === 'after-commit') process.exit(87);
    }
  )
  .then(() => {
    throw Error('Expected fixture process loss');
  })
  .catch(() => {
    process.exitCode = 1;
  });
