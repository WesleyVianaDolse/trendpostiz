import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('orchestrator', true);
import 'source-map-support/register';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);

import { NestFactory } from '@nestjs/core';
import { AppModule } from '@gitroom/orchestrator/app.module';
import { TemporalService } from 'nestjs-temporal-core';
import * as dns from 'node:dns';
import {
  checkWorkerConsumption,
  beginWorkerConsumption,
  workerRuntime,
} from '../../../libraries/nestjs-libraries/src/automation-recovery/worker-consumption';
dns.setDefaultResultOrder('ipv4first');

const STARTUP_TIMEOUT_MS = 120_000;
const WORKER_HEALTH_GRACE_MS = 60_000;
const WORKER_HEALTH_INTERVAL_MS = 30_000;
const MAX_UNHEALTHY_CHECKS = 3;

const exitForRestart = (message: string) => {
  console.error(`[orchestrator-watchdog] ${message}`);
  process.exit(1);
};

async function bootstrap() {
  const startupWatchdog = setTimeout(
    () =>
      exitForRestart(
        `Startup did not finish within ${STARTUP_TIMEOUT_MS / 1000} seconds.`
      ),
    STARTUP_TIMEOUT_MS
  );

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.init();
  const temporalService = app.get(TemporalService);
  const initialized = temporalService.getAllWorkers();
  if (
    !initialized ||
    JSON.stringify([...initialized.workers.keys()].sort()) !==
      JSON.stringify(workerRuntime().queues.sort())
  )
    throw new Error('Incomplete worker catalog');
  await beginWorkerConsumption();
  await Promise.all(
    workerRuntime().queues.map((queue) =>
      temporalService.startWorkerByTaskQueue(queue)
    )
  );
  const port = process.env.ORCHESTRATOR_PORT || 3002;
  await app.listen(port);
  clearTimeout(startupWatchdog);
  console.log(`Orchestrator health check listening on port ${port}`);

  let consecutiveUnhealthyChecks = 0;

  setTimeout(() => {
    setInterval(() => {
      void checkWorkerConsumption().catch(() =>
        exitForRestart('Signed admission revoked, expired or unavailable.')
      );
      const workers = temporalService.getAllWorkers();
      const workerStatuses = workers
        ? Array.from(workers.workers.entries()).map(([taskQueue, status]) => ({
            taskQueue,
            running: status.isRunning,
            healthy: status.isHealthy,
            lastError: status.lastError ? String(status.lastError) : undefined,
          }))
        : [];
      const allWorkersHealthy =
        workerStatuses.length === workerRuntime().queues.length &&
        workerRuntime().queues.every((queue) =>
          workerStatuses.some((worker) => worker.taskQueue === queue)
        ) &&
        workerStatuses.some((worker) => worker.taskQueue === 'main') &&
        workerStatuses.every((worker) => worker.running && worker.healthy);

      if (allWorkersHealthy) {
        consecutiveUnhealthyChecks = 0;
        return;
      }

      consecutiveUnhealthyChecks += 1;
      console.error(
        `[orchestrator-watchdog] Unhealthy workers (${consecutiveUnhealthyChecks}/${MAX_UNHEALTHY_CHECKS}): ${JSON.stringify(
          workerStatuses
        )}`
      );

      if (consecutiveUnhealthyChecks >= MAX_UNHEALTHY_CHECKS) {
        exitForRestart('Temporal workers remained unhealthy.');
      }
    }, WORKER_HEALTH_INTERVAL_MS);
  }, WORKER_HEALTH_GRACE_MS);
}

bootstrap().catch((error) => {
  exitForRestart(
    `Bootstrap failed: ${error instanceof Error ? error.stack : String(error)}`
  );
});
