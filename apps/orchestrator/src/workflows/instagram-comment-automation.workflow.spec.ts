const mockActivities = {
  prepare: jest.fn(),
  deliverPublicReply: jest.fn(),
  deliverPrivateReply: jest.fn(),
  markDeliveryFailedAfterRetries: jest.fn(),
  finalize: jest.fn(),
};

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => mockActivities,
}));
jest.mock(
  '@gitroom/orchestrator/activities/instagram-comment-automation.activity',
  () => ({ InstagramCommentAutomationActivity: class {} })
);

import { instagramCommentAutomationWorkflow } from './instagram-comment-automation.workflow';

describe('instagramCommentAutomationWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActivities.prepare.mockResolvedValue({
      process: true,
      executionId: 'execution-1',
      webhookEventId: 'event-1',
      publicReplyPending: true,
      privateReplyPending: true,
    });
    mockActivities.deliverPublicReply.mockResolvedValue(true);
    mockActivities.deliverPrivateReply.mockResolvedValue(true);
    mockActivities.markDeliveryFailedAfterRetries.mockResolvedValue(undefined);
    mockActivities.finalize.mockResolvedValue('REPLIED');
  });

  it('delivers the public reply before the private reply', async () => {
    await instagramCommentAutomationWorkflow({ webhookEventId: 'event-1' });
    expect(
      mockActivities.deliverPublicReply.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockActivities.deliverPrivateReply.mock.invocationCallOrder[0]
    );
  });

  it('continues with private reply after public retries are exhausted', async () => {
    mockActivities.deliverPublicReply.mockRejectedValue(
      new Error('public failed')
    );

    await instagramCommentAutomationWorkflow({ webhookEventId: 'event-1' });
    expect(mockActivities.markDeliveryFailedAfterRetries).toHaveBeenCalledWith(
      'execution-1',
      'public',
      'public failed'
    );
    expect(mockActivities.deliverPrivateReply).toHaveBeenCalledWith(
      'execution-1'
    );
    expect(mockActivities.finalize).toHaveBeenCalled();
  });

  it('keeps public success when the private reply fails', async () => {
    mockActivities.deliverPrivateReply.mockRejectedValue(
      new Error('private failed')
    );

    await instagramCommentAutomationWorkflow({ webhookEventId: 'event-1' });
    expect(mockActivities.deliverPublicReply).toHaveBeenCalled();
    expect(mockActivities.markDeliveryFailedAfterRetries).toHaveBeenCalledWith(
      'execution-1',
      'private',
      'private failed'
    );
    expect(mockActivities.finalize).toHaveBeenCalled();
  });

  it('does not deliver anything when preparation skips the event', async () => {
    mockActivities.prepare.mockResolvedValue({
      process: false,
      reason: 'already_processed',
    });
    await expect(
      instagramCommentAutomationWorkflow({ webhookEventId: 'event-1' })
    ).resolves.toBe('already_processed');
    expect(mockActivities.deliverPublicReply).not.toHaveBeenCalled();
    expect(mockActivities.deliverPrivateReply).not.toHaveBeenCalled();
  });
});
