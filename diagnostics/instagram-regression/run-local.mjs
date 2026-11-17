// Disposable local PostgreSQL only. Never reads .env or uses a configured database.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const label = `instagram-regression-${randomUUID()}`;
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed: ${
        result.stderr || result.error?.message || result.stdout
      }`
    );
  return result.stdout.trim();
};
let container;
try {
  const context = run('docker', [
    'context',
    'inspect',
    '--format',
    '{{.Endpoints.docker.Host}}',
  ]);
  if (!context.startsWith('npipe://') && !context.startsWith('unix://')) {
    throw new Error('Only a local Docker daemon is allowed');
  }
  container = run('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    label,
    '--label',
    `trendpostiz.regression=${label}`,
    '--publish',
    '127.0.0.1::5432',
    '-e',
    'POSTGRES_USER=ig_regression',
    '-e',
    'POSTGRES_PASSWORD=local-test-only',
    '-e',
    'POSTGRES_DB=ig_regression',
    'postgres:16-alpine',
  ]);
  if (!/^[a-f0-9]{64}$/.test(container))
    throw new Error('Unexpected container identity');
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = spawnSync(
      'docker',
      [
        'exec',
        container,
        'pg_isready',
        '-U',
        'ig_regression',
        '-d',
        'ig_regression',
      ],
      { windowsHide: true, stdio: 'ignore' }
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
  const binding = run('docker', ['port', container, '5432/tcp']);
  if (!/^127\.0\.0\.1:\d+$/.test(binding))
    throw new Error('Database must be published only on loopback');
  const url = `postgresql://ig_regression:local-test-only@${binding}/ig_regression`;
  const env = {
    ...process.env,
    DATABASE_URL: url,
    INSTAGRAM_REGRESSION_TEST_DATABASE_URL: url,
  };
  run(
    process.execPath,
    [
      path.join(root, 'node_modules/prisma/build/index.js'),
      'db',
      'push',
      '--schema',
      'libraries/nestjs-libraries/src/database/prisma/schema.prisma',
      '--skip-generate',
    ],
    { env }
  );
  const tests = spawnSync(
    process.execPath,
    [
      'node_modules/jest/bin/jest.js',
      '--config',
      'apps/backend/jest.instagram-webhook.config.js',
      '--runInBand',
      '--runTestsByPath',
      'apps/backend/src/services/instagram-comment-automations/instagram-version-regression.integration.spec.ts',
    ],
    { cwd: root, env, windowsHide: true, stdio: 'inherit' }
  );
  process.exitCode = tests.status ?? 1;
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Local regression test failed'
  );
  process.exitCode = 1;
} finally {
  if (container && /^[a-f0-9]{64}$/.test(container)) {
    const owner = run('docker', [
      'inspect',
      '--format',
      '{{ index .Config.Labels "trendpostiz.regression" }}',
      container,
    ]);
    if (owner !== label)
      throw new Error(
        'Refusing to remove a container not owned by this test run'
      );
    run('docker', ['rm', '--force', container]);
    console.log('Removed the disposable local PostgreSQL container.');
  }
}
