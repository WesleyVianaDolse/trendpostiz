import { TemporalModule } from 'nestjs-temporal-core';
import { socialIntegrationList } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  assertWorkerConsumptionPrepared,
  checkWorkerConsumption,
  workerRuntime,
} from '../automation-recovery/worker-consumption';
import { ApplicationFailure } from '@temporalio/common';
import { Client, Connection } from '@temporalio/client';
import { temporalClientTls } from './temporal-tls';

export const getTemporalModule = (
  isWorkers: boolean,
  path?: string,
  activityClasses?: any[]
) => {
  if (isWorkers) assertWorkerConsumptionPrepared();
  return TemporalModule.register({
    isGlobal: true,
    enableLogger: true,
    logLevel: 'info',
    // A scheduler without workers must not look healthy. The worker library
    // otherwise tolerates an unavailable Temporal server during startup and
    // keeps the process alive without ever polling task queues.
    allowConnectionFailure: false,
    autoRestart: false,
    maxRestarts: 50,
    connection: {
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      ...temporalClientTls(),
      ...(process.env.TEMPORAL_API_KEY
        ? { apiKey: process.env.TEMPORAL_API_KEY }
        : {}),
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    },
    taskQueue: 'main',
    ...(isWorkers
      ? {
          workers: [
            { identifier: 'main', maxConcurrentJob: undefined },
            ...socialIntegrationList,
          ]
            .filter((f) => f.identifier.indexOf('-') === -1)
            .map((integration) => ({
              taskQueue: integration.identifier.split('-')[0],
              ...(workerRuntime().workflowBundlePath
                ? {
                    workflowBundle: {
                      codePath: workerRuntime().workflowBundlePath,
                    },
                  }
                : { workflowsPath: path! }),
              activityClasses: activityClasses!,
              autoStart: false,
              workerOptions: {
                // Resource budget for the explicitly isolated 32-queue candidate.
                maxCachedWorkflows: 8,
                workflowThreadPoolSize: 1,
                maxConcurrentWorkflowTaskExecutions: 4,
                ...(integration.maxConcurrentJob
                  ? {
                      maxConcurrentActivityTaskExecutions:
                        integration.maxConcurrentJob,
                    }
                  : {}),
                interceptors: {
                  activityInbound: [
                    (ctx) => ({
                      execute: async (input, next) => {
                        try {
                          const policy = await checkWorkerConsumption(
                            ctx.info.workflowExecution
                          );
                          // Old auxiliary tasks have no publication receipt contract.
                          // Retain them rather than replaying emails/webhooks by accident.
                          const guarded =
                            /^(recoveryPublication|postSocial|postComment|updatePost|recordPublicationFailure|get|is|searchForMissing)/.test(
                              ctx.info.activityType
                            );
                          if (!guarded) {
                            const c = await Connection.connect({
                              address: process.env.TEMPORAL_ADDRESS,
                              ...temporalClientTls(),
                            });
                            try {
                              const d = await new Client({
                                connection: c,
                                namespace:
                                  process.env.TEMPORAL_NAMESPACE || 'default',
                              }).workflow
                                .getHandle(
                                  ctx.info.workflowExecution.workflowId,
                                  ctx.info.workflowExecution.runId
                                )
                                .describe();
                              if (+d.startTime < +new Date(policy.cutoffAt))
                                throw new Error('LEGACY_AUXILIARY_RETAINED');
                            } finally {
                              await c.close();
                            }
                          }
                        } catch {
                          throw ApplicationFailure.nonRetryable(
                            'RECOVERY_ACTIVITY_RETAINED'
                          );
                        }
                        return next(input);
                      },
                    }),
                  ],
                },
              },
            })),
        }
      : {}),
  });
};
