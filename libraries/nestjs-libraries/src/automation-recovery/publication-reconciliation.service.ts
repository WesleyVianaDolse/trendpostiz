import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../database/prisma/prisma.service';
import { recoveryKey } from './recovery-policy';

@Injectable()
export class PublicationReconciliationService {
  constructor(private prisma: PrismaService) {}

  private async membership(
    tx: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    write = false
  ) {
    const member = await tx.userOrganization.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { user: true, organization: true },
    });
    if (
      !member ||
      member.disabled ||
      member.user.disabledAt ||
      member.organization.deletionRequestedAt ||
      (write &&
        (member.organization.suspendedAt ||
          ![Role.ADMIN, Role.SUPERADMIN].includes(
            member.role as 'ADMIN' | 'SUPERADMIN'
          )))
    ) {
      throw new ForbiddenException('Acesso à conciliação não autorizado.');
    }
    return member;
  }

  history(organizationId: string, postId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await this.membership(tx, organizationId, userId);
      const post = await tx.post.findFirst({
        where: { id: postId, organizationId },
        select: { id: true },
      });
      if (!post) throw new NotFoundException('Publicação não encontrada.');
      const occurrences = await tx.publicationOccurrence.findMany({
        where: { organizationId, postId },
        orderBy: { scheduledAt: 'desc' },
        take: 100,
      });
      const ids = occurrences.map((o) => o.id);
      const evidence = await tx.publicationEvidence.findMany({
        where: { organizationId, occurrenceId: { in: ids } },
        orderBy: { confirmedAt: 'asc' },
      });
      const attempts = await tx.automationEffectAttempt.findMany({
        where: { organizationId, occurrenceId: { in: ids } },
        select: {
          occurrenceId: true,
          subjectKey: true,
          actionKey: true,
          phase: true,
          remoteId: true,
          failureReason: true,
        },
      });
      const derivedActions = await tx.publicationDerivedAction.findMany({
        where: { organizationId, rootOccurrenceId: { in: ids } },
        select: {
          id: true,
          rootOccurrenceId: true,
          kind: true,
          method: true,
          targetIntegrationId: true,
          schedule: true,
          phase: true,
          reason: true,
        },
      });
      const inventoryIssues = await tx.recoveryManifestItem.findMany({
        where: {
          organizationId,
          postId,
          manifest: { phase: { in: ['COMPLETE', 'REVALIDATED'] } },
        },
        select: {
          decision: true,
          reason: true,
          subjectKey: true,
          manifest: {
            select: { cutoffAt: true, version: true, createdAt: true },
          },
        },
        orderBy: { manifest: { createdAt: 'desc' } },
        take: 20,
      });
      return {
        inventoryIssues,
        canConfirmManual:
          !member.organization.suspendedAt && member.role !== 'USER',
        occurrences: occurrences.map((o) => ({
          id: o.id,
          scheduledAt: o.scheduledAt,
          revision: o.scheduleRevision,
          automaticOutcome: o.outcome,
          failureReason: o.failureReason,
          evidence: evidence
            .filter((e) => e.occurrenceId === o.id)
            .map((e) => ({
              origin: e.origin,
              remoteId: e.remoteId,
              remoteUrl: e.remoteUrl,
              confirmedAt: e.confirmedAt,
              confirmedById: e.confirmedById,
            })),
          attempts: attempts.filter(
            (a) =>
              a.occurrenceId === o.id &&
              !a.subjectKey.startsWith('derived:') &&
              !a.subjectKey.startsWith('completion:')
          ),
          derivedActions: derivedActions
            .filter((a) => a.rootOccurrenceId === o.id)
            .map((a) => ({
              ...a,
              attempts: attempts.filter(
                (e) => e.subjectKey === `derived:${a.id}`
              ),
            })),
          completionActions: attempts.filter(
            (a) =>
              a.occurrenceId === o.id && a.subjectKey.startsWith('completion:')
          ),
        })),
      };
    });
  }

  confirmManual(
    organizationId: string,
    postId: string,
    userId: string,
    input: {
      occurrenceId: string;
      requestId: string;
      remoteId: string;
      remoteUrl: string;
      attestation: string;
    }
  ) {
    if (
      input.attestation !== 'CONFIRM_MANUAL_PUBLICATION' ||
      !input.occurrenceId ||
      !input.requestId ||
      !input.remoteId?.trim() ||
      input.remoteId.length > 2048 ||
      !input.remoteUrl ||
      input.remoteUrl.length > 2048
    )
      throw new BadRequestException(
        'Confirme a publicação manual e informe sua referência.'
      );
    let url: URL;
    try {
      url = new URL(input.remoteUrl);
    } catch {
      throw new BadRequestException('Link público inválido.');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((k) =>
        /token|secret|key|authorization/i.test(k)
      )
    )
      throw new BadRequestException(
        'Informe somente o link público, sem credenciais.'
      );
    return this.prisma.$transaction(async (tx) => {
      await this.membership(tx, organizationId, userId, true);
      await tx.$queryRaw`SELECT id FROM "PublicationOccurrence" WHERE id=${input.occurrenceId} AND "organizationId"=${organizationId} FOR UPDATE`;
      const occurrence = await tx.publicationOccurrence.findFirst({
        where: { id: input.occurrenceId, organizationId, postId },
      });
      if (!occurrence)
        throw new NotFoundException('Ocorrência não encontrada.');
      const id = recoveryKey(
        'manual-attestation',
        organizationId,
        postId,
        input.occurrenceId,
        userId,
        input.requestId
      );
      const previous = await tx.publicationEvidence.findUnique({
        where: { id },
      });
      if (
        previous &&
        (previous.remoteId !== input.remoteId.trim() ||
          previous.remoteUrl !== url.href)
      )
        throw new ConflictException(
          'Esta confirmação já foi registrada com outra referência.'
        );
      const evidence = await tx.publicationEvidence.upsert({
        where: { id },
        create: {
          id,
          organizationId,
          occurrenceId: occurrence.id,
          origin: 'manual',
          confirmedById: userId,
          remoteId: input.remoteId.trim(),
          remoteUrl: url.href,
        },
        update: {},
      });
      // Human attestation never changes the automatic outcome, releases a claim,
      // requeues a Post or declares the network verified by an API call.
      return {
        id: evidence.id,
        origin: evidence.origin,
        confirmedAt: evidence.confirmedAt,
        automaticOutcome: occurrence.outcome,
      };
    });
  }
}
