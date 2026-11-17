import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { recoveryKey } from './recovery-policy';

@Injectable()
export class PublicationMutationGuard {
  async lock(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ids: string[]
  ) {
    // Same lock order as the send gate. No HTTP under this transaction.
    await tx.$queryRaw`SELECT id FROM "AutomationRecoveryControl" WHERE id='global' FOR UPDATE`;
    for (const id of [...new Set(ids)].sort()) {
      await tx.$queryRaw`SELECT id FROM "Post" WHERE id=${id} AND "organizationId"=${organizationId} FOR UPDATE`;
      const post = await tx.post.findUnique({ where: { id } });
      if (!post || post.organizationId !== organizationId)
        throw new NotFoundException('Publicação não encontrada.');
      const unresolved = await tx.automationEffectAttempt.findFirst({
        where: {
          organizationId,
          postId: id,
          phase: { in: ['CLAIMED', 'UNCERTAIN'] },
        },
      });
      if (
        unresolved ||
        ['uploading', 'uncertain'].includes(post.youtubeUploadState || '')
      ) {
        throw new ConflictException(
          'Há uma tentativa sem confirmação. Concilie o resultado antes de reagendar.'
        );
      }
      if (
        post.releaseId ||
        post.releaseURL ||
        post.youtubeVideoId ||
        post.youtubeUploadKey
      ) {
        const evidenceId = recoveryKey(
          'record-evidence',
          organizationId,
          id,
          post.scheduleRevision,
          post.releaseId || '',
          post.releaseURL || '',
          post.youtubeVideoId || '',
          post.youtubeUploadKey || ''
        );
        await tx.publicationRecordEvidence.upsert({
          where: { id: evidenceId },
          create: {
            id: evidenceId,
            organizationId,
            postId: id,
            revision: post.scheduleRevision,
            groupSnapshot: post.group,
            dateSnapshot: post.publishDate,
            stateSnapshot: post.state,
            remoteId: post.releaseId,
            remoteUrl: post.releaseURL,
            youtubeVideoId: post.youtubeVideoId,
            uploadKey: post.youtubeUploadKey,
          },
          update: {},
        });
      }
    }
  }
}
