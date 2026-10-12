const mockPostActivities = {
  getPost: jest.fn(),
  getPostsList: jest.fn(),
  inAppNotification: jest.fn(),
  changeState: jest.fn(),
  updatePost: jest.fn(),
  sendWebhooks: jest.fn(),
  postSocial: jest.fn(),
  globalPlugs: jest.fn(),
  internalPlugs: jest.fn(),
};
const mockPatched = jest.fn();

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => mockPostActivities,
  defineSignal: (name: string) => name,
  setHandler: jest.fn(),
  sleep: jest.fn().mockResolvedValue(undefined),
  patched: (id: string) => mockPatched(id),
}));

import { postWorkflowV105 } from './post.workflow.v1.0.5';

const post = {
  id: 'post-1',
  organizationId: 'org',
  state: 'QUEUE',
  publishDate: new Date(),
  content: '<p>Olá!</p>',
  settings: '{}',
  integration: {
    id: 'integration-1',
    organizationId: 'org',
    name: 'Clínica',
    profile: 'clinica',
    providerIdentifier: 'instagram-standalone',
    refreshNeeded: false,
    disabled: false,
  },
};
const args = { taskQueue: 'instagram', postId: post.id, organizationId: 'org' };

describe('post notification details', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPatched.mockReturnValue(true);
    mockPostActivities.getPost.mockResolvedValue(post);
    mockPostActivities.getPostsList.mockResolvedValue([post]);
    mockPostActivities.postSocial.mockResolvedValue([
      { postId: 'remote-1', releaseURL: 'https://instagram.com/reel/1' },
    ]);
    mockPostActivities.globalPlugs.mockResolvedValue([]);
    mockPostActivities.internalPlugs.mockResolvedValue([]);
  });

  it('passes the exact connected account and provider result into the success notification', async () => {
    await postWorkflowV105(args);
    expect(mockPostActivities.inAppNotification).toHaveBeenCalledWith(
      'org',
      expect.any(String),
      expect.any(String),
      true,
      true,
      'success',
      expect.objectContaining({
        accountName: 'Clínica',
        username: 'clinica',
        providerIdentifier: 'instagram-standalone',
        content: '<p>Olá!</p>',
        releaseURL: 'https://instagram.com/reel/1',
        occurredAt: expect.any(String),
      })
    );
  });

  it('includes account context when a channel needs to be reconnected', async () => {
    mockPostActivities.getPostsList.mockResolvedValue([
      { ...post, integration: { ...post.integration, refreshNeeded: true } },
    ]);
    await postWorkflowV105(args);
    expect(mockPostActivities.inAppNotification.mock.calls[0][5]).toBe('info');
    expect(mockPostActivities.inAppNotification.mock.calls[0][6]).toMatchObject(
      { accountName: 'Clínica' }
    );
    expect(mockPostActivities.postSocial).not.toHaveBeenCalled();
  });

  it('preserves the five original notification arguments for pre-patch histories', async () => {
    mockPatched.mockReturnValue(false);
    await postWorkflowV105(args);
    expect(mockPostActivities.inAppNotification.mock.calls[0]).toHaveLength(5);
    expect(mockPostActivities.inAppNotification.mock.calls[0][4]).toBe(true);
  });
});
