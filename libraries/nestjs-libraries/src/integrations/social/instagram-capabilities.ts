import { Integration } from '@prisma/client';
import {
  getInstagramWebhookIssue,
  InstagramWebhookIssue,
} from './instagram-webhook-status';

export const INSTAGRAM_PROVIDER_IDENTIFIERS = [
  'instagram',
  'instagram-standalone',
] as const;

export type InstagramProviderIdentifier =
  (typeof INSTAGRAM_PROVIDER_IDENTIFIERS)[number];

export interface InstagramIntegrationCapabilities {
  commentsWebhook: boolean;
  publicReply: boolean;
  privateReply: boolean;
  reconnectRequired: boolean;
  unavailableReason?: InstagramWebhookIssue;
}

type InstagramCapabilityIntegration = Pick<
  Integration,
  | 'providerIdentifier'
  | 'token'
  | 'tokenExpiration'
  | 'facebookPageId'
  | 'disabled'
  | 'deletedAt'
  | 'refreshNeeded'
  | 'webhookCommentsSubscribed'
  | 'webhookMessagesSubscribed'
> &
  Partial<Pick<Integration, 'webhookSubscriptionError'>>;

export const isInstagramProviderIdentifier = (
  providerIdentifier: string
): providerIdentifier is InstagramProviderIdentifier =>
  INSTAGRAM_PROVIDER_IDENTIFIERS.includes(
    providerIdentifier as InstagramProviderIdentifier
  );

export const getInstagramIntegrationCapabilities = (
  integration: InstagramCapabilityIntegration
): InstagramIntegrationCapabilities => {
  const tokenValid =
    !!integration.token &&
    (!integration.tokenExpiration || integration.tokenExpiration > new Date());
  const active =
    !integration.disabled &&
    !integration.deletedAt &&
    !integration.refreshNeeded &&
    tokenValid;

  if (!active) {
    return {
      commentsWebhook: false,
      publicReply: false,
      privateReply: false,
      reconnectRequired: integration.refreshNeeded || !tokenValid,
    };
  }

  if (integration.providerIdentifier === 'instagram') {
    const issue = !integration.webhookCommentsSubscribed
      ? getInstagramWebhookIssue(integration.webhookSubscriptionError)
      : undefined;
    const reconnectRequired =
      !integration.facebookPageId || issue === 'RECONNECT_REQUIRED';
    const commentsWebhook =
      !!integration.facebookPageId && integration.webhookCommentsSubscribed;
    return {
      commentsWebhook,
      publicReply: commentsWebhook,
      privateReply: commentsWebhook,
      reconnectRequired,
      ...(integration.facebookPageId && issue
        ? { unavailableReason: issue }
        : {}),
    };
  }

  if (integration.providerIdentifier !== 'instagram-standalone') {
    return {
      commentsWebhook: false,
      publicReply: false,
      privateReply: false,
      reconnectRequired: false,
    };
  }

  const commentsWebhook = integration.webhookCommentsSubscribed;
  return {
    commentsWebhook,
    publicReply: commentsWebhook,
    privateReply: commentsWebhook && integration.webhookMessagesSubscribed,
    reconnectRequired: false,
  };
};
