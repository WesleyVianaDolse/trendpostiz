jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/instagram-comment-automations/instagram-comment-automation.repository',
  () => ({ InstagramCommentAutomationRepository: class {} })
);

import { InstagramCommentAutomationDispatcherService } from './instagram-comment-automation-dispatcher.service';

describe('InstagramCommentAutomationDispatcherService', () => {
  const start = jest.fn().mockResolvedValue({});
  const describe = jest.fn().mockResolvedValue({});
  const temporal = {
    client: {
      getRawClient: () => ({
        workflow: {
          start,
          getHandle: () => ({ describe }),
        },
      }),
    },
  };
  const repository = { findReceivedEventIds: jest.fn() };
  const dispatcher = new InstagramCommentAutomationDispatcherService(
    temporal as any,
    repository as any
  );

  beforeEach(() => {
    jest.clearAllMocks();
    start.mockResolvedValue({});
  });

  it('uses a deterministic workflow ID for duplicate dispatches', async () => {
    await dispatcher.dispatch('event-1');
    await dispatcher.dispatch('event-1');
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        workflowId: 'instagram-comment-event-1',
        workflowIdConflictPolicy: 'USE_EXISTING',
      })
    );
    expect(start.mock.calls[1][1].workflowId).toBe(
      start.mock.calls[0][1].workflowId
    );
  });

  it('reconciles RECEIVED events that were not dispatched', async () => {
    repository.findReceivedEventIds.mockResolvedValue([
      { id: 'event-1' },
      { id: 'event-2' },
    ]);
    await dispatcher.reconcile();
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls.map((call) => call[1].workflowId)).toEqual([
      'instagram-comment-event-1',
      'instagram-comment-event-2',
    ]);
  });

  it('accepts a start timeout when the deterministic workflow exists', async () => {
    start.mockRejectedValue(new Error('network timeout'));
    await expect(dispatcher.dispatch('event-1')).resolves.toBeUndefined();
    expect(describe).toHaveBeenCalled();
  });
});
