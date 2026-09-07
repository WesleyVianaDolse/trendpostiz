import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  Query,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { InstagramWebhookEventsService } from '@gitroom/nestjs-libraries/database/prisma/instagram-webhooks/instagram-webhook-events.service';
import { InstagramWebhookPayload } from '@gitroom/nestjs-libraries/dtos/webhooks/instagram.webhook.dto';
import { InstagramCommentAutomationDispatcherService } from '@gitroom/nestjs-libraries/instagram-comment-automation/instagram-comment-automation-dispatcher.service';

export function isValidInstagramSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  appSecret: string | undefined
) {
  if (
    !rawBody ||
    !signature ||
    !appSecret ||
    !signature.startsWith('sha256=')
  ) {
    return false;
  }

  const digest = signature.slice('sha256='.length);
  if (!/^[a-fA-F0-9]{64}$/.test(digest)) {
    return false;
  }

  const supplied = Buffer.from(digest, 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

@ApiTags('Instagram Webhook')
@Controller('/public/webhooks/instagram')
export class InstagramWebhookController {
  constructor(
    private _eventsService: InstagramWebhookEventsService,
    private _dispatcher: InstagramCommentAutomationDispatcherService
  ) {}

  @Get('/')
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.challenge') challenge?: string,
    @Query('hub.verify_token') verifyToken?: string
  ) {
    const expectedToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    if (!expectedToken) {
      throw new ServiceUnavailableException(
        'Instagram webhook verification is not configured'
      );
    }

    if (mode !== 'subscribe' || verifyToken !== expectedToken || !challenge) {
      throw new ForbiddenException('Invalid Instagram webhook verification');
    }

    return challenge;
  }

  @Post('/')
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string
  ) {
    if (!process.env.INSTAGRAM_APP_SECRET) {
      throw new ServiceUnavailableException(
        'Instagram webhook signature validation is not configured'
      );
    }

    if (
      !isValidInstagramSignature(
        request.rawBody,
        signature,
        process.env.INSTAGRAM_APP_SECRET
      )
    ) {
      throw new ForbiddenException('Invalid Instagram webhook signature');
    }

    const result = await this._eventsService.receive(
      request.body as InstagramWebhookPayload | unknown
    );
    void this._dispatcher.dispatchMany(result.eventIds);
    return { received: true };
  }
}
