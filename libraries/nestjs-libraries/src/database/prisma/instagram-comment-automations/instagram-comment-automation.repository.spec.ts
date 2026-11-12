import { InstagramCommentAutomationRepository } from './instagram-comment-automation.repository';

describe('Instagram comment execution delivery audit', () => {
  function setup(execution: any) {
    const transaction = {
      instagramCommentAutomationExecution: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(execution),
        update: jest.fn().mockResolvedValue({}),
      },
      instagramWebhookEvent: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(transaction)),
      instagramCommentAutomationExecution: { updateMany: jest.fn() },
    };
    return {
      repository: new InstagramCommentAutomationRepository(prisma as any),
      transaction,
      prisma,
    };
  }

  it.each([
    ['SUCCESS', 'FAILED', 'FAILED'],
    ['FAILED', 'SUCCESS', 'FAILED'],
    ['FAILED', 'FAILED', 'FAILED'],
    ['SUCCESS', 'SUCCESS', 'REPLIED'],
    ['SUCCESS', 'SKIPPED', 'REPLIED'],
    ['SKIPPED', 'SUCCESS', 'REPLIED'],
    ['SKIPPED', 'SKIPPED', 'PROCESSED'],
    ['SUCCESS', 'PENDING', 'PROCESSED'],
  ])(
    'finalizes public=%s / Direct=%s as %s without overwriting individual results',
    async (publicReplyStatus, privateReplyStatus, status) => {
      const execution = {
        publicReplyStatus,
        privateReplyStatus,
        publicReplyId: 'public-1',
        privateReplyError: 'Denied',
      };
      const { repository, transaction } = setup(execution);
      await expect(
        repository.finalizeExecution('execution-1', 'event-1')
      ).resolves.toBe(status);
      expect(transaction.instagramWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { status },
      });
      expect(
        transaction.instagramCommentAutomationExecution.update
      ).toHaveBeenCalledWith({
        where: { id: 'execution-1' },
        data: { processedAt: expect.any(Date) },
      });
      expect(execution).toMatchObject({
        publicReplyStatus,
        privateReplyStatus,
        publicReplyId: 'public-1',
        privateReplyError: 'Denied',
      });
    }
  );

  it.each([1, 0])(
    'reserves a traditional private reply only when the atomic update wins: %s',
    async (count) => {
      const { repository, prisma } = setup({});
      prisma.instagramCommentAutomationExecution.updateMany.mockResolvedValue({
        count,
      });
      await expect(
        repository.claimFacebookPrivateReplyAttempt('execution-1')
      ).resolves.toBe(count === 1);
      expect(
        prisma.instagramCommentAutomationExecution.updateMany
      ).toHaveBeenCalledWith({
        where: {
          id: 'execution-1',
          processedAt: null,
          privateReplyStatus: 'PENDING',
          privateReplyId: null,
          automation: { integration: { providerIdentifier: 'instagram' } },
        },
        data: {
          privateReplyStatus: 'FAILED',
          privateReplyError: expect.stringContaining('unconfirmed'),
        },
      });
    }
  );
});
