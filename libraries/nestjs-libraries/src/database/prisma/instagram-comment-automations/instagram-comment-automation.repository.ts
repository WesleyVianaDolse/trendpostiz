import { Injectable } from '@nestjs/common';
import { InstagramCommentDeliveryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

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
  constructor(private _prisma: PrismaService) {}

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
        automation: {
          include: { integration: true },
        },
      },
    });
  }

  async claimExecution(input: ClaimInstagramCommentExecutionInput) {
    try {
      return await this._prisma.$transaction(async (transaction) => {
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
    return this._prisma.instagramWebhookEvent.update({
      where: { id },
      data: { status },
    });
  }

  updateDeliverySuccess(
    id: string,
    delivery: 'public' | 'private',
    replyId: string
  ) {
    return this._prisma.instagramCommentAutomationExecution.update({
      where: { id },
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

  updateDeliveryFailure(
    id: string,
    delivery: 'public' | 'private',
    error: string
  ) {
    return this._prisma.instagramCommentAutomationExecution.update({
      where: { id },
      data:
        delivery === 'public'
          ? { publicReplyStatus: 'FAILED', publicReplyError: error }
          : { privateReplyStatus: 'FAILED', privateReplyError: error },
    });
  }

  async finalizeExecution(id: string, webhookEventId: string) {
    return this._prisma.$transaction(async (transaction) => {
      const execution =
        await transaction.instagramCommentAutomationExecution.findUniqueOrThrow(
          { where: { id } }
        );
      const statuses = [
        execution.publicReplyStatus,
        execution.privateReplyStatus,
      ];
      const hasSuccess = statuses.includes('SUCCESS');
      const hasFailure = statuses.includes('FAILED');
      const eventStatus =
        hasSuccess && !hasFailure
          ? 'REPLIED'
          : hasFailure && !hasSuccess
          ? 'FAILED'
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
      where: { status: 'RECEIVED' },
      orderBy: { receivedAt: 'asc' },
      take,
      select: { id: true },
    });
  }
}
