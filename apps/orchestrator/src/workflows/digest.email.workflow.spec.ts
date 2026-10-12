const mockEmailActivities = {
  getUserOrgs: jest.fn(),
  sendEmailAsync: jest.fn(),
  sendNotificationDigest: jest.fn(),
};
const mockPatched = jest.fn();

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => mockEmailActivities,
  defineSignal: (name: string) => name,
  setHandler: jest.fn(),
  condition: jest.fn().mockResolvedValue(undefined),
  sleep: jest.fn().mockResolvedValue(undefined),
  continueAsNew: jest.fn().mockResolvedValue(undefined),
  patched: (id: string) => mockPatched(id),
}));

import { digestEmailWorkflow } from './digest.email.workflow';
import type { Email } from '../signals/email.signal';

const success: Email = {
  type: 'success',
  title: 'Success',
  message: 'Published',
  post: {
    accountName: 'Conta A',
    providerIdentifier: 'facebook',
    releaseURL: 'https://facebook.com/reel/1',
  },
};
const failure: Email = {
  type: 'fail',
  title: 'Failure',
  message: 'Could not publish',
};
const info: Email = {
  type: 'info',
  title: 'Info',
  message: 'Please reconnect',
};

describe('notification digest workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPatched.mockReturnValue(true);
    mockEmailActivities.getUserOrgs.mockResolvedValue({
      users: [
        {
          user: {
            email: 'success@example.com',
            sendSuccessEmails: true,
            sendFailureEmails: false,
          },
        },
        {
          user: {
            email: 'failure@example.com',
            sendSuccessEmails: false,
            sendFailureEmails: true,
          },
        },
        {
          user: {
            email: 'info@example.com',
            sendSuccessEmails: false,
            sendFailureEmails: false,
          },
        },
      ],
    });
  });

  it('passes only allowed notifications to each recipient’s digest', async () => {
    await digestEmailWorkflow({
      organizationId: 'org',
      queue: [success, failure, info],
    });
    const calls = mockEmailActivities.sendNotificationDigest.mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual(['success@example.com', [success, info]]);
    expect(calls[1]).toEqual(['failure@example.com', [failure, info]]);
    expect(calls[2]).toEqual(['info@example.com', [info]]);
    expect(mockEmailActivities.sendEmailAsync).not.toHaveBeenCalled();
  });

  it('does not send an empty digest when all events are excluded', async () => {
    mockEmailActivities.getUserOrgs.mockResolvedValue({
      users: [
        {
          user: {
            email: 'none@example.com',
            sendSuccessEmails: false,
            sendFailureEmails: false,
          },
        },
      ],
    });
    await digestEmailWorkflow({
      organizationId: 'org',
      queue: [success, failure],
    });
    expect(mockEmailActivities.sendEmailAsync).not.toHaveBeenCalled();
    expect(mockEmailActivities.sendNotificationDigest).not.toHaveBeenCalled();
  });

  it('preserves legacy arguments when replaying a history without the patch', async () => {
    mockPatched.mockReturnValue(false);
    mockEmailActivities.getUserOrgs.mockResolvedValue({
      users: [
        {
          user: {
            email: 'all@example.com',
            sendSuccessEmails: true,
            sendFailureEmails: true,
          },
        },
      ],
    });
    await digestEmailWorkflow({
      organizationId: 'org',
      queue: [success, failure],
    });
    expect(mockEmailActivities.sendEmailAsync).toHaveBeenCalledWith(
      'all@example.com',
      '[TrendPostiz] Your latest notifications',
      'Published<br/>Could not publish',
      'bottom'
    );
    expect(mockEmailActivities.sendNotificationDigest).not.toHaveBeenCalled();
  });
});
