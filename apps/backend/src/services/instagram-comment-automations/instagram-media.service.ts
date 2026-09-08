import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { Integration } from '@prisma/client';
import { INSTAGRAM_FACEBOOK_GRAPH_API_VERSION } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { INSTAGRAM_GRAPH_API_VERSION } from '@gitroom/nestjs-libraries/integrations/social/instagram-standalone-messaging.service';

export interface InstagramMediaItem {
  id: string;
  caption: string;
  mediaType: string;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
}

@Injectable()
export class InstagramMediaService {
  private readonly fields =
    'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';

  async list(integration: Integration, after?: string) {
    const url = new URL(
      `${this.baseUrl(integration)}/${encodeURIComponent(
        integration.internalId
      )}/media`
    );
    url.searchParams.set('fields', this.fields);
    url.searchParams.set('limit', '24');
    if (after) url.searchParams.set('after', after);

    const payload = await this.request(url, integration.token, false);
    return {
      items: (payload.data || []).map((item: any) => this.sanitize(item)),
      nextCursor: payload.paging?.next
        ? payload.paging?.cursors?.after || null
        : null,
    };
  }

  async get(integration: Integration, mediaId: string) {
    if (!mediaId.trim()) throw new BadRequestException('Post inválido.');
    const url = new URL(
      `${this.baseUrl(integration)}/${encodeURIComponent(mediaId)}`
    );
    url.searchParams.set('fields', this.fields);
    return this.sanitize(await this.request(url, integration.token, true));
  }

  private baseUrl(integration: Integration) {
    if (integration.providerIdentifier === 'instagram-standalone') {
      return `https://graph.instagram.com/${INSTAGRAM_GRAPH_API_VERSION}`;
    }
    if (integration.providerIdentifier === 'instagram') {
      return `https://graph.facebook.com/${INSTAGRAM_FACEBOOK_GRAPH_API_VERSION}`;
    }
    throw new BadRequestException('A conta selecionada não é do Instagram.');
  }

  private async request(
    url: URL,
    token: string,
    invalidMediaIsBadRequest: boolean
  ) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) {
        if (invalidMediaIsBadRequest) {
          throw new BadRequestException('O post selecionado não é válido.');
        }
        throw new BadGatewayException(
          'Não foi possível carregar os posts do Instagram.'
        );
      }
      return payload;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof BadGatewayException
      ) {
        throw error;
      }
      throw new BadGatewayException(
        'Não foi possível comunicar com o Instagram.'
      );
    }
  }

  private sanitize(item: any): InstagramMediaItem {
    return {
      id: String(item.id),
      caption: typeof item.caption === 'string' ? item.caption : '',
      mediaType: typeof item.media_type === 'string' ? item.media_type : '',
      thumbnailUrl: item.thumbnail_url || item.media_url || null,
      permalink: typeof item.permalink === 'string' ? item.permalink : null,
      timestamp: typeof item.timestamp === 'string' ? item.timestamp : null,
    };
  }
}
