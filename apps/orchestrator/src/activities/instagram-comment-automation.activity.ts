import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { InstagramCommentAutomationService } from '@gitroom/nestjs-libraries/instagram-comment-automation/instagram-comment-automation.service';

@Injectable()
@Activity()
export class InstagramCommentAutomationActivity {
  constructor(private _automation: InstagramCommentAutomationService) {}

  @ActivityMethod()
  prepare(webhookEventId: string) {
    return this._automation.prepare(webhookEventId);
  }

  @ActivityMethod()
  deliverPublicReply(executionId: string) {
    return this._automation.deliverPublicReply(executionId);
  }

  @ActivityMethod()
  deliverPrivateReply(executionId: string) {
    return this._automation.deliverPrivateReply(executionId);
  }

  @ActivityMethod()
  markDeliveryFailedAfterRetries(
    executionId: string,
    delivery: 'public' | 'private',
    error: string
  ) {
    return this._automation.markDeliveryFailedAfterRetries(
      executionId,
      delivery,
      error
    );
  }

  @ActivityMethod()
  finalize(executionId: string, webhookEventId: string) {
    return this._automation.finalize(executionId, webhookEventId);
  }
}
