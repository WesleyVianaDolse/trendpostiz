import { InstagramMetaApiError } from '@gitroom/nestjs-libraries/integrations/social/instagram-standalone-messaging.service';
import { InstagramCommentAutomationService } from './instagram-comment-automation.service';

describe('InstagramCommentAutomationService', () => {
  const repository = {
    findEventForProcessing: jest.fn(),
    findEnabledAutomation: jest.fn(),
    findExecutionByPublicReplyId: jest.fn(),
    claimExecution: jest.fn(),
    updateEventStatus: jest.fn().mockResolvedValue({}),
    findExecutionWithDeliveryContext: jest.fn(),
    updateDeliverySuccess: jest.fn().mockResolvedValue({}),
    updateDeliveryFailure: jest.fn().mockResolvedValue({}),
    finalizeExecution: jest.fn().mockResolvedValue('REPLIED'),
  };
  const messaging = {
    replyToComment: jest.fn(),
    sendPrivateReplyFromComment: jest.fn(),
    sanitizeError: jest.fn((message: string) => message),
  };
  const service = new InstagramCommentAutomationService(
    repository as any,
    messaging as any
  );
  const event = {
    id: 'event-1',
    status: 'RECEIVED',
    integrationId: 'integration-1',
    mediaId: 'media-1',
    authorId: 'author-1',
    externalCommentId: 'comment-1',
    commentText: 'EU QUERO',
    integration: {
      id: 'integration-1',
      internalId: 'account-1',
      providerIdentifier: 'instagram-standalone',
      token: 'secret-token',
      tokenExpiration: null,
      facebookPageId: null,
      webhookCommentsSubscribed: true,
      webhookMessagesSubscribed: true,
      refreshNeeded: false,
      disabled: false,
      deletedAt: null,
    },
    automationExecution: null,
  };
  const automation = {
    id: 'automation-1',
    matchType: 'EXACT',
    publicReplyEnabled: true,
    publicReplyText: 'See your direct',
    privateReplyEnabled: true,
    privateReplyText: 'Here is the link',
    triggers: [{ normalizedPhrase: 'eu quero' }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findEventForProcessing.mockResolvedValue({ ...event });
    repository.findExecutionByPublicReplyId.mockResolvedValue(null);
    repository.findEnabledAutomation.mockResolvedValue({ ...automation });
    repository.claimExecution.mockResolvedValue({ id: 'execution-1' });
  });

  it.each([
    ['without an automation', null],
    ['with only a disabled automation', null],
  ])('skips a comment %s', async (_name, foundAutomation) => {
    repository.findEnabledAutomation.mockResolvedValue(foundAutomation);
    await expect(service.prepare('event-1')).resolves.toMatchObject({
      process: false,
      reason: 'no_automation',
    });
    expect(repository.updateEventStatus).toHaveBeenCalledWith(
      'event-1',
      'SKIPPED'
    );
    expect(repository.claimExecution).not.toHaveBeenCalled();
  });

  it('claims a matching automation before any delivery', async () => {
    await expect(service.prepare('event-1')).resolves.toEqual({
      process: true,
      executionId: 'execution-1',
      webhookEventId: 'event-1',
      publicReplyPending: true,
      privateReplyPending: true,
    });
    expect(repository.claimExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: 'automation-1',
        authorId: 'author-1',
        externalCommentId: 'comment-1',
      })
    );
  });

  it.each(['EXACT', 'CONTAINS'] as const)(
    'uses the common %s matcher for a Facebook/BM event',
    async (matchType) => {
      repository.findEventForProcessing.mockResolvedValue({
        ...event,
        integration: {
          ...event.integration,
          providerIdentifier: 'instagram',
          facebookPageId: 'page-1',
          webhookMessagesSubscribed: false,
        },
      });
      repository.findEnabledAutomation.mockResolvedValue({
        ...automation,
        matchType,
      });

      await expect(service.prepare('event-1')).resolves.toMatchObject({
        process: true,
      });
    }
  );

  it('skips the second event from the same author when the atomic claim loses', async () => {
    repository.claimExecution.mockResolvedValue(null);
    await expect(service.prepare('event-1')).resolves.toMatchObject({
      process: false,
      reason: 'already_claimed',
    });
  });

  it('preserves once-per-user acquisition for Facebook/BM', async () => {
    repository.findEventForProcessing.mockResolvedValue({
      ...event,
      integration: {
        ...event.integration,
        providerIdentifier: 'instagram',
        facebookPageId: 'page-1',
        webhookMessagesSubscribed: false,
      },
    });
    repository.claimExecution.mockResolvedValue(null);
    await expect(service.prepare('event-1')).resolves.toMatchObject({
      process: false,
      reason: 'already_claimed',
    });
  });

  it('allows only one of two concurrent events from the same author to claim', async () => {
    let claimed = false;
    repository.claimExecution.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      return { id: 'execution-1' };
    });

    const results = await Promise.all([
      service.prepare('event-1'),
      service.prepare('event-2'),
    ]);
    expect(results.filter((result) => result.process)).toHaveLength(1);
  });

  it('does not process a detectable comment from the professional account', async () => {
    repository.findEventForProcessing.mockResolvedValue({
      ...event,
      authorId: 'account-1',
    });
    await expect(service.prepare('event-1')).resolves.toMatchObject({
      process: false,
      reason: 'own_account_comment',
    });
  });

  it('does not process a Facebook/BM comment authored by its Page', async () => {
    repository.findEventForProcessing.mockResolvedValue({
      ...event,
      authorId: 'page-1',
      integration: {
        ...event.integration,
        providerIdentifier: 'instagram',
        facebookPageId: 'page-1',
        webhookMessagesSubscribed: false,
      },
    });
    await expect(service.prepare('event-1')).resolves.toMatchObject({
      process: false,
      reason: 'own_account_comment',
    });
  });

  it('does not process a comment ID previously stored as a public reply', async () => {
    repository.findExecutionByPublicReplyId.mockResolvedValue({
      id: 'previous-execution',
    });
    await expect(service.prepare('event-1')).resolves.toMatchObject({
      process: false,
      reason: 'own_public_reply',
    });
  });

  it('does not process a completed execution again on webhook redelivery', async () => {
    repository.findEventForProcessing.mockResolvedValue({
      ...event,
      automationExecution: {
        id: 'execution-1',
        processedAt: new Date(),
        publicReplyStatus: 'SUCCESS',
        privateReplyStatus: 'SUCCESS',
      },
    });
    await expect(service.prepare('event-1')).resolves.toMatchObject({
      process: false,
      reason: 'already_processed',
    });
    expect(repository.claimExecution).not.toHaveBeenCalled();
    expect(repository.updateEventStatus).not.toHaveBeenCalled();
  });

  it('resumes an existing pending execution without creating a second one', async () => {
    repository.findEventForProcessing.mockResolvedValue({
      ...event,
      status: 'PROCESSING',
      automationExecution: {
        id: 'execution-1',
        processedAt: null,
        publicReplyStatus: 'SUCCESS',
        privateReplyStatus: 'PENDING',
      },
    });

    await expect(service.prepare('event-1')).resolves.toEqual({
      process: true,
      executionId: 'execution-1',
      webhookEventId: 'event-1',
      publicReplyPending: false,
      privateReplyPending: true,
    });
    expect(repository.claimExecution).not.toHaveBeenCalled();
  });

  it('does not resume a pending execution after its integration is disabled', async () => {
    repository.findEventForProcessing.mockResolvedValue({
      ...event,
      integration: { ...event.integration, disabled: true },
      status: 'PROCESSING',
      automationExecution: {
        id: 'execution-1',
        processedAt: null,
        publicReplyStatus: 'PENDING',
        privateReplyStatus: 'PENDING',
      },
    });

    await expect(service.prepare('event-1')).resolves.toEqual({
      process: false,
      reason: 'integration_unavailable',
    });
    expect(repository.updateEventStatus).toHaveBeenCalledWith(
      'event-1',
      'SKIPPED'
    );
  });

  it('records public reply success', async () => {
    repository.findExecutionWithDeliveryContext.mockResolvedValue({
      externalCommentId: 'comment-1',
      publicReplyStatus: 'PENDING',
      automation: {
        publicReplyText: 'Public reply',
        integration: event.integration,
      },
    });
    messaging.replyToComment.mockResolvedValue('reply-1');
    await expect(service.deliverPublicReply('execution-1')).resolves.toBe(true);
    expect(repository.updateDeliverySuccess).toHaveBeenCalledWith(
      'execution-1',
      'public',
      'reply-1'
    );
  });

  it('does not deliver after the integration token becomes unavailable', async () => {
    repository.findExecutionWithDeliveryContext.mockResolvedValue({
      externalCommentId: 'comment-1',
      publicReplyStatus: 'PENDING',
      automation: {
        publicReplyText: 'Public reply',
        integration: { ...event.integration, refreshNeeded: true },
      },
    });
    await expect(service.deliverPublicReply('execution-1')).resolves.toBe(
      false
    );
    expect(messaging.replyToComment).not.toHaveBeenCalled();
    expect(repository.updateDeliveryFailure).toHaveBeenCalledWith(
      'execution-1',
      'public',
      'Instagram public reply capability is unavailable'
    );
  });

  it('records private reply success', async () => {
    repository.findExecutionWithDeliveryContext.mockResolvedValue({
      externalCommentId: 'comment-1',
      privateReplyStatus: 'PENDING',
      automation: {
        privateReplyText: 'Private reply',
        integration: event.integration,
      },
    });
    messaging.sendPrivateReplyFromComment.mockResolvedValue('message-1');
    await expect(service.deliverPrivateReply('execution-1')).resolves.toBe(
      true
    );
    expect(repository.updateDeliverySuccess).toHaveBeenCalledWith(
      'execution-1',
      'private',
      'message-1'
    );
  });

  it('does not call Meta after the seven-day private reply window', async () => {
    repository.findExecutionWithDeliveryContext.mockResolvedValue({
      externalCommentId: 'comment-1',
      privateReplyStatus: 'PENDING',
      webhookEvent: {
        receivedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
      automation: {
        privateReplyText: 'Private reply',
        integration: event.integration,
      },
    });
    await expect(service.deliverPrivateReply('execution-1')).resolves.toBe(
      false
    );
    expect(messaging.sendPrivateReplyFromComment).not.toHaveBeenCalled();
    expect(repository.updateDeliveryFailure).toHaveBeenCalledWith(
      'execution-1',
      'private',
      'Instagram private reply window expired'
    );
  });

  it('stores a permanent delivery failure without throwing for retry', async () => {
    repository.findExecutionWithDeliveryContext.mockResolvedValue({
      externalCommentId: 'comment-1',
      publicReplyStatus: 'PENDING',
      automation: {
        publicReplyText: 'Public reply',
        integration: event.integration,
      },
    });
    messaging.replyToComment.mockRejectedValue(
      new InstagramMetaApiError('permanent', false)
    );
    await expect(service.deliverPublicReply('execution-1')).resolves.toBe(
      false
    );
    expect(repository.updateDeliveryFailure).toHaveBeenCalledWith(
      'execution-1',
      'public',
      'permanent'
    );
  });

  it('rethrows a transient delivery failure for Temporal retry', async () => {
    repository.findExecutionWithDeliveryContext.mockResolvedValue({
      externalCommentId: 'comment-1',
      publicReplyStatus: 'PENDING',
      automation: {
        publicReplyText: 'Public reply',
        integration: event.integration,
      },
    });
    messaging.replyToComment.mockRejectedValue(
      new InstagramMetaApiError('transient', true)
    );
    await expect(
      service.deliverPublicReply('execution-1')
    ).rejects.toMatchObject({ transient: true });
    expect(repository.updateDeliveryFailure).not.toHaveBeenCalled();
  });
});
