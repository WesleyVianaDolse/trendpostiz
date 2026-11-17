// Explicit isolated-candidate entrypoint. Ordinary start/preflight stays closed.
import { PrismaClient } from '@prisma/client';
import { prepareWorkerConsumption } from '../../../libraries/nestjs-libraries/src/automation-recovery/worker-consumption';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function start() {
  const artifactRoot = resolve(
    process.env.RECOVERY_ARTIFACT_ROOT || process.cwd()
  );
  const verifier = require(resolve(
    artifactRoot,
    'scripts/recovery/runtime-artifact.cjs'
  ));
  const artifact = verifier.verify(
    artifactRoot,
    JSON.parse(
      readFileSync(resolve(artifactRoot, 'worker-artifact.json'), 'utf8')
    )
  );
  const prisma = new PrismaClient();
  // Load the real registry; no synthetic activity/provider substitution in image.
  const { socialIntegrationList } = await import(
    '../../../libraries/nestjs-libraries/src/integrations/integration.manager'
  );
  const queues = [
    'main',
    ...socialIntegrationList
      .filter((p) => !p.identifier.includes('-'))
      .map((p) => p.identifier),
  ];
  await prepareWorkerConsumption(prisma, {
    sourceDigest: artifact.sourceDigest,
    imageDigest: process.env.RECOVERY_IMAGE_DIGEST || '',
    queues,
    workflowBundlePath: resolve(artifactRoot, 'dist/workflow-bundle.cjs'),
  });
  await import('./main');
}
start().catch(() => {
  console.error('SIGNED_WORKER_ADMISSION_REFUSED');
  process.exit(78);
});
