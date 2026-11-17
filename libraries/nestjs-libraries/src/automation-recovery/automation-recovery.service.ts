import { Injectable, Optional } from '@nestjs/common';
import { InstagramCommentTimeReader } from './instagram-comment-time-reader';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { admittedContract } from './recovery-approval';
import { PrismaService } from '../database/prisma/prisma.service';
import type { PostResponse } from '../integrations/social/social.integrations.interface';
import {
  RECOVERY_EXPIRED_MESSAGE,
  RECOVERY_PROTOCOL,
  RecoveryHold,
  RecoveryWorkflowContext,
  recoveryKey,
  PublicationEffectContext,
  publicationRequestHash,
} from './recovery-policy';

type Tx = Prisma.TransactionClient;
type Policy = {
  runId: string;
  cutoffAt: Date;
  generation: number;
  scope: string[];
  authorizedAt: Date;
};
type Subject = {
  organizationId: string;
  subjectKey: string;
  actionKey: string;
  requestHash: string;
  occurrenceId?: string;
  postId?: string;
};
type Reservation = Subject & {
  id: string;
  claimId: string;
  generation: number;
  receipt?: Prisma.JsonValue;
  reused?: boolean;
};
export type { PublicationEffectContext } from './recovery-policy';

@Injectable()
export class AutomationRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly timeReader?: InstagramCommentTimeReader
  ) {}

  withOpenPolicy<T>(
    work: (tx: Prisma.TransactionClient, policy: Policy) => Promise<T>
  ) {
    return this.prisma.$transaction(
      async (tx) => work(tx, await this.lockedPolicy(tx)),
      { maxWait: 10000, timeout: 20000 }
    );
  }

  private publicationRequestHash(
    input: PublicationEffectContext,
    plannedAt?: Date
  ) {
    if (
      plannedAt &&
      input.plannedAt &&
      +new Date(input.plannedAt) !== +plannedAt
    )
      throw new RecoveryHold('EFFECT_REQUEST_CHANGED');
    return publicationRequestHash(plannedAt ? { ...input, plannedAt } : input);
  }

  private async lockedPolicy(
    tx: Tx,
    protocolVersion = RECOVERY_PROTOCOL
  ): Promise<Policy> {
    await tx.$queryRaw`SELECT id FROM "AutomationRecoveryControl" WHERE id='global' FOR UPDATE`;
    const control = await tx.automationRecoveryControl.findUnique({
      where: { id: 'global' },
    });
    if (!control || control.phase !== 'OPEN')
      throw new RecoveryHold('RECOVERY_CLOSED');
    if (
      protocolVersion !== RECOVERY_PROTOCOL ||
      control.protocolVersion !== RECOVERY_PROTOCOL
    )
      throw new RecoveryHold('RECOVERY_PROTOCOL_MISMATCH');
    const run = control.runId
      ? await tx.automationRecoveryRun.findUnique({
          where: { id: control.runId },
        })
      : null;
    if (
      !Number.isSafeInteger(control.generation) ||
      control.generation < 1 ||
      !run ||
      run.phase !== 'VERIFIED' ||
      run.protocolVersion !== RECOVERY_PROTOCOL ||
      !run.authorizedById ||
      !run.authorizedAt ||
      +run.authorizedAt > Date.now() ||
      !run.manifestHash ||
      !Number.isFinite(+run.cutoffAt)
    ) {
      throw new RecoveryHold('RECOVERY_NOT_VERIFIED');
    }
    if (+run.cutoffAt > Date.now())
      throw new RecoveryHold('RECOVERY_NOT_STARTED');
    const contract = await admittedContract(tx, control);
    return {
      runId: run.id,
      cutoffAt: run.cutoffAt,
      generation: control.generation,
      scope: contract.m.scope as string[],
      authorizedAt: run.authorizedAt,
    };
  }

  private async terminalDecision(tx: Tx, subjectKey: string) {
    return tx.automationRecoveryDecision.findFirst({
      where: { subjectKey, action: { in: ['EXPIRE', 'HOLD_UNCERTAIN'] } },
    });
  }

  private async assertOrganization(tx: Tx, organizationId: string) {
    const org = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { suspendedAt: true, deletionRequestedAt: true },
    });
    if (!org || org.suspendedAt || org.deletionRequestedAt)
      throw new RecoveryHold('ORGANIZATION_UNAVAILABLE');
  }

  private async publicationSubject(
    tx: Tx,
    policy: Policy,
    input: PublicationEffectContext,
    ownClaimId?: string
  ): Promise<Subject> {
    if (!input.snapshots.length || !input.workflowId || !input.runId)
      throw new RecoveryHold('OCCURRENCE_UNRESOLVED');
    if (
      await tx.automationRecoveryDecision.findFirst({
        where: {
          subjectKey: `workflow:${input.workflowId}:${input.runId}`,
          action: 'HOLD_WORKFLOW',
        },
      })
    )
      throw new RecoveryHold('WORKFLOW_RETAINED_BY_MANIFEST');
    if (input.actionKey.startsWith('comment:') && !input.parentRemoteId)
      throw new RecoveryHold('PARENT_CONFIRMATION_REQUIRED');
    await this.assertOrganization(tx, input.organizationId);
    if (input.derived) {
      if (!input.parentRemoteId || !input.targetIntegrationId)
        throw new RecoveryHold('DERIVED_CONTEXT_UNRESOLVED');
      const target = await tx.integration.findFirst({
        where: {
          id: input.targetIntegrationId,
          organizationId: input.organizationId,
          deletedAt: null,
          disabled: false,
          refreshNeeded: false,
          inBetweenSteps: false,
        },
      });
      if (!target) throw new RecoveryHold('DERIVED_TARGET_UNAVAILABLE');
    }
    const binding = await tx.automationWorkflowBinding.findUnique({
      where: {
        workflowId_runId_actionKey: {
          workflowId: input.workflowId,
          runId: input.runId,
          actionKey: input.actionKey,
        },
      },
    });
    if (!binding || binding.organizationId !== input.organizationId)
      throw new RecoveryHold('LEGACY_BINDING_REQUIRED');
    const occurrence = await tx.publicationOccurrence.findUnique({
      where: { id: binding.occurrenceId },
    });
    if (
      !occurrence ||
      occurrence.organizationId !== input.organizationId ||
      occurrence.postId !== input.snapshots[0].id
    ) {
      throw new RecoveryHold('OCCURRENCE_SCOPE_MISMATCH');
    }
    if (
      !policy.scope.includes(input.organizationId) &&
      +occurrence.createdAt <= +policy.authorizedAt
    )
      throw new RecoveryHold('BACKLOG_OUTSIDE_APPROVED_SCOPE');
    if (!binding.expectedRequestHash)
      throw new RecoveryHold('BINDING_PAYLOAD_UNVERIFIED');
    if (
      binding.expectedRequestHash !==
      this.publicationRequestHash(input, occurrence.scheduledAt)
    )
      throw new RecoveryHold('EFFECT_REQUEST_CHANGED');
    const subjectKey = `occurrence:${occurrence.id}`;
    const unresolved = await tx.automationEffectAttempt.findFirst({
      where: {
        occurrenceId: occurrence.id,
        actionKey: input.actionKey,
        phase: { in: ['CLAIMED', 'UNCERTAIN'] },
      },
    });
    if (
      unresolved &&
      !(unresolved.phase === 'CLAIMED' && unresolved.claimId === ownClaimId)
    )
      throw new RecoveryHold('REMOTE_EFFECT_UNCONFIRMED');
    if (await this.terminalDecision(tx, subjectKey))
      throw new RecoveryHold('OCCURRENCE_TERMINALLY_HELD');
    if (
      !input.derived &&
      (await tx.publicationEvidence.findFirst({
        where: {
          organizationId: input.organizationId,
          occurrenceId: occurrence.id,
          origin: 'manual',
          confirmedById: { not: null },
        },
      }))
    )
      throw new RecoveryHold('PUBLICATION_MANUALLY_CONFIRMED');
    if (['UNCERTAIN', 'CLAIMED'].includes(occurrence.attemptState))
      throw new RecoveryHold('OCCURRENCE_UNCONFIRMED');
    for (const snapshot of input.snapshots) {
      await tx.$queryRaw`SELECT id FROM "Post" WHERE id=${snapshot.id} AND "organizationId"=${input.organizationId} FOR UPDATE`;
      const post = await tx.post.findFirst({
        where: { id: snapshot.id, organizationId: input.organizationId },
        include: { integration: true },
      });
      if (
        !post ||
        post.adminPausedAt ||
        post.deletedAt ||
        post.integrationId !== input.integrationId ||
        post.integration.organizationId !== input.organizationId ||
        post.integration.disabled ||
        post.integration.deletedAt ||
        post.integration.refreshNeeded ||
        post.integration.inBetweenSteps
      )
        throw new RecoveryHold('PUBLICATION_UNAVAILABLE');
      if (
        snapshot.group !== post.group ||
        +new Date(snapshot.publishDate) !== +post.publishDate ||
        (snapshot.scheduleRevision !== undefined &&
          snapshot.scheduleRevision !== post.scheduleRevision) ||
        occurrence.scheduleRevision !== post.scheduleRevision ||
        occurrence.groupSnapshot !== post.group
      ) {
        throw new RecoveryHold('SCHEDULE_REVISION_CHANGED');
      }
      const laterRecurrence =
        !!post.intervalInDays && +occurrence.scheduledAt !== +post.publishDate;
      if (post.state === 'PUBLISHED' && !laterRecurrence && !input.derived)
        throw new RecoveryHold('PUBLICATION_ALREADY_CONFIRMED');
      if (
        post.state !== 'QUEUE' &&
        !(post.state === 'PUBLISHED' && (laterRecurrence || input.derived))
      )
        throw new RecoveryHold('PUBLICATION_STATE_HELD');
      if (
        !laterRecurrence &&
        !input.derived &&
        (post.releaseId || post.releaseURL)
      )
        throw new RecoveryHold('PUBLICATION_HAS_REMOTE_EVIDENCE');
    }
    if (occurrence.outcome === 'CONFIRMED' && !input.derived)
      throw new RecoveryHold('OCCURRENCE_ALREADY_CONFIRMED');
    if (
      occurrence.outcome !== 'PENDING' &&
      !(input.derived && occurrence.outcome === 'CONFIRMED')
    )
      throw new RecoveryHold('OCCURRENCE_HELD');
    if (+occurrence.scheduledAt < +policy.cutoffAt) {
      // Commit expiry without throwing inside this transaction (see reserve).
      await tx.automationRecoveryDecision.upsert({
        where: { subjectKey_action: { subjectKey, action: 'EXPIRE' } },
        create: {
          recoveryId: policy.runId,
          organizationId: input.organizationId,
          subjectKey,
          action: 'EXPIRE',
          reason: 'PUBLICATION_BEFORE_T0',
        },
        update: {},
      });
      await tx.publicationOccurrence.update({
        where: { id: occurrence.id },
        data: { outcome: 'EXPIRED', failureReason: 'PUBLICATION_BEFORE_T0' },
      });
      await tx.post.updateMany({
        where: {
          id: occurrence.postId,
          organizationId: input.organizationId,
          scheduleRevision: occurrence.scheduleRevision,
          group: occurrence.groupSnapshot,
          publishDate: occurrence.scheduledAt,
          intervalInDays: null,
          state: 'QUEUE',
          releaseId: null,
          releaseURL: null,
        },
        data: { state: 'ERROR', error: RECOVERY_EXPIRED_MESSAGE },
      });
      return {
        organizationId: input.organizationId,
        subjectKey,
        actionKey: '__EXPIRED__',
        requestHash: '',
      };
    }
    if (+occurrence.scheduledAt > Date.now())
      throw new RecoveryHold('OCCURRENCE_NOT_DUE');
    if (input.parentRemoteId) {
      const ancestors: string[] = input.derived ? [input.snapshots[0].id] : [];
      let currentId = input.snapshots[0].id;
      for (let n = 0; n < 100; n++) {
        const current = await tx.post.findFirst({
          where: { id: currentId, organizationId: input.organizationId },
          select: { parentPostId: true },
        });
        if (!current?.parentPostId) break;
        if (ancestors.includes(current.parentPostId))
          throw new RecoveryHold('PARENT_UNRESOLVED');
        ancestors.push(current.parentPostId);
        currentId = current.parentPostId;
      }
      const parent = await tx.automationEffectAttempt.findFirst({
        where: {
          organizationId: input.organizationId,
          postId: { in: ancestors },
          phase: 'CONFIRMED',
          remoteId: input.parentRemoteId,
        },
      });
      if (!parent) {
        const parentOccurrences = await tx.publicationOccurrence.findMany({
          where: {
            organizationId: input.organizationId,
            postId: { in: ancestors },
          },
          select: { id: true },
        });
        const manual = await tx.publicationEvidence.findFirst({
          where: {
            organizationId: input.organizationId,
            occurrenceId: { in: parentOccurrences.map((p) => p.id) },
            origin: 'manual',
            confirmedById: { not: null },
            remoteId: input.parentRemoteId,
          },
        });
        if (!manual) throw new RecoveryHold('PARENT_CONFIRMATION_REQUIRED');
      }
    }
    return {
      organizationId: input.organizationId,
      subjectKey,
      actionKey: input.actionKey,
      requestHash: this.publicationRequestHash(input, occurrence.scheduledAt),
      occurrenceId: occurrence.id,
      postId: occurrence.postId,
    };
  }

  private async commentSubject(
    tx: Tx,
    policy: Policy,
    eventId: string,
    organizationId: string,
    delivery: string
  ): Promise<Subject> {
    await this.assertOrganization(tx, organizationId);
    await tx.$queryRaw`SELECT id FROM "InstagramWebhookEvent" WHERE id=${eventId} FOR UPDATE`;
    const event = await tx.instagramWebhookEvent.findUnique({
      where: { id: eventId },
      include: { integration: true, automationExecution: true },
    });
    if (
      event &&
      !policy.scope.includes(organizationId) &&
      +event.receivedAt <= +policy.authorizedAt
    )
      throw new RecoveryHold('BACKLOG_OUTSIDE_APPROVED_SCOPE');
    if (
      !event ||
      !event.integration ||
      event.integration.organizationId !== organizationId ||
      event.integration.deletedAt ||
      event.integration.disabled ||
      event.integration.refreshNeeded ||
      event.integration.inBetweenSteps
    )
      throw new RecoveryHold('COMMENT_SCOPE_UNAVAILABLE');
    const subjectKey = `comment:${event.id}`;
    const previousDecision = await this.terminalDecision(tx, subjectKey);
    if (previousDecision?.action === 'HOLD_UNCERTAIN')
      throw new RecoveryHold('REMOTE_EFFECT_UNCONFIRMED');
    if (
      event.recoverySkipReason &&
      event.recoverySkipReason !== 'COMMENT_BEFORE_T0'
    )
      throw new RecoveryHold('COMMENT_RECOVERY_HELD');
    const trustedCreation =
      !!event.occurredAt &&
      event.occurredAtSource === 'META_COMMENT_CREATED_TIME' &&
      Number.isFinite(+event.occurredAt) &&
      +event.occurredAt <= +event.receivedAt;
    const expired =
      +event.receivedAt < +policy.cutoffAt ||
      (trustedCreation && +event.occurredAt < +policy.cutoffAt);
    if (
      expired ||
      previousDecision?.action === 'EXPIRE' ||
      event.recoverySkipReason === 'COMMENT_BEFORE_T0'
    ) {
      await tx.automationRecoveryDecision.upsert({
        where: { subjectKey_action: { subjectKey, action: 'EXPIRE' } },
        create: {
          recoveryId: policy.runId,
          organizationId,
          subjectKey,
          action: 'EXPIRE',
          reason: 'COMMENT_BEFORE_T0',
        },
        update: {},
      });
      const execution = event.automationExecution;
      let effectiveStatuses: string[] = [];
      if (execution) {
        const pendingPatch: Prisma.InstagramCommentAutomationExecutionUpdateInput =
          {};
        for (const action of ['public', 'private'] as const) {
          const status =
            action === 'public'
              ? execution.publicReplyStatus
              : execution.privateReplyStatus;
          if (status !== 'PENDING') {
            effectiveStatuses.push(status);
            continue;
          }
          const attempt = await tx.automationEffectAttempt.findUnique({
            where: {
              id: recoveryKey(
                organizationId,
                subjectKey,
                `instagram:${action}`
              ),
            },
          });
          const confirmed =
            attempt?.phase === 'CONFIRMED' &&
            typeof attempt.receipt === 'string';
          const next = confirmed ? 'SUCCESS' : attempt ? 'FAILED' : 'SKIPPED';
          effectiveStatuses.push(next);
          if (action === 'public') {
            pendingPatch.publicReplyStatus = next;
            pendingPatch.publicReplyError = confirmed
              ? null
              : attempt
              ? 'REMOTE_UNCONFIRMED'
              : 'COMMENT_BEFORE_T0';
            if (confirmed)
              pendingPatch.publicReplyId = attempt.receipt as string;
          } else {
            pendingPatch.privateReplyStatus = next;
            pendingPatch.privateReplyError = confirmed
              ? null
              : attempt
              ? 'REMOTE_UNCONFIRMED'
              : 'COMMENT_BEFORE_T0';
            if (confirmed)
              pendingPatch.privateReplyId = attempt.receipt as string;
          }
        }
        await tx.instagramCommentAutomationExecution.update({
          where: { id: execution.id },
          data: {
            ...pendingPatch,
            processedAt: execution.processedAt || new Date(),
          },
        });
      }
      await tx.instagramWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: effectiveStatuses.includes('FAILED')
            ? 'FAILED'
            : effectiveStatuses.includes('SUCCESS')
            ? 'REPLIED'
            : 'SKIPPED',
          recoverySkipReason: event.recoverySkipReason || 'COMMENT_BEFORE_T0',
        },
      });
      return {
        organizationId,
        subjectKey,
        actionKey: '__EXPIRED__',
        requestHash: '',
      };
    }
    // Receipt time and entry.time are not proof of comment creation time.
    if (!trustedCreation)
      throw new RecoveryHold('COMMENT_CREATION_TIME_UNVERIFIED');
    return {
      organizationId,
      subjectKey,
      actionKey: `instagram:${delivery}`,
      requestHash: recoveryKey(
        organizationId,
        event.id,
        event.externalCommentId || '',
        event.integrationId || '',
        delivery
      ),
    };
  }

  async guardCommentEvent(eventId: string, organizationId: string) {
    // Metadata reads are allowed only for events first received after an OPEN
    // authorized cut. No remote request is needed to suppress stored backlog.
    const candidate = await this.prisma.$transaction(async (tx) => {
      const policy = await this.lockedPolicy(tx);
      const event = await tx.instagramWebhookEvent.findUnique({
        where: { id: eventId },
        include: { integration: true },
      });
      if (
        !event ||
        event.integration?.organizationId !== organizationId ||
        event.recoverySkipReason ||
        +event.receivedAt < +policy.cutoffAt ||
        event.occurredAtSource === 'META_COMMENT_CREATED_TIME' ||
        !['RECEIVED', 'PROCESSING'].includes(event.status)
      )
        return null;
      await this.assertOrganization(tx, organizationId);
      if (
        event.integration.deletedAt ||
        event.integration.disabled ||
        event.integration.refreshNeeded ||
        event.integration.inBetweenSteps ||
        !event.externalCommentId
      )
        return null;
      return event;
    });
    if (candidate) {
      const occurredAt = await (
        this.timeReader || new InstagramCommentTimeReader()
      ).read(candidate.integration, candidate.externalCommentId);
      if (occurredAt && +occurredAt <= +candidate.receivedAt)
        await this.prisma.instagramWebhookEvent.updateMany({
          where: {
            id: eventId,
            integrationId: candidate.integrationId,
            OR: [
              { occurredAtSource: null },
              { occurredAtSource: { not: 'META_COMMENT_CREATED_TIME' } },
            ],
            recoverySkipReason: null,
            status: { in: ['RECEIVED', 'PROCESSING'] },
          },
          data: { occurredAt, occurredAtSource: 'META_COMMENT_CREATED_TIME' },
        });
    }
    const expired = await this.prisma.$transaction(async (tx) => {
      const policy = await this.lockedPolicy(tx);
      return (
        (
          await this.commentSubject(
            tx,
            policy,
            eventId,
            organizationId,
            'prepare'
          )
        ).actionKey === '__EXPIRED__'
      );
    });
    if (expired) throw new RecoveryHold('COMMENT_BEFORE_T0');
  }

  async guardCommentClaim(tx: Tx, eventId: string, organizationId: string) {
    const policy = await this.lockedPolicy(tx);
    return (
      (
        await this.commentSubject(
          tx,
          policy,
          eventId,
          organizationId,
          'prepare'
        )
      ).actionKey !== '__EXPIRED__'
    );
  }

  async guardPublication(input: PublicationEffectContext) {
    if (await this.confirmedPublicationReceipt(input)) return;
    const expired = await this.prisma.$transaction(async (tx) => {
      const policy = await this.lockedPolicy(tx, input.protocolVersion);
      return (
        (await this.publicationSubject(tx, policy, input)).actionKey ===
        '__EXPIRED__'
      );
    });
    if (expired) throw new RecoveryHold('BEFORE_RECOVERY_CUTOFF');
  }

  async confirmedPublicationReceipt(
    input: PublicationEffectContext
  ): Promise<PostResponse[] | null> {
    if (input.protocolVersion !== RECOVERY_PROTOCOL)
      throw new RecoveryHold('RECOVERY_PROTOCOL_MISMATCH');
    const binding = await this.prisma.automationWorkflowBinding.findUnique({
      where: {
        workflowId_runId_actionKey: {
          workflowId: input.workflowId,
          runId: input.runId,
          actionKey: input.actionKey,
        },
      },
    });
    if (!binding || binding.organizationId !== input.organizationId)
      return null;
    if (!binding.expectedRequestHash) return null;
    const occurrence = await this.prisma.publicationOccurrence.findFirst({
      where: {
        id: binding.occurrenceId,
        organizationId: input.organizationId,
        postId: input.snapshots[0]?.id,
      },
    });
    if (!occurrence) return null;
    const requestHash = this.publicationRequestHash(
      input,
      occurrence.scheduledAt
    );
    if (binding.expectedRequestHash !== requestHash)
      throw new RecoveryHold('EFFECT_REQUEST_CHANGED');
    const attempt = await this.prisma.automationEffectAttempt.findUnique({
      where: {
        id: recoveryKey(
          input.organizationId,
          `occurrence:${occurrence.id}`,
          input.actionKey
        ),
      },
    });
    if (attempt && attempt.requestHash !== requestHash)
      throw new RecoveryHold('EFFECT_REQUEST_CHANGED');
    if (attempt?.phase !== 'CONFIRMED' || !Array.isArray(attempt.receipt))
      return null;
    if (
      !attempt.receipt.every(
        (r) =>
          r &&
          typeof r === 'object' &&
          !Array.isArray(r) &&
          typeof r.id === 'string' &&
          typeof r.postId === 'string' &&
          typeof r.releaseURL === 'string' &&
          typeof r.status === 'string'
      )
    )
      throw new RecoveryHold('RECEIPT_UNVERIFIED');
    return attempt.receipt as unknown as PostResponse[];
  }

  async confirmedCommentReceipt(
    eventId: string,
    organizationId: string,
    delivery: 'public' | 'private'
  ): Promise<string | null> {
    if (!eventId) return null;
    const event = await this.prisma.instagramWebhookEvent.findUnique({
      where: { id: eventId },
      select: { integration: { select: { organizationId: true } } },
    });
    if (event?.integration?.organizationId !== organizationId) return null;
    const attempt = await this.prisma.automationEffectAttempt.findUnique({
      where: {
        id: recoveryKey(
          organizationId,
          `comment:${eventId}`,
          `instagram:${delivery}`
        ),
      },
    });
    return attempt?.phase === 'CONFIRMED' && typeof attempt.receipt === 'string'
      ? attempt.receipt
      : null;
  }

  async contextForBoundAction(
    context: RecoveryWorkflowContext,
    actionKey: string,
    postId?: string
  ): Promise<PublicationEffectContext> {
    const binding = await this.prisma.automationWorkflowBinding.findUnique({
      where: {
        workflowId_runId_actionKey: {
          workflowId: context.workflowId,
          runId: context.runId,
          actionKey,
        },
      },
    });
    if (!binding) throw new RecoveryHold('LEGACY_BINDING_REQUIRED');
    const occurrence = await this.prisma.publicationOccurrence.findFirst({
      where: {
        id: binding.occurrenceId,
        organizationId: binding.organizationId,
      },
    });
    if (!occurrence || (postId && occurrence.postId !== postId))
      throw new RecoveryHold('OCCURRENCE_SCOPE_MISMATCH');
    const post = await this.prisma.post.findFirst({
      where: { id: occurrence.postId, organizationId: binding.organizationId },
    });
    if (!post) throw new RecoveryHold('PUBLICATION_UNAVAILABLE');
    return {
      ...context,
      organizationId: binding.organizationId,
      integrationId: post.integrationId,
      actionKey,
      plannedAt: occurrence.scheduledAt,
      snapshots: [
        {
          id: post.id,
          group: occurrence.groupSnapshot,
          publishDate: post.publishDate,
          scheduleRevision: occurrence.scheduleRevision,
        },
      ],
    };
  }

  async projectActivityReceipt(
    context: RecoveryWorkflowContext,
    postId: string,
    remoteId: string,
    releaseURL: string
  ) {
    const bindings = await this.prisma.automationWorkflowBinding.findMany({
      where: {
        workflowId: context.workflowId,
        runId: context.runId,
        actionKey: { in: [`publication:${postId}`, `comment:${postId}`] },
      },
    });
    if (bindings.length !== 1)
      throw new RecoveryHold('LEGACY_BINDING_REQUIRED');
    return this.projectPublication(
      await this.contextForBoundAction(context, bindings[0].actionKey, postId),
      remoteId,
      releaseURL
    );
  }

  async recordWorkflowFailure(
    context: RecoveryWorkflowContext,
    postId: string
  ) {
    const bindings = await this.prisma.automationWorkflowBinding.findMany({
      where: {
        workflowId: context.workflowId,
        runId: context.runId,
        actionKey: { in: [`publication:${postId}`, `comment:${postId}`] },
      },
    });
    if (bindings.length !== 1)
      throw new RecoveryHold('LEGACY_BINDING_REQUIRED');
    const input = await this.contextForBoundAction(
      context,
      bindings[0].actionKey,
      postId
    );
    return this.prisma.$transaction(async (tx) => {
      const occurrence = await tx.publicationOccurrence.findFirst({
        where: {
          id: bindings[0].occurrenceId,
          organizationId: input.organizationId,
        },
      });
      if (!occurrence) throw new RecoveryHold('OCCURRENCE_UNRESOLVED');
      const attempts = await tx.automationEffectAttempt.findMany({
        where: {
          occurrenceId: occurrence.id,
          organizationId: input.organizationId,
          subjectKey: `occurrence:${occurrence.id}`,
          actionKey: input.actionKey,
        },
      });
      if (attempts.some((a) => a.phase === 'CONFIRMED')) return;
      // A competing workflow's deduplication hold is not a failure of the
      // claimant that may still be receiving its HTTP acknowledgement.
      if (attempts.some((a) => a.phase === 'CLAIMED')) return;
      if (attempts.length) {
        await tx.publicationOccurrence.updateMany({
          where: { id: occurrence.id, outcome: 'PENDING' },
          data: {
            outcome: 'UNCERTAIN',
            attemptState: 'UNCERTAIN',
            failureReason: 'REMOTE_UNCONFIRMED',
          },
        });
        return;
      }
      await tx.publicationOccurrence.updateMany({
        where: { id: occurrence.id, outcome: 'PENDING' },
        data: {
          outcome: 'FAILED',
          failureReason: 'AUTOMATIC_PUBLICATION_FAILED',
        },
      });
      await tx.post.updateMany({
        where: {
          id: postId,
          organizationId: input.organizationId,
          scheduleRevision: occurrence.scheduleRevision,
          group: occurrence.groupSnapshot,
          publishDate: occurrence.scheduledAt,
          intervalInDays: null,
          state: 'QUEUE',
          releaseId: null,
          releaseURL: null,
          adminPausedAt: null,
          organization: { suspendedAt: null, deletionRequestedAt: null },
        },
        data: {
          state: 'ERROR',
          error:
            'Publicação automática interrompida. Consulte o histórico da ocorrência.',
        },
      });
    });
  }

  private async reserve(
    resolve: (tx: Tx, policy: Policy) => Promise<Subject>,
    protocolVersion = RECOVERY_PROTOCOL
  ): Promise<Reservation> {
    const reservation = await this.prisma.$transaction(
      async (tx) => {
        const policy = await this.lockedPolicy(tx, protocolVersion);
        const subject = await resolve(tx, policy);
        if (subject.actionKey === '__EXPIRED__') return null;
        const id = recoveryKey(
          subject.organizationId,
          subject.subjectKey,
          subject.actionKey
        );
        const previous = await tx.automationEffectAttempt.findUnique({
          where: { id },
        });
        if (previous) {
          if (previous.requestHash !== subject.requestHash)
            throw new RecoveryHold('EFFECT_REQUEST_CHANGED');
          if (previous.phase === 'CONFIRMED' && previous.receipt !== null)
            return {
              ...subject,
              id,
              claimId: previous.claimId,
              generation: previous.generation,
              receipt: previous.receipt,
              reused: true,
            };
          throw new RecoveryHold('REMOTE_EFFECT_UNCONFIRMED');
        }
        const claimId = randomUUID();
        await tx.automationEffectAttempt.create({
          data: { ...subject, id, claimId, generation: policy.generation },
        });
        return { ...subject, id, claimId, generation: policy.generation };
      },
      { maxWait: 10000, timeout: 20000 }
    );
    if (!reservation) throw new RecoveryHold('BEFORE_RECOVERY_CUTOFF');
    return reservation;
  }

  private safeReceipt(value: unknown): Prisma.InputJsonValue {
    if (typeof value === 'string' && value.length > 0 && value.length <= 2048)
      return value;
    if (!Array.isArray(value) || !value.length)
      throw new RecoveryHold('REMOTE_RECEIPT_UNVERIFIED');
    return value.map((row: Record<string, unknown>) => {
      if (
        !row ||
        typeof row.id !== 'string' ||
        typeof row.postId !== 'string' ||
        !row.postId
      )
        throw new RecoveryHold('REMOTE_RECEIPT_UNVERIFIED');
      let releaseURL = '';
      if (typeof row.releaseURL === 'string' && row.releaseURL) {
        const url = new URL(row.releaseURL);
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new RecoveryHold('REMOTE_RECEIPT_UNVERIFIED');
        for (const name of Array.from(url.searchParams.keys()))
          if (/token|secret|key|authorization/i.test(name))
            url.searchParams.delete(name);
        releaseURL = url.href;
      }
      return {
        id: row.id,
        postId: row.postId,
        releaseURL,
        status:
          typeof row.status === 'string'
            ? row.status.slice(0, 64)
            : 'published',
      };
    });
  }

  private async execute<T>(
    resolve: (tx: Tx, policy: Policy, ownClaimId?: string) => Promise<Subject>,
    send: () => Promise<T>,
    protocolVersion = RECOVERY_PROTOCOL
  ): Promise<T> {
    const reservation = await this.reserve(resolve, protocolVersion);
    if (reservation.reused) return reservation.receipt as T;
    try {
      // A separate last check after the durable reservation, before any HTTP.
      await this.prisma.$transaction(
        async (tx) => {
          const policy = await this.lockedPolicy(tx, protocolVersion);
          if (policy.generation !== reservation.generation)
            throw new RecoveryHold('RECOVERY_GENERATION_CHANGED');
          const subject = await resolve(tx, policy, reservation.claimId);
          if (
            subject.subjectKey !== reservation.subjectKey ||
            subject.actionKey !== reservation.actionKey
          )
            throw new RecoveryHold('RECOVERY_SUBJECT_CHANGED');
          const attempt = await tx.automationEffectAttempt.findUnique({
            where: { id: reservation.id },
          });
          if (
            !attempt ||
            attempt.claimId !== reservation.claimId ||
            attempt.phase !== 'CLAIMED'
          )
            throw new RecoveryHold('CLAIM_UNAVAILABLE');
        },
        { maxWait: 10000, timeout: 20000 }
      );
      const receipt = this.safeReceipt(await send());
      await this.prisma.$transaction(async (tx) => {
        const result = await tx.automationEffectAttempt.updateMany({
          where: {
            id: reservation.id,
            claimId: reservation.claimId,
            phase: 'CLAIMED',
          },
          data: {
            phase: 'CONFIRMED',
            receipt,
            remoteId:
              typeof receipt === 'string'
                ? receipt
                : (receipt as { postId: string }[])[0].postId,
          },
        });
        if (result.count !== 1)
          throw new RecoveryHold('RECEIPT_CHECKPOINT_CONFLICT');
        // Projection into Post is deliberately separate and revision checked.
      });
      return receipt as T;
    } catch (error) {
      // Never reset a claim after a crash/timeout or after checkpoint failure.
      await this.prisma.automationEffectAttempt
        .updateMany({
          where: {
            id: reservation.id,
            claimId: reservation.claimId,
            phase: 'CLAIMED',
          },
          data: {
            phase: 'UNCERTAIN',
            failureReason:
              error instanceof RecoveryHold
                ? error.reason
                : 'REMOTE_UNCONFIRMED',
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  async executePublication<T>(
    input: PublicationEffectContext,
    send: () => Promise<T>
  ): Promise<T> {
    const confirmed = await this.confirmedPublicationReceipt(input);
    if (confirmed) return confirmed as unknown as T;
    return this.execute(
      (tx, policy, claimId) =>
        this.publicationSubject(tx, policy, input, claimId),
      send,
      input.protocolVersion
    );
  }

  executeComment<T>(
    eventId: string,
    organizationId: string,
    delivery: 'public' | 'private',
    send: () => Promise<T>
  ): Promise<T> {
    return this.execute(
      (tx, policy) =>
        this.commentSubject(tx, policy, eventId, organizationId, delivery),
      send
    );
  }

  async checkpointPublication(
    input: PublicationEffectContext,
    remoteId: string,
    releaseURL: string
  ) {
    const safe = this.safeReceipt([
      {
        id: input.snapshots[0]?.id,
        postId: remoteId,
        releaseURL,
        status: 'checkpointed',
      },
    ]);
    return this.prisma.$transaction(async (tx) => {
      const binding = await tx.automationWorkflowBinding.findUnique({
        where: {
          workflowId_runId_actionKey: {
            workflowId: input.workflowId,
            runId: input.runId,
            actionKey: input.actionKey,
          },
        },
      });
      if (!binding || binding.organizationId !== input.organizationId)
        throw new RecoveryHold('LEGACY_BINDING_REQUIRED');
      const occurrence = await tx.publicationOccurrence.findFirst({
        where: {
          id: binding.occurrenceId,
          organizationId: input.organizationId,
          postId: input.snapshots[0]?.id,
        },
      });
      if (!occurrence) throw new RecoveryHold('OCCURRENCE_SCOPE_MISMATCH');
      const id = recoveryKey(
        input.organizationId,
        `occurrence:${occurrence.id}`,
        input.actionKey
      );
      const result = await tx.automationEffectAttempt.updateMany({
        where: {
          id,
          phase: 'CLAIMED',
          requestHash: this.publicationRequestHash(
            input,
            occurrence.scheduledAt
          ),
        },
        data: { receipt: safe, remoteId },
      });
      if (result.count !== 1) throw new RecoveryHold('CLAIM_UNAVAILABLE');
      await tx.publicationEvidence.upsert({
        where: { id: `checkpoint:${id}` },
        create: {
          id: `checkpoint:${id}`,
          organizationId: input.organizationId,
          occurrenceId: occurrence.id,
          origin: 'automatic-checkpoint',
          remoteId,
          remoteUrl: (safe as { releaseURL: string }[])[0].releaseURL,
        },
        update: {},
      });
    });
  }

  async projectPublication(
    input: PublicationEffectContext,
    remoteId: string,
    releaseURL: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Confirmed receipts may be recorded after closure without authorizing HTTP.
      const binding = await tx.automationWorkflowBinding.findUnique({
        where: {
          workflowId_runId_actionKey: {
            workflowId: input.workflowId,
            runId: input.runId,
            actionKey: input.actionKey,
          },
        },
      });
      if (!binding || binding.organizationId !== input.organizationId)
        throw new RecoveryHold('LEGACY_BINDING_REQUIRED');
      const occurrence = await tx.publicationOccurrence.findFirst({
        where: {
          id: binding.occurrenceId,
          organizationId: input.organizationId,
        },
      });
      if (!occurrence) throw new RecoveryHold('OCCURRENCE_UNRESOLVED');
      const attempt = await tx.automationEffectAttempt.findUnique({
        where: {
          id: recoveryKey(
            input.organizationId,
            `occurrence:${occurrence.id}`,
            input.actionKey
          ),
        },
      });
      if (
        !attempt ||
        attempt.phase !== 'CONFIRMED' ||
        !Array.isArray(attempt.receipt) ||
        !attempt.receipt.some(
          (r) =>
            !!r &&
            typeof r === 'object' &&
            !Array.isArray(r) &&
            r.postId === remoteId &&
            r.id === occurrence.postId &&
            r.releaseURL === releaseURL
        )
      )
        throw new RecoveryHold('RECEIPT_UNVERIFIED');
      await tx.publicationEvidence.upsert({
        where: { id: `automatic:${attempt.id}` },
        create: {
          id: `automatic:${attempt.id}`,
          organizationId: input.organizationId,
          occurrenceId: occurrence.id,
          origin: 'automatic',
          remoteId,
          remoteUrl: releaseURL,
        },
        update: {},
      });
      await tx.publicationOccurrence.updateMany({
        where: { id: occurrence.id, outcome: 'PENDING' },
        data: {
          outcome: 'CONFIRMED',
          attemptState: 'CONFIRMED',
          remoteId,
          remoteUrl: releaseURL,
        },
      });
      // Preserve newer revisions and any pre-existing/manual receipt.
      await tx.post.updateMany({
        where: {
          id: occurrence.postId,
          organizationId: input.organizationId,
          scheduleRevision: occurrence.scheduleRevision,
          group: occurrence.groupSnapshot,
          publishDate: occurrence.scheduledAt,
          state: 'QUEUE',
          releaseId: null,
          releaseURL: null,
        },
        data: { state: 'PUBLISHED', releaseId: remoteId, releaseURL },
      });
    });
  }
}
