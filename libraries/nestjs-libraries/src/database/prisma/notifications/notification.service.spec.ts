jest.mock('./notifications.repository', () => ({
  NotificationsRepository: class {},
}));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({
  EmailService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository',
  () => ({ OrganizationRepository: class {} })
);
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

import { NotificationService } from './notification.service';

describe('post notification delivery', () => {
  const createNotification = jest.fn();
  const sendEmail = jest.fn();
  const signalWithStart = jest.fn();
  const getAllUsersOrgs = jest.fn();
  const service = new NotificationService(
    { createNotification } as any,
    { sendEmail } as any,
    { getAllUsersOrgs } as any,
    {
      client: { getRawClient: () => ({ workflow: { signalWithStart } }) },
    } as any
  );
  const post = {
    accountName: 'Clínica',
    username: 'clinica',
    providerIdentifier: 'instagram-standalone',
    releaseURL: 'https://instagram.com/reel/1',
    content: '<p>Olá!</p>',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getAllUsersOrgs.mockResolvedValue({
      users: [
        {
          user: {
            email: 'yes@example.com',
            sendSuccessEmails: true,
            sendFailureEmails: true,
          },
        },
        {
          user: {
            email: 'no@example.com',
            sendSuccessEmails: false,
            sendFailureEmails: false,
          },
        },
      ],
    });
  });

  it('queues structured account details while keeping the original in-app message', async () => {
    await service.inAppNotification(
      'org',
      'Published',
      'Original message',
      true,
      true,
      'success',
      post
    );
    expect(createNotification).toHaveBeenCalledWith('org', 'Original message');
    expect(signalWithStart).toHaveBeenCalledWith(
      'digestEmailWorkflow',
      expect.objectContaining({
        signalArgs: [
          [
            expect.objectContaining({
              title: '[TrendPostiz] Publicação confirmada: Instagram · Clínica',
              message: 'Original message',
              type: 'success',
              post,
            }),
          ],
        ],
      })
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('renders an immediate account notification and honors failure preferences', async () => {
    await service.inAppNotification(
      'org',
      'Failed',
      'Could not publish',
      true,
      false,
      'fail',
      post
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      'yes@example.com',
      '[TrendPostiz] Falha na publicação: Instagram · Clínica',
      expect.stringContaining('@clinica'),
      'top',
      undefined
    );
    expect(sendEmail.mock.calls[0][2]).not.toContain('Ver publicação');
  });

  it('keeps notifications without account details backward compatible', async () => {
    await service.inAppNotification(
      'org',
      'Info',
      'Message',
      true,
      false,
      'info'
    );
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledWith(
      'no@example.com',
      'Info',
      'Message',
      'top',
      undefined
    );
  });
});
