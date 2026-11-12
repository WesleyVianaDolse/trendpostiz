import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { INSTAGRAM_FACEBOOK_GRAPH_API_VERSION } from './instagram.provider';
import {
  getInstagramWebhookIssue,
  InstagramWebhookIssue,
} from './instagram-webhook-status';

class FacebookWebhookSubscriptionFailure extends Error {
  constructor(readonly issue: InstagramWebhookIssue, readonly detail: string) {
    super(issue);
  }
}

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
    if (integration.providerIdentifier === 'instagram') {
      return this.subscribeFacebookComments(integration);
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
      await this._integrationRepository.updateInstagramWebhookSubscriptions(
        integration.id,
        success || integration.webhookCommentsSubscribed === true,
        success || integration.webhookMessagesSubscribed === true,
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

  private async subscribeFacebookComments(integration: Integration) {
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const appToken = appId && appSecret ? `${appId}|${appSecret}` : undefined;
    const credentials = [integration.token, appToken, appSecret].filter(
      (value): value is string => !!value
    );
    let success = false;
    let reason: InstagramWebhookIssue | undefined;
    let error: string | undefined;
    const fail = (issue: InstagramWebhookIssue, message: string): never => {
      throw new FacebookWebhookSubscriptionFailure(
        issue,
        JSON.stringify({ reason: issue, message })
      );
    };
    const request = async (path: string, token: string, method = 'GET') => {
      const response = await fetch(
        `https://graph.facebook.com/${INSTAGRAM_FACEBOOK_GRAPH_API_VERSION}${path}`,
        {
          method,
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000),
        }
      );
      const body = await this.parseResponse(response);
      if (!response.ok || body?.error) {
        let message = String(
          body?.error?.message || 'Meta did not confirm the subscription'
        );
        for (const credential of credentials)
          message = this.sanitize(message, credential);
        const meta = {
          status: response.status,
          code:
            typeof body?.error?.code === 'number' ? body.error.code : undefined,
          errorSubcode:
            typeof body?.error?.error_subcode === 'number'
              ? body.error.error_subcode
              : undefined,
          message: message.slice(0, 600),
        };
        const issue =
          token === appToken
            ? 'WEBHOOK_CONFIGURATION_INCOMPLETE'
            : getInstagramWebhookIssue(JSON.stringify(meta));
        throw new FacebookWebhookSubscriptionFailure(
          issue,
          JSON.stringify({ ...meta, reason: issue })
        );
      }
      return body;
    };
    const collection = async (path: string, token: string) => {
      const items: any[] = [];
      let after: string | undefined;
      for (let page = 0; page < 25; page++) {
        const query = new URLSearchParams({
          limit: '100',
          ...(after ? { after } : {}),
        });
        const body = await request(`${path}?${query}`, token);
        if (!Array.isArray(body?.data)) {
          fail(
            'SUBSCRIPTION_FAILED',
            'Meta returned an invalid subscription collection'
          );
        }
        items.push(...body.data);
        if (!body.paging?.next) return items;
        // Rebuild the URL on our fixed Graph host; never follow token-bearing next URLs.
        const cursor = body.paging?.cursors?.after;
        if (typeof cursor !== 'string' || !cursor || cursor === after) break;
        after = cursor;
      }
      fail(
        'SUBSCRIPTION_FAILED',
        'Could not read the complete subscription collection'
      );
    };

    try {
      if (
        !integration.token ||
        integration.refreshNeeded ||
        (integration.tokenExpiration &&
          integration.tokenExpiration <= new Date())
      ) {
        fail('RECONNECT_REQUIRED', 'Instagram authorization needs renewal');
      }
      if (!integration.facebookPageId) {
        fail(
          'RECONNECT_REQUIRED',
          'The linked Facebook Page must be recovered'
        );
      }
      if (!integration.internalId || integration.internalId === 'undefined') {
        fail(
          'WEBHOOK_CONFIGURATION_INCOMPLETE',
          'Instagram account ID is missing'
        );
      }
      if (!appToken || !process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
        fail(
          'WEBHOOK_CONFIGURATION_INCOMPLETE',
          'Facebook webhook credentials are not configured'
        );
      }

      const identity = await request(
        '/me?fields=id,instagram_business_account',
        integration.token
      );
      if (
        identity.id !== integration.facebookPageId ||
        identity.instagram_business_account?.id !== integration.internalId
      ) {
        fail(
          'RECONNECT_REQUIRED',
          'The Page token and linked Instagram account do not match'
        );
      }

      const subscriptions = await collection(
        `/${encodeURIComponent(appId!)}/subscriptions`,
        appToken!
      );
      const commentsConfigured = subscriptions!.some(
        (subscription) =>
          subscription.object === 'instagram' &&
          subscription.active === true &&
          typeof subscription.callback_url === 'string' &&
          subscription.callback_url.startsWith('https://') &&
          Array.isArray(subscription.fields) &&
          subscription.fields.some(
            (field: any) => field === 'comments' || field?.name === 'comments'
          )
      );
      if (!commentsConfigured) {
        fail(
          'WEBHOOK_CONFIGURATION_INCOMPLETE',
          'An active Instagram comments callback is required in the Meta app'
        );
      }

      const path = `/${encodeURIComponent(
        integration.facebookPageId!
      )}/subscribed_apps`;
      const pageSubscriptions = await collection(path, integration.token);
      const existing = pageSubscriptions!.find(
        (subscription) => subscription.id === appId
      );
      const fields = existing ? existing.subscribed_fields : [];
      if (
        !Array.isArray(fields) ||
        fields.some((field: unknown) => typeof field !== 'string')
      ) {
        fail(
          'SUBSCRIPTION_FAILED',
          'Meta returned invalid Page subscription fields'
        );
      }
      // Meta's Instagram Webhooks guide, Step 2: enable the linked Page using any
      // Page field (documented example: feed). This does NOT subscribe to Instagram
      // comments. Those belong to the app's Instagram object, verified above.
      // Preserve other Page subscriptions owned by this app (e.g. Messenger).
      // An existing Page field is sufficient; feed is only the initial default.
      const query = new URLSearchParams({
        subscribed_fields: [
          ...new Set<string>(fields.length ? fields : ['feed']),
        ].join(','),
      });
      const body = await request(`${path}?${query}`, integration.token, 'POST');
      if (body?.success !== true) {
        fail(
          'SUBSCRIPTION_FAILED',
          'Meta did not confirm Page subscription enablement'
        );
      }
      success = true;
    } catch (caught) {
      const failure =
        caught instanceof FacebookWebhookSubscriptionFailure
          ? caught
          : undefined;
      reason = failure?.issue || 'SUBSCRIPTION_FAILED';
      // Network errors can include URLs or credentials. Retain only a fixed message.
      error =
        failure?.detail ||
        JSON.stringify({
          reason,
          message: 'Could not complete the Meta webhook subscription request',
        });
    }

    try {
      await this._integrationRepository.updateInstagramWebhookSubscriptions(
        integration.id,
        success,
        false,
        error
      );
    } catch {
      this.logger.warn(
        `Could not persist Instagram webhook subscription state for integration ${integration.id}`
      );
      return {
        success: false,
        reason: 'SUBSCRIPTION_FAILED' as const,
        error: JSON.stringify({
          reason: 'SUBSCRIPTION_FAILED',
          message: 'Could not persist the confirmed subscription state',
        }),
      };
    }
    if (!success) {
      this.logger.warn(
        `Instagram webhook subscription failed for integration ${integration.id}: ${reason}`
      );
    }
    return { success, error, ...(reason ? { reason } : {}) };
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
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/access_token(?:=|%3D)[^&\s"']+/gi, 'access_token=[REDACTED]')
      .slice(0, 1000);
  }
}
