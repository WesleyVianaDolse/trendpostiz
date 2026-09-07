import { Injectable, Logger } from '@nestjs/common';
import { InstagramWebhookEventStatus, Prisma } from '@prisma/client';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { InstagramWebhookEventsRepository } from '@gitroom/nestjs-libraries/database/prisma/instagram-webhooks/instagram-webhook-events.repository';
import {
  InstagramWebhookChange,
  InstagramWebhookPayload,
} from '@gitroom/nestjs-libraries/dtos/webhooks/instagram.webhook.dto';

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class InstagramWebhookEventsService {
  private readonly logger = new Logger(InstagramWebhookEventsService.name);

  constructor(
    private _eventsRepository: InstagramWebhookEventsRepository,
    private _integrationService: IntegrationService
  ) {}

  async receive(payload: InstagramWebhookPayload | unknown) {
    if (!payload || typeof payload !== 'object') {
      return { events: 0, eventIds: [] as string[] };
    }

    const webhook = payload as InstagramWebhookPayload;
    if (webhook.object !== 'instagram' || !Array.isArray(webhook.entry)) {
      return { events: 0, eventIds: [] as string[] };
    }

    let events = 0;
    const eventIds: string[] = [];
    for (const entry of webhook.entry) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        !Array.isArray(entry.changes)
      ) {
        continue;
      }

      for (const change of entry.changes) {
        if (!change || change.field !== 'comments') {
          continue;
        }

        const eventId = await this.recordComment(entry.id, entry.time, change);
        if (eventId) eventIds.push(eventId);
        events += 1;
      }
    }

    return { events, eventIds };
  }

  private async recordComment(
    rawAccountId: unknown,
    entryTime: unknown,
    change: InstagramWebhookChange
  ) {
    const instagramAccountId = asString(rawAccountId) || 'unknown';
    const externalCommentId = asString(change.value?.id);
    let status: InstagramWebhookEventStatus = 'INVALID';
    let integrationId: string | undefined;

    if (externalCommentId && instagramAccountId !== 'unknown') {
      const resolution =
        await this._integrationService.resolveActiveInstagramStandalone(
          instagramAccountId
        );
      if (resolution.status === 'found') {
        status = 'RECEIVED';
        integrationId = resolution.integration.id;
      } else if (resolution.status === 'ambiguous') {
        status = 'AMBIGUOUS';
        this.logger.warn(
          `Ambiguous Instagram webhook account mapping for account ${instagramAccountId}`
        );
      } else {
        status = 'UNMATCHED';
        this.logger.warn(
          `No active Instagram Standalone integration for account ${instagramAccountId}`
        );
      }
    }

    const event = await this._eventsRepository.record({
      externalCommentId,
      integrationId,
      instagramAccountId,
      mediaId: asString(change.value?.media?.id),
      authorId: asString(change.value?.from?.id),
      authorUsername: asString(change.value?.from?.username),
      commentText: asString(change.value?.text),
      payload: asJson({
        entryId: rawAccountId,
        entryTime,
        change,
      }),
      status,
    });
    return status === 'RECEIVED' ? event.id : undefined;
  }
}
