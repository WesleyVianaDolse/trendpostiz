import { BadRequestException, Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import {
  InstagramMetaApiError,
  InstagramStandaloneMessagingService,
} from './instagram-standalone-messaging.service';
import { INSTAGRAM_FACEBOOK_GRAPH_API_VERSION } from './instagram.provider';

@Injectable()
export class InstagramFacebookCommentMessagingStrategy {
  replyToComment(integration: Integration, commentId: string, message: string) {
    return this.request(
      integration,
      `/${encodeURIComponent(commentId)}/replies`,
      { message },
      'id',
      true
    );
  }

  sendPrivateReplyFromComment(
    integration: Integration,
    commentId: string,
    message: string
  ) {
    if (!integration.facebookPageId) {
      throw new InstagramMetaApiError(
        'Facebook Page ID is required for a Facebook Login private reply',
        false
      );
    }
    return this.request(
      integration,
      // Legacy Instagram Messaging / Facebook Login uses the linked Page and
      // its Page token. IG ID /messages is a different Instagram API contract.
      `/${encodeURIComponent(integration.facebookPageId)}/messages`,
      {
        recipient: { comment_id: commentId },
        message: { text: message },
      },
      'message_id',
      false
    );
  }

  private async request(
    integration: Integration,
    path: string,
    body: object,
    responseId: 'id' | 'message_id',
    allowRetry: boolean
  ) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${INSTAGRAM_FACEBOOK_GRAPH_API_VERSION}${path}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${integration.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        }
      );
      const payload = await this.parseResponse(response);
      if (response.ok && !payload?.error) {
        const id = payload?.[responseId];
        if (typeof id === 'string' && id) return id;
        throw new InstagramMetaApiError(
          'Instagram reply response did not contain an id',
          false
        );
      }

      const metaError = payload?.error;
      const alreadyReplied = /already.+repl|one private repl/i.test(
        String(metaError?.message || '')
      );
      const transientCodes = new Set([1, 2, 4, 17, 32, 341, 613]);
      const transient =
        allowRetry &&
        !alreadyReplied &&
        ([429, 500, 502, 503, 504].includes(response.status) ||
          metaError?.is_transient === true ||
          transientCodes.has(Number(metaError?.code)));
      throw new InstagramMetaApiError(
        this.sanitizeError(
          JSON.stringify({
            status: response.status,
            code: metaError?.code,
            errorSubcode: metaError?.error_subcode,
            type: metaError?.type,
            message: metaError?.message || 'Instagram API request failed',
          }),
          integration.token
        ),
        transient
      );
    } catch (error) {
      if (error instanceof InstagramMetaApiError) throw error;
      throw new InstagramMetaApiError(
        this.sanitizeError(
          error instanceof Error
            ? allowRetry
              ? error.message
              : `Private reply delivery outcome is unknown; automatic retry suppressed: ${error.message}`
            : 'Instagram request failed',
          integration.token
        ),
        allowRetry
      );
    }
  }

  private sanitizeError(message: string, token?: string) {
    let sanitized = message;
    if (token) sanitized = sanitized.split(token).join('[REDACTED]');
    return sanitized
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/access_token(?:=|%3D)[^&\s"']+/gi, 'access_token=[REDACTED]')
      .slice(0, 1000);
  }

  private async parseResponse(response: Response): Promise<any> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
}

@Injectable()
export class InstagramCommentMessagingService {
  constructor(
    private readonly standalone: InstagramStandaloneMessagingService,
    private readonly facebook: InstagramFacebookCommentMessagingStrategy
  ) {}

  replyToComment(integration: Integration, commentId: string, message: string) {
    if (integration.providerIdentifier === 'instagram-standalone') {
      return this.standalone.replyToComment(
        commentId,
        message,
        integration.token
      );
    }
    if (integration.providerIdentifier === 'instagram') {
      return this.facebook.replyToComment(integration, commentId, message);
    }
    throw new BadRequestException('Unsupported Instagram provider');
  }

  sendPrivateReplyFromComment(
    integration: Integration,
    commentId: string,
    message: string
  ) {
    if (integration.providerIdentifier === 'instagram-standalone') {
      return this.standalone.sendPrivateReplyFromComment(
        commentId,
        message,
        integration.token
      );
    }
    if (integration.providerIdentifier === 'instagram') {
      return this.facebook.sendPrivateReplyFromComment(
        integration,
        commentId,
        message
      );
    }
    throw new BadRequestException('Unsupported Instagram provider');
  }

  sanitizeError(message: string) {
    return this.standalone.sanitizeError(message);
  }
}
