import { Injectable } from '@nestjs/common';
import { InstagramCommentAutomationRepository } from '@gitroom/nestjs-libraries/database/prisma/instagram-comment-automations/instagram-comment-automation.repository';
import { matchesInstagramComment } from '@gitroom/nestjs-libraries/instagram-comment-automation/instagram-comment-matching';
import {
  InstagramMetaApiError,
  InstagramStandaloneMessagingService,
} from '@gitroom/nestjs-libraries/integrations/social/instagram-standalone-messaging.service';

export interface InstagramCommentAutomationPreparation {
  process: boolean;
  executionId?: string;
  webhookEventId?: string;
  publicReplyPending?: boolean;
  privateReplyPending?: boolean;
  reason?: string;
}

@Injectable()
export class InstagramCommentAutomationService {
  constructor(
    private _repository: InstagramCommentAutomationRepository,
    private _messaging: InstagramStandaloneMessagingService
  ) {}

  async prepare(
    webhookEventId: string
  ): Promise<InstagramCommentAutomationPreparation> {
    const event = await this._repository.findEventForProcessing(webhookEventId);
    if (!event) return { process: false, reason: 'event_not_found' };

    if (event.automationExecution) {
      if (event.automationExecution.processedAt) {
        return { process: false, reason: 'already_processed' };
      }
      return {
        process: true,
        executionId: event.automationExecution.id,
        webhookEventId: event.id,
        publicReplyPending:
          event.automationExecution.publicReplyStatus === 'PENDING',
        privateReplyPending:
          event.automationExecution.privateReplyStatus === 'PENDING',
      };
    }

    if (event.status !== 'RECEIVED') {
      return { process: false, reason: 'event_not_receivable' };
    }

    if (
      !event.integration ||
      event.integration.deletedAt ||
      event.integration.disabled ||
      event.integration.providerIdentifier !== 'instagram-standalone' ||
      !event.mediaId ||
      !event.commentText ||
      !event.authorId ||
      !event.externalCommentId
    ) {
      await this._repository.updateEventStatus(event.id, 'SKIPPED');
      return { process: false, reason: 'missing_processing_data' };
    }

    if (event.authorId === event.integration.internalId) {
      await this._repository.updateEventStatus(event.id, 'SKIPPED');
      return { process: false, reason: 'own_account_comment' };
    }

    if (
      await this._repository.findExecutionByPublicReplyId(
        event.externalCommentId
      )
    ) {
      await this._repository.updateEventStatus(event.id, 'SKIPPED');
      return { process: false, reason: 'own_public_reply' };
    }

    const automation = await this._repository.findEnabledAutomation(
      event.integration.id,
      event.mediaId
    );
    if (
      !automation ||
      !matchesInstagramComment(
        event.commentText,
        automation.triggers,
        automation.matchType
      )
    ) {
      await this._repository.updateEventStatus(event.id, 'SKIPPED');
      return {
        process: false,
        reason: automation ? 'no_match' : 'no_automation',
      };
    }

    const publicReplyPending =
      automation.publicReplyEnabled && !!automation.publicReplyText?.trim();
    const privateReplyPending =
      automation.privateReplyEnabled && !!automation.privateReplyText?.trim();
    const execution = await this._repository.claimExecution({
      automationId: automation.id,
      webhookEventId: event.id,
      authorId: event.authorId,
      externalCommentId: event.externalCommentId,
      publicReplyStatus: publicReplyPending ? 'PENDING' : 'SKIPPED',
      privateReplyStatus: privateReplyPending ? 'PENDING' : 'SKIPPED',
    });

    if (!execution) {
      await this._repository.updateEventStatus(event.id, 'SKIPPED');
      return { process: false, reason: 'already_claimed' };
    }

    return {
      process: true,
      executionId: execution.id,
      webhookEventId: event.id,
      publicReplyPending,
      privateReplyPending,
    };
  }

  async deliverPublicReply(executionId: string) {
    const context = await this.getDeliveryContext(executionId, 'public');
    if (!context) return false;
    try {
      const replyId = await this._messaging.replyToComment(
        context.externalCommentId,
        context.text,
        context.token
      );
      await this._repository.updateDeliverySuccess(
        executionId,
        'public',
        replyId
      );
      return true;
    } catch (error) {
      return this.handleDeliveryError(executionId, 'public', error);
    }
  }

  async deliverPrivateReply(executionId: string) {
    const context = await this.getDeliveryContext(executionId, 'private');
    if (!context) return false;
    try {
      const replyId = await this._messaging.sendPrivateReplyFromComment(
        context.externalCommentId,
        context.text,
        context.token
      );
      await this._repository.updateDeliverySuccess(
        executionId,
        'private',
        replyId
      );
      return true;
    } catch (error) {
      return this.handleDeliveryError(executionId, 'private', error);
    }
  }

  async markDeliveryFailedAfterRetries(
    executionId: string,
    delivery: 'public' | 'private',
    error: string
  ) {
    await this._repository.updateDeliveryFailure(
      executionId,
      delivery,
      this._messaging.sanitizeError(error)
    );
  }

  finalize(executionId: string, webhookEventId: string) {
    return this._repository.finalizeExecution(executionId, webhookEventId);
  }

  private async getDeliveryContext(
    executionId: string,
    delivery: 'public' | 'private'
  ) {
    const execution = await this._repository.findExecutionWithDeliveryContext(
      executionId
    );
    if (!execution) return null;
    const status =
      delivery === 'public'
        ? execution.publicReplyStatus
        : execution.privateReplyStatus;
    const text =
      delivery === 'public'
        ? execution.automation.publicReplyText
        : execution.automation.privateReplyText;
    if (status !== 'PENDING' || !text?.trim()) return null;
    return {
      externalCommentId: execution.externalCommentId,
      text,
      token: execution.automation.integration.token,
    };
  }

  private async handleDeliveryError(
    executionId: string,
    delivery: 'public' | 'private',
    error: unknown
  ) {
    if (error instanceof InstagramMetaApiError && error.transient) {
      throw error;
    }
    const message = this._messaging.sanitizeError(
      error instanceof Error ? error.message : 'Instagram delivery failed'
    );
    await this._repository.updateDeliveryFailure(
      executionId,
      delivery,
      message
    );
    return false;
  }
}
