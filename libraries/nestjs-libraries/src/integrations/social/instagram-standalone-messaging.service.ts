import { Injectable } from '@nestjs/common';

export const INSTAGRAM_GRAPH_API_VERSION = 'v25.0';

export class InstagramMetaApiError extends Error {
  constructor(message: string, public readonly transient: boolean) {
    super(message);
    this.name = transient
      ? 'InstagramMetaTransientError'
      : 'InstagramMetaPermanentError';
  }
}

@Injectable()
export class InstagramStandaloneMessagingService {
  async replyToComment(commentId: string, message: string, token: string) {
    const response = await this.request(
      `/${encodeURIComponent(commentId)}/replies`,
      { message },
      token
    );
    if (typeof response.id !== 'string' || !response.id) {
      throw new InstagramMetaApiError(
        'Instagram public reply response did not contain an id',
        false
      );
    }
    return response.id;
  }

  async sendPrivateReplyFromComment(
    commentId: string,
    message: string,
    token: string
  ) {
    // Meta's current Instagram Login collection supports Private Replies on
    // the versioned /me/messages endpoint, so Phase 2 uses v25.0 consistently.
    const response = await this.request(
      '/me/messages',
      {
        recipient: { comment_id: commentId },
        message: { text: message },
      },
      token
    );
    const id = response.message_id || response.id;
    if (typeof id !== 'string' || !id) {
      throw new InstagramMetaApiError(
        'Instagram private reply response did not contain a message id',
        false
      );
    }
    return id;
  }

  sanitizeError(message: string, token?: string) {
    let sanitized = message;
    if (token) sanitized = sanitized.split(token).join('[REDACTED]');
    return sanitized
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/access_token(?:=|%3D)[^&\s"']+/gi, 'access_token=[REDACTED]')
      .slice(0, 1000);
  }

  private async request(path: string, body: object, token: string) {
    try {
      const response = await fetch(
        `https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}${path}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        }
      );
      const payload = await this.parseResponse(response);
      if (response.ok) return payload;

      const metaError = payload?.error;
      const transientCodes = new Set([1, 2, 4, 17, 32, 341, 613]);
      const transient =
        [429, 500, 502, 503, 504].includes(response.status) ||
        metaError?.is_transient === true ||
        transientCodes.has(Number(metaError?.code));
      const safeDetails = this.sanitizeError(
        JSON.stringify({
          status: response.status,
          code: metaError?.code,
          errorSubcode: metaError?.error_subcode,
          type: metaError?.type,
          message: metaError?.message || 'Instagram API request failed',
        }),
        token
      );
      throw new InstagramMetaApiError(safeDetails, transient);
    } catch (error) {
      if (error instanceof InstagramMetaApiError) throw error;
      throw new InstagramMetaApiError(
        this.sanitizeError(
          error instanceof Error ? error.message : 'Instagram request failed',
          token
        ),
        true
      );
    }
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
