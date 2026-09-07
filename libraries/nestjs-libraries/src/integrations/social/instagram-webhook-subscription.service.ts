import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

@Injectable()
export class InstagramWebhookSubscriptionService {
  private readonly logger = new Logger(
    InstagramWebhookSubscriptionService.name
  );

  constructor(private _integrationService: IntegrationService) {}

  async subscribeComments(integration: Integration) {
    return this.subscribeCommentsAndMessages(integration);
  }

  async subscribeCommentsAndMessages(integration: Integration) {
    if (integration.providerIdentifier !== 'instagram-standalone') {
      throw new BadRequestException(
        'Webhook subscriptions are only supported for Instagram Standalone'
      );
    }
    if (!integration.internalId || !integration.token) {
      throw new BadRequestException(
        'Instagram integration is missing its account ID or access token'
      );
    }

    let success = false;
    let error: string | undefined;

    try {
      const url = new URL(
        `https://graph.instagram.com/v25.0/${encodeURIComponent(
          integration.internalId
        )}/subscribed_apps`
      );
      url.searchParams.set('subscribed_fields', 'comments,messages');
      url.searchParams.set('access_token', integration.token);

      const response = await fetch(url, { method: 'POST' });
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
      await this._integrationService.updateInstagramWebhookSubscriptions(
        integration.id,
        success || integration.webhookCommentsSubscribed === true,
        success,
        error
      );
    } catch {
      this.logger.warn(
        `Could not persist Instagram webhook subscription state for integration ${integration.id}`
      );
    }

    if (!success) {
      this.logger.warn(
        `Instagram comments/messages webhook subscription failed for integration ${integration.id}: ${error}`
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
