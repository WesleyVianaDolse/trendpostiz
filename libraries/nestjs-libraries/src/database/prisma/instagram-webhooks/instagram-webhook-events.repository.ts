import { Injectable } from '@nestjs/common';
import { InstagramWebhookEventStatus, Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export interface InstagramWebhookEventInput {
  externalCommentId?: string;
  integrationId?: string;
  instagramAccountId: string;
  mediaId?: string;
  authorId?: string;
  authorUsername?: string;
  commentText?: string;
  payload: Prisma.InputJsonValue;
  status: InstagramWebhookEventStatus;
}

@Injectable()
export class InstagramWebhookEventsRepository {
  constructor(private _events: PrismaRepository<'instagramWebhookEvent'>) {}

  async record(input: InstagramWebhookEventInput) {
    const data = {
      externalCommentId: input.externalCommentId,
      integrationId: input.integrationId,
      instagramAccountId: input.instagramAccountId,
      mediaId: input.mediaId,
      authorId: input.authorId,
      authorUsername: input.authorUsername,
      commentText: input.commentText,
      payload: input.payload,
      status: input.status,
    };

    if (!input.externalCommentId) {
      return this._events.model.instagramWebhookEvent.create({ data });
    }

    const event = await this._events.model.instagramWebhookEvent.upsert({
      where: { externalCommentId: input.externalCommentId },
      create: data,
      update: {
        instagramAccountId: input.instagramAccountId,
        mediaId: input.mediaId,
        authorId: input.authorId,
        authorUsername: input.authorUsername,
        commentText: input.commentText,
        payload: input.payload,
      },
    });

    await this._events.model.instagramWebhookEvent.updateMany({
      where: {
        id: event.id,
        status: { in: ['RECEIVED', 'UNMATCHED', 'AMBIGUOUS', 'INVALID'] },
      },
      data: {
        integrationId: input.integrationId,
        status: input.status,
      },
    });

    return event;
  }
}
