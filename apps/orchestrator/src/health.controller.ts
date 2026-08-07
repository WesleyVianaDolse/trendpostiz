import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { Connection } from '@temporalio/client';
import { TemporalService } from 'nestjs-temporal-core';

@Controller('health')
export class HealthController {
  constructor(private readonly temporalService: TemporalService) {}

  @Get('/status')
  async getHealthStatus(@Res() res: Response) {
    let connection: Connection | undefined;
    try {
      const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
      connection = await Connection.connect({
        address,
        ...(process.env.TEMPORAL_TLS === 'true' ? { tls: true } : {}),
        ...(process.env.TEMPORAL_API_KEY
          ? { apiKey: process.env.TEMPORAL_API_KEY }
          : {}),
      });

      const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
      await Promise.race([
        connection.workflowService.describeNamespace({ namespace }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 10000)
        ),
      ]);
      const workers = this.temporalService.getAllWorkers();
      const workerStatuses = workers
        ? Array.from(workers.workers.entries()).map(([taskQueue, status]) => ({
            taskQueue,
            running: status.isRunning,
            healthy: status.isHealthy,
            lastError: status.lastError,
          }))
        : [];
      const mainWorker = workerStatuses.find(
        (worker) => worker.taskQueue === 'main'
      );
      const allWorkersHealthy =
        workerStatuses.length > 0 &&
        workerStatuses.every((worker) => worker.running && worker.healthy);

      if (!mainWorker?.running || !mainWorker.healthy || !allWorkersHealthy) {
        return res.status(503).json({
          status: 'error',
          temporal: 'connected',
          workers: workerStatuses,
        });
      }

      return res.status(200).json({
        status: 'ok',
        temporal: 'connected',
        workers: workerStatuses,
      });
    } catch (error) {
      return res.status(503).json({
        status: 'error',
        temporal: 'disconnected',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await connection?.close().catch(() => {});
    }
  }
}
