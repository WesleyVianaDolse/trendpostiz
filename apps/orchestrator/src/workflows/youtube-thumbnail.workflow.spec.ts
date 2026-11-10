const mockActivities = {
  processYoutubeThumbnail: jest.fn(),
  stopYoutubeThumbnail: jest.fn(),
};
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => mockActivities,
  defineSignal: (name: string) => name,
  setHandler: jest.fn(),
  sleep: jest.fn().mockResolvedValue(undefined),
}));
import { sleep } from '@temporalio/workflow';
import { youtubeThumbnailWorkflow } from './youtube-thumbnail.workflow';

describe('thumbnail durable timers', () => {
  const args = { organizationId: 'org', postId: 'post', videoId: 'video' };
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('waits between pending checks and stops immediately after success', async () => {
    mockActivities.processYoutubeThumbnail
      .mockResolvedValueOnce({ done: false, delay: 30000 })
      .mockResolvedValueOnce({ done: false, delay: 60000 })
      .mockResolvedValueOnce({ done: true });
    await youtubeThumbnailWorkflow(args);
    expect(sleep).toHaveBeenNthCalledWith(1, 30000);
    expect(sleep).toHaveBeenNthCalledWith(2, 60000);
    expect(mockActivities.processYoutubeThumbnail).toHaveBeenCalledTimes(3);
    expect(mockActivities.stopYoutubeThumbnail).not.toHaveBeenCalled();
  });
  it('has a hard bound even if processing never completes', async () => {
    mockActivities.processYoutubeThumbnail.mockResolvedValue({
      done: false,
      delay: 1000,
    });
    await youtubeThumbnailWorkflow(args);
    expect(mockActivities.processYoutubeThumbnail).toHaveBeenCalledTimes(13);
    expect(mockActivities.stopYoutubeThumbnail).toHaveBeenCalledWith(
      'org',
      'post',
      'video'
    );
  });
  it('records an isolated failure when the activity exhausts its retries', async () => {
    mockActivities.processYoutubeThumbnail.mockRejectedValue(
      new Error('Activity failed')
    );
    await youtubeThumbnailWorkflow(args);
    expect(mockActivities.stopYoutubeThumbnail).toHaveBeenCalledWith(
      'org',
      'post',
      'video'
    );
  });
});
