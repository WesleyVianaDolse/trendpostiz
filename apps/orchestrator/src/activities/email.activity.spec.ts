jest.mock('nestjs-temporal-core', () => ({
  Activity: () => (target: unknown) => target,
  ActivityMethod: () => () => undefined,
}));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({
  EmailService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);

import { EmailActivity } from './email.activity';
import type { NotificationEmail } from '@gitroom/nestjs-libraries/emails/notification.email';

describe('digest email delivery', () => {
  const sendEmail = jest.fn();
  const activity = new EmailActivity({ sendEmail } as any, {} as any);
  const published: NotificationEmail = {
    type: 'success',
    title: '[TrendPostiz] Publicação confirmada',
    message: 'Published',
    post: {
      accountName: 'Conta A',
      providerIdentifier: 'facebook',
      releaseURL: 'https://facebook.com/reel/1',
    },
  };

  beforeEach(() => jest.clearAllMocks());

  it('delivers a rendered digest with the number of notifications in the subject', async () => {
    await activity.sendNotificationDigest('user@example.com', [
      published,
      { type: 'fail', message: 'Failed' },
    ]);
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com',
      '[TrendPostiz] Resumo de notificações (2)',
      expect.stringContaining('Conta A'),
      'bottom'
    );
    expect(sendEmail.mock.calls[0][2]).toContain(
      '1 sucesso &nbsp;·&nbsp; 1 falha'
    );
  });

  it('keeps the specific account subject for a single result', async () => {
    await activity.sendNotificationDigest('user@example.com', [published]);
    expect(sendEmail.mock.calls[0][1]).toBe(published.title);
    expect(sendEmail.mock.calls[0][2]).toContain('Ver publicação');
  });

  it('does not queue an empty email', async () => {
    await activity.sendNotificationDigest('user@example.com', []);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
