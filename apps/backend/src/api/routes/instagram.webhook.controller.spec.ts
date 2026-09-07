import { ForbiddenException } from '@nestjs/common';
import { createHmac } from 'node:crypto';

jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/instagram-webhooks/instagram-webhook-events.service',
  () => ({ InstagramWebhookEventsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/instagram-comment-automation/instagram-comment-automation-dispatcher.service',
  () => ({ InstagramCommentAutomationDispatcherService: class {} })
);

import {
  InstagramWebhookController,
  isValidInstagramSignature,
} from './instagram.webhook.controller';

describe('InstagramWebhookController', () => {
  const eventsService = { receive: jest.fn() };
  const dispatcher = { dispatchMany: jest.fn().mockResolvedValue(undefined) };
  const controller = new InstagramWebhookController(
    eventsService as any,
    dispatcher as any
  );

  beforeEach(() => {
    jest.clearAllMocks();
    eventsService.receive.mockResolvedValue({ events: 0, eventIds: [] });
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = 'verify-token';
    process.env.INSTAGRAM_APP_SECRET = 'app-secret';
  });

  afterAll(() => {
    delete process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    delete process.env.INSTAGRAM_APP_SECRET;
  });

  it('returns the challenge for a valid verification request', () => {
    expect(
      controller.verify('subscribe', 'challenge-value', 'verify-token')
    ).toBe('challenge-value');
  });

  it('rejects an incorrect verification token', () => {
    expect(() =>
      controller.verify('subscribe', 'challenge-value', 'wrong-token')
    ).toThrow(ForbiddenException);
  });

  it('rejects an invalid verification mode', () => {
    expect(() =>
      controller.verify('unsubscribe', 'challenge-value', 'verify-token')
    ).toThrow(ForbiddenException);
  });

  it('accepts a request with a valid signature', async () => {
    const body: { object: string; entry: any[] } = {
      object: 'instagram',
      entry: [],
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac('sha256', 'app-secret')
      .update(rawBody)
      .digest('hex')}`;

    await expect(
      controller.receive({ rawBody, body } as any, signature)
    ).resolves.toEqual({ received: true });
    expect(eventsService.receive).toHaveBeenCalledWith(body);
    expect(dispatcher.dispatchMany).toHaveBeenCalledWith([]);
  });

  it('acknowledges messaging payloads without dispatching an event', async () => {
    const body = {
      object: 'instagram',
      entry: [{ id: 'account-1', messaging: [{ message: { text: 'hello' } }] }],
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac('sha256', 'app-secret')
      .update(rawBody)
      .digest('hex')}`;

    await expect(
      controller.receive({ rawBody, body } as any, signature)
    ).resolves.toEqual({ received: true });
    expect(dispatcher.dispatchMany).toHaveBeenCalledWith([]);
  });

  it('acknowledges a signed payload even when its object is unknown', async () => {
    const body = { object: 'unknown', entry: [{ unexpected: true }] };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac('sha256', 'app-secret')
      .update(rawBody)
      .digest('hex')}`;

    await expect(
      controller.receive({ rawBody, body } as any, signature)
    ).resolves.toEqual({ received: true });
    expect(eventsService.receive).toHaveBeenCalledWith(body);
  });

  it.each([undefined, 'sha256=invalid'])(
    'rejects signature %s',
    async (signature) => {
      const body: { object: string; entry: any[] } = {
        object: 'instagram',
        entry: [],
      };
      await expect(
        controller.receive(
          { rawBody: Buffer.from(JSON.stringify(body)), body } as any,
          signature
        )
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(eventsService.receive).not.toHaveBeenCalled();
    }
  );

  it('rejects signatures generated with another secret', async () => {
    const rawBody = Buffer.from('{}');
    const signature = `sha256=${createHmac('sha256', 'another-secret')
      .update(rawBody)
      .digest('hex')}`;
    expect(isValidInstagramSignature(rawBody, signature, 'app-secret')).toBe(
      false
    );
    await expect(
      controller.receive({ rawBody, body: {} } as any, signature)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(eventsService.receive).not.toHaveBeenCalled();
  });
});
