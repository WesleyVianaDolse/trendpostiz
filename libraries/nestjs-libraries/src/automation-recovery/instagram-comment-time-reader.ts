import { Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { INSTAGRAM_GRAPH_API_VERSION } from '../integrations/social/instagram-standalone-messaging.service';

// Read-only IGComment metadata. Never use entry.time or receipt time as creation
// proof, and never expose a caller-controlled URL or token in diagnostics.
@Injectable()
export class InstagramCommentTimeReader {
  async read(
    integration: Pick<Integration, 'providerIdentifier' | 'token'>,
    commentId: string
  ): Promise<Date | null> {
    const host =
      integration.providerIdentifier === 'instagram'
        ? 'graph.facebook.com'
        : integration.providerIdentifier === 'instagram-standalone'
        ? 'graph.instagram.com'
        : null;
    if (!host || !integration.token || !commentId) return null;
    try {
      const response = await fetch(
        `https://${host}/${INSTAGRAM_GRAPH_API_VERSION}/${encodeURIComponent(
          commentId
        )}?fields=timestamp`,
        {
          headers: { Authorization: `Bearer ${integration.token}` },
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        }
      );
      if (!response.ok) return null;
      const data = await response.json();
      if (
        data?.error ||
        typeof data?.timestamp !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)$/.test(
          data.timestamp
        )
      )
        return null;
      const time = new Date(data.timestamp);
      return Number.isFinite(+time) ? time : null;
    } catch {
      return null;
    }
  }
}
