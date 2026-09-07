import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import { InstagramCommentAutomationRepository } from '@gitroom/nestjs-libraries/database/prisma/instagram-comment-automations/instagram-comment-automation.repository';

const RECONCILIATION_INTERVAL_MS = 60_000;

@Injectable()
export class InstagramCommentAutomationDispatcherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    InstagramCommentAutomationDispatcherService.name
  );
  private timer?: NodeJS.Timeout;

  constructor(
    private _temporal: TemporalService,
    private _repository: InstagramCommentAutomationRepository
  ) {}

  onModuleInit() {
    void this.reconcile();
    this.timer = setInterval(
      () => void this.reconcile(),
      RECONCILIATION_INTERVAL_MS
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch(webhookEventId: string) {
    const client = this._temporal.client.getRawClient();
    if (!client) throw new Error('Temporal client is unavailable');

    const workflowId = `instagram-comment-${webhookEventId}`;
    try {
      await client.workflow.start('instagramCommentAutomationWorkflow', {
        workflowId,
        args: [{ webhookEventId }],
        taskQueue: 'main',
        workflowIdConflictPolicy: 'USE_EXISTING',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('already started')) return;

      // A timeout may happen after Temporal accepted the start. Treat an
      // existing deterministic workflow as successfully dispatched.
      try {
        await client.workflow.getHandle(workflowId).describe();
        return;
      } catch {
        throw error;
      }
    }
  }

  async dispatchMany(webhookEventIds: string[]) {
    const results = await Promise.allSettled(
      webhookEventIds.map((id) => this.dispatch(id))
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Could not dispatch Instagram webhook event ${webhookEventIds[index]}; reconciliation will retry it.`
        );
      }
    });
  }

  async reconcile() {
    try {
      const events = await this._repository.findReceivedEventIds();
      await this.dispatchMany(events.map(({ id }) => id));
    } catch {
      this.logger.warn(
        'Instagram comment automation reconciliation failed; it will retry on the next interval.'
      );
    }
  }
}
