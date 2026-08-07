import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleInit,
} from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

@Injectable()
export class InfiniteWorkflowRegister implements OnModuleInit {
  private readonly logger = new Logger(InfiniteWorkflowRegister.name);

  constructor(private _temporalService: TemporalService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.RUN_CRON !== 'true') {
      this.logger.warn(
        'Late-post recovery is disabled because RUN_CRON is not true.'
      );
      return;
    }

    try {
      await this._temporalService.client
        .getRawClient()
        .workflow.start('missingPostWorkflow', {
          workflowId: 'missing-post-workflow',
          taskQueue: 'main',
        });
      this.logger.log('Late-post recovery workflow started.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('already started')) {
        this.logger.log('Late-post recovery workflow is already running.');
        return;
      }
      this.logger.error(
        'Failed to start the late-post recovery workflow.',
        error instanceof Error ? error.stack : message
      );
      throw error;
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [InfiniteWorkflowRegister],
  get exports() {
    return this.providers;
  },
})
export class InfiniteWorkflowRegisterModule {}
