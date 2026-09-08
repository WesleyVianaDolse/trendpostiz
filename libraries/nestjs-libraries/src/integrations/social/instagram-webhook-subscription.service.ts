import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { INSTAGRAM_FACEBOOK_GRAPH_API_VERSION } from './instagram.provider';

@Injectable()
export class InstagramWebhookSubscriptionService {
  private readonly logger = new Logger(
    InstagramWebhookSubscriptionService.name
  );

  constructor(private _integrationRepository: IntegrationRepository) {}

  async subscribeComments(integration: Integration) {
    return this.subscribeCommentsAndMessages(integration);
  }

  async subscribeCommentsAndMessages(integration: Integration) {
    if (
      integration.providerIdentifier !== 'instagram-standalone' &&
      integration.providerIdentifier !== 'instagram'
    ) {
      throw new BadRequestException(
        'Webhook subscriptions are only supported for Instagram integrations'
      );
    }
    if (!integration.internalId || !integration.token) {
      throw new BadRequestException(
        'Instagram integration is missing its account ID or access token'
      );
    }
    if (
      integration.providerIdentifier === 'instagram' &&
      !integration.facebookPageId
    ) {
      throw new BadRequestException(
        'Facebook Page ID is required for Instagram webhook subscription'
      );
    }

    let success = false;
    let error: string | undefined;

    try {
      const standalone =
        integration.providerIdentifier === 'instagram-standalone';
      const host = standalone
        ? 'https://graph.instagram.com/v25.0'
        : `https://graph.facebook.com/${INSTAGRAM_FACEBOOK_GRAPH_API_VERSION}`;
      const objectId = standalone
        ? integration.internalId
        : integration.facebookPageId!;
      const url = new URL(
        `${host}/${encodeURIComponent(objectId)}/subscribed_apps`
      );
      url.searchParams.set(
        'subscribed_fields',
        standalone ? 'comments,messages' : 'comments'
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${integration.token}` },
      });
      const responseBody = await this.parseResponse(response);
      success = response.ok && responseBody?.success === true;

      if (!success) {
        error = this.describeFailure(
          response.status,
          responseBody,
          integration.token
        );
      }
    } catch (caught) {
      error = this.sanitize(
        caught instanceof Error ? caught.message : 'Unknown subscription error',
        integration.token
      );
    }

    try {
      const standalone =
        integration.providerIdentifier === 'instagram-standalone';
      await this._integrationRepository.updateInstagramWebhookSubscriptions(
        integration.id,
        standalone
          ? success || integration.webhookCommentsSubscribed === true
          : success,
        standalone
          ? success || integration.webhookMessagesSubscribed === true
          : false,
        error
      );
    } catch {
      this.logger.warn(
        `Could not persist Instagram webhook subscription state for integration ${integration.id}`
      );
    }

    if (!success) {
      this.logger.warn(
        `Instagram webhook subscription failed for integration ${integration.id}: ${error}`
      );
    }

    return { success, error };
  }

  private async parseResponse(response: Response): Promise<any> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  private describeFailure(status: number, body: any, token: string) {
    const safeError = {
      status,
      code: body?.error?.code,
      errorSubcode: body?.error?.error_subcode,
      type: body?.error?.type,
      message: body?.error?.message || 'Meta did not confirm the subscription',
    };
    return this.sanitize(JSON.stringify(safeError), token);
  }

  private sanitize(message: string, token: string) {
    return message
      .split(token)
      .join('[REDACTED]')
      .replace(/access_token(?:=|%3D)[^&\s"']+/gi, 'access_token=[REDACTED]')
      .slice(0, 1000);
  }
}
