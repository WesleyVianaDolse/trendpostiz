import { Injectable } from '@nestjs/common';
import { InstagramCommentDeliveryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AutomationRecoveryService } from '../../../automation-recovery/automation-recovery.service';
import { RecoveryHold } from '../../../automation-recovery/recovery-policy';

export interface ClaimInstagramCommentExecutionInput {
  automationId: string;
  webhookEventId: string;
  authorId: string;
  externalCommentId: string;
  publicReplyStatus: InstagramCommentDeliveryStatus;
  privateReplyStatus: InstagramCommentDeliveryStatus;
}

@Injectable()
export class InstagramCommentAutomationRepository {
  constructor(private _prisma: PrismaService, private _recovery?: AutomationRecoveryService) {}

  findEventForProcessing(id: string) {
    return this._prisma.instagramWebhookEvent.findUnique({
      where: { id },
      include: {
        integration: true,
        automationExecution: true,
      },
    });
  }

  findEnabledAutomation(integrationId: string, mediaId: string) {
    return this._prisma.instagramCommentAutomation.findFirst({
      where: { integrationId, mediaId, enabled: true },
      include: { triggers: true },
    });
  }

  findExecutionByPublicReplyId(publicReplyId: string) {
    return this._prisma.instagramCommentAutomationExecution.findUnique({
      where: { publicReplyId },
      select: { id: true },
    });
  }

  findExecutionWithDeliveryContext(id: string) {
    return this._prisma.instagramCommentAutomationExecution.findUnique({
      where: { id },
      include: {
        webhookEvent: { select: { receivedAt: true, occurredAt: true, occurredAtSource: true } },
        automation: {
          include: { integration: true },
        },
      },
    });
  }

  async claimExecution(input: ClaimInstagramCommentExecutionInput) {
    try {
      return await this._prisma.$transaction(async (transaction) => {
        if (!this._recovery) throw new RecoveryHold('RECOVERY_SERVICE_UNAVAILABLE');
        const automation = await transaction.instagramCommentAutomation.findUnique({ where: { id: input.automationId } });
        if (!automation) return null;
        const integration = await transaction.integration.findUnique({ where: { id: automation.integrationId }, select: { organizationId: true } });
        if (!integration || !await this._recovery.guardCommentClaim(transaction, input.webhookEventId, integration.organizationId)) return null;
        const event = await transaction.instagramWebhookEvent.findUnique({ where: { id: input.webhookEventId } });
        if (!event || event.status !== 'RECEIVED' || event.recoverySkipReason || event.integrationId !== automation.integrationId ||
          event.authorId !== input.authorId || event.externalCommentId !== input.externalCommentId || !automation.enabled) return null;
        const execution =
          await transaction.instagramCommentAutomationExecution.create({
            data: input,
          });
        await transaction.instagramWebhookEvent.update({
          where: { id: input.webhookEventId },
          data: { status: 'PROCESSING' },
        });
        return execution;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  updateEventStatus(
    id: string,
    status: Prisma.InstagramWebhookEventUpdateInput['status']
  ) {
    return this._prisma.instagramWebhookEvent.updateMany({
      where: { id, recoverySkipReason: null, status: { in: ['RECEIVED', 'UNMATCHED', 'AMBIGUOUS', 'INVALID'] } },
      data: { status },
    });
  }

  updateDeliverySuccess(
    id: string,
    delivery: 'public' | 'private',
    replyId: string
  ) {
    return this._prisma.instagramCommentAutomationExecution.update({
      where: { id, OR: delivery === 'public'
        ? [{ publicReplyId: null }, { publicReplyId: replyId }]
        : [{ privateReplyId: null }, { privateReplyId: replyId }] },
      data:
        delivery === 'public'
          ? {
              publicReplyId: replyId,
              publicReplyStatus: 'SUCCESS',
              publicReplyError: null,
            }
          : {
              privateReplyId: replyId,
              privateReplyStatus: 'SUCCESS',
              privateReplyError: null,
            },
    });
  }

  async claimFacebookPrivateReplyAttempt(id: string) {
    // Reserve before the HTTP request. A crash, timeout, or failure to persist a
    // successful delivery must never leave a retryable PENDING private reply.
    // FAILED means unconfirmed until the confirmed message_id is persisted.
    const result =
      await this._prisma.instagramCommentAutomationExecution.updateMany({
        where: {
          id,
          processedAt: null,
          privateReplyStatus: 'PENDING',
          privateReplyId: null,
          automation: { integration: { providerIdentifier: 'instagram' } },
        },
        data: {
          privateReplyStatus: 'FAILED',
          privateReplyError:
            'Private reply attempt is unconfirmed; automatic retry suppressed',
        },
      });
    return result.count === 1;
  }

  updateDeliveryFailure(
    id: string,
    delivery: 'public' | 'private',
    error: string
  ) {
    return this._prisma.instagramCommentAutomationExecution.updateMany({
      where: delivery === 'public'
        ? { id, publicReplyId: null, publicReplyStatus: { in: ['PENDING', 'FAILED'] } }
        : { id, privateReplyId: null, privateReplyStatus: { in: ['PENDING', 'FAILED'] } },
      data:
        delivery === 'public'
          ? { publicReplyStatus: 'FAILED', publicReplyError: error }
          : { privateReplyStatus: 'FAILED', privateReplyError: error },
    });
  }

  async finalizeExecution(id: string, webhookEventId: string) {
    return this._prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "InstagramWebhookEvent" WHERE "id" = ${webhookEventId} FOR UPDATE`;
      const execution =
        await transaction.instagramCommentAutomationExecution.findUniqueOrThrow(
          { where: { id } }
        );
      const statuses = [
        execution.publicReplyStatus,
        execution.privateReplyStatus,
      ];
      const event = await transaction.instagramWebhookEvent.findUnique({ where: { id: webhookEventId }, select: { recoverySkipReason: true, status: true } });
      if (event?.recoverySkipReason) return event.status;
      if (statuses.includes('PENDING')) {
        await transaction.instagramWebhookEvent.update({ where: { id: webhookEventId }, data: { status: 'PROCESSING' } });
        return 'PROCESSING';
      }
      const hasSuccess = statuses.includes('SUCCESS');
      const hasFailure = statuses.includes('FAILED');
      const eventStatus = hasFailure
        ? 'FAILED'
        : hasSuccess && !statuses.includes('PENDING')
        ? 'REPLIED'
        : 'PROCESSED';

      await transaction.instagramCommentAutomationExecution.update({
        where: { id },
        data: { processedAt: new Date() },
      });
      await transaction.instagramWebhookEvent.update({
        where: { id: webhookEventId },
        data: { status: eventStatus },
      });
      return eventStatus;
    });
  }

  findReceivedEventIds(take = 100) {
    return this._prisma.instagramWebhookEvent.findMany({
      where: { status: 'RECEIVED', recoverySkipReason: null },
      orderBy: { receivedAt: 'asc' },
      take,
      select: { id: true },
    });
  }
}
