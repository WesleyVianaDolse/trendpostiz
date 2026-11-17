import { ConflictException, Injectable, Optional } from '@nestjs/common';
import { DerivedPublicationService } from './derived-publication.service';
import { Prisma, Post } from '@prisma/client';
import { TemporalService } from 'nestjs-temporal-core';
import { PrismaService } from '../database/prisma/prisma.service';
import { AutomationRecoveryService } from './automation-recovery.service';
import {
  nextFixedOccurrence,
  publicationRequestHash,
  RECOVERY_EXPIRED_MESSAGE,
  RecoveryHold,
  RecoveryWorkflowContext,
  recoveryKey,
} from './recovery-policy';

type Member = {
  occurrenceId?: string;
  id: string;
  group: string;
  publishDate: string;
  scheduleRevision: number;
  scheduledAt: string;
};
export type ScheduleDescriptor = {
  occurrenceId: string;
  organizationId: string;
  scheduledAt: string;
  taskQueue: string;
  workflowId: string;
};

@Injectable()
export class PublicationSchedulingService {
  constructor(
    private prisma: PrismaService,
    private recovery: AutomationRecoveryService,
    private temporal: TemporalService,
    @Optional() private derived?: DerivedPublicationService
  ) {}

  private async members(
    tx: Prisma.TransactionClient,
    root: Post,
    slot: Date
  ): Promise<Member[]> {
    const members: Member[] = [];
    let current = root,
      plannedAt = +slot;
    for (let n = 0; n < 100; n++) {
      if (
        members.some((p) => p.id === current.id) ||
        current.organizationId !== root.organizationId ||
        current.integrationId !== root.integrationId ||
        current.group !== root.group ||
        current.deletedAt
      )
        throw new RecoveryHold('THREAD_IDENTITY_UNRESOLVED');
      if (n) plannedAt += Math.max(0, Number(current.delay || 0)) * 60_000;
      if (!Number.isSafeInteger(plannedAt))
        throw new RecoveryHold('THREAD_TIME_UNRESOLVED');
      members.push({
        id: current.id,
        group: current.group,
        publishDate: current.publishDate.toISOString(),
        scheduleRevision: current.scheduleRevision,
        scheduledAt: new Date(plannedAt).toISOString(),
      });
      const children = await tx.post.findMany({
        where: {
          parentPostId: current.id,
          organizationId: root.organizationId,
          deletedAt: null,
        },
        take: 2,
      });
      if (!children.length) return members;
      if (children.length > 1)
        throw new RecoveryHold('THREAD_IDENTITY_UNRESOLVED');
      current = children[0];
    }
    throw new RecoveryHold('THREAD_IDENTITY_UNRESOLVED');
  }

  private descriptor(
    intent: {
      occurrenceId: string;
      workflowId: string;
      organizationId: string;
    },
    scheduledAt: Date,
    provider: string
  ): ScheduleDescriptor {
    return {
      occurrenceId: intent.occurrenceId,
      organizationId: intent.organizationId,
      workflowId: intent.workflowId,
      scheduledAt: scheduledAt.toISOString(),
      taskQueue: provider.split('-')[0].toLowerCase(),
    };
  }

  private async stage(
    tx: Prisma.TransactionClient,
    policy: { runId: string; cutoffAt: Date; generation: number },
    root: Post & { integration: { providerIdentifier: string } },
    slot: Date,
    anchor: Date,
    source: string,
    reviewedIds?: Record<string, string>
  ): Promise<ScheduleDescriptor | null> {
    const members = await this.members(tx, root, slot);
    const rootId =
      reviewedIds?.[root.id] ||
      recoveryKey(
        'publication-slot',
        root.organizationId,
        root.id,
        root.scheduleRevision,
        slot.toISOString()
      );
    // Frozen slot identity is independent of a Temporal run or retry id.
    for (const m of members) {
      const id =
        reviewedIds?.[m.id] ||
        (m.id === root.id
          ? rootId
          : recoveryKey(
              'publication-slot',
              root.organizationId,
              m.id,
              m.scheduleRevision,
              m.scheduledAt
            ));
      const existingSlot = await tx.publicationOccurrence.findUnique({
        where: {
          organizationId_postId_scheduleRevision_scheduledAt: {
            organizationId: root.organizationId,
            postId: m.id,
            scheduleRevision: m.scheduleRevision,
            scheduledAt: new Date(m.scheduledAt),
          },
        },
      });
      if (existingSlot && existingSlot.id !== id)
        throw new RecoveryHold('LEGACY_INVENTORY_REQUIRED');
      if (reviewedIds?.[m.id]) m.occurrenceId = id;
      await tx.publicationOccurrence.upsert({
        where: { id },
        create: {
          id,
          organizationId: root.organizationId,
          postId: m.id,
          scheduleRevision: m.scheduleRevision,
          scheduledAt: new Date(m.scheduledAt),
          groupSnapshot: m.group,
        },
        update: {},
      });
      if (+new Date(m.scheduledAt) < +policy.cutoffAt) {
        const subjectKey = `occurrence:${id}`;
        const attempt = await tx.automationEffectAttempt.findFirst({
          where: { organizationId: root.organizationId, occurrenceId: id },
        });
        const existing = await tx.publicationOccurrence.findUniqueOrThrow({
          where: { id },
        });
        if (
          !attempt &&
          existing.outcome === 'PENDING' &&
          existing.attemptState === 'UNATTEMPTED'
        ) {
          await tx.automationRecoveryDecision.upsert({
            where: { subjectKey_action: { subjectKey, action: 'EXPIRE' } },
            create: {
              recoveryId: policy.runId,
              organizationId: root.organizationId,
              subjectKey,
              action: 'EXPIRE',
              reason: 'PUBLICATION_BEFORE_T0',
            },
            update: {},
          });
          await tx.publicationOccurrence.update({
            where: { id },
            data: {
              outcome: 'EXPIRED',
              failureReason: 'PUBLICATION_BEFORE_T0',
            },
          });
          if (!root.intervalInDays)
            await tx.post.updateMany({
              where: {
                id: m.id,
                organizationId: root.organizationId,
                group: m.group,
                scheduleRevision: m.scheduleRevision,
                publishDate: new Date(m.scheduledAt),
                state: 'QUEUE',
                releaseId: null,
                releaseURL: null,
              },
              data: { state: 'ERROR', error: RECOVERY_EXPIRED_MESSAGE },
            });
        }
      }
    }
    // Save the frozen parent metadata even when only future derived actions
    // survive the cutoff. Their dependency may later be manually reconciled.
    if (+slot < +policy.cutoffAt)
      await tx.publicationScheduleIntent.upsert({
        where: { occurrenceId: rootId },
        create: {
          occurrenceId: rootId,
          organizationId: root.organizationId,
          workflowId: `publication-${rootId}`,
          generation: policy.generation,
          snapshot: { integrationId: root.integrationId, members },
          source,
          seriesAnchor: root.intervalInDays ? anchor : null,
          intervalDays: root.intervalInDays,
        },
        update: {},
      });
    if (this.derived) await this.derived.stage(tx, root, slot, rootId);
    if (+slot < +policy.cutoffAt) {
      if (!root.intervalInDays) return null;
      return this.stage(
        tx,
        policy,
        root,
        nextFixedOccurrence(anchor, root.intervalInDays, policy.cutoffAt),
        anchor,
        source
      );
    }
    const occurrence = await tx.publicationOccurrence.findUniqueOrThrow({
      where: { id: rootId },
    });
    if (
      await tx.publicationEvidence.findFirst({
        where: {
          organizationId: root.organizationId,
          occurrenceId: rootId,
          origin: 'manual',
          confirmedById: { not: null },
        },
      })
    )
      return null;
    if (
      occurrence.outcome !== 'PENDING' ||
      occurrence.attemptState !== 'UNATTEMPTED' ||
      (await tx.automationRecoveryDecision.findFirst({
        where: {
          subjectKey: `occurrence:${rootId}`,
          action: { in: ['EXPIRE', 'HOLD_UNCERTAIN'] },
        },
      }))
    )
      return null;
    const snapshot = { integrationId: root.integrationId, members };
    const intent = await tx.publicationScheduleIntent.upsert({
      where: { occurrenceId: rootId },
      create: {
        occurrenceId: rootId,
        organizationId: root.organizationId,
        workflowId: `publication-${rootId}`,
        generation: policy.generation,
        snapshot,
        source,
        seriesAnchor: root.intervalInDays ? anchor : null,
        intervalDays: root.intervalInDays,
      },
      update: {},
    });
    const fingerprint = (value: { integrationId: string; members: Member[] }) =>
      recoveryKey(
        value.integrationId,
        JSON.stringify(
          value.members.map((m) => [
            m.id,
            m.group,
            m.publishDate,
            m.scheduleRevision,
            m.scheduledAt,
          ])
        )
      );
    if (
      intent.generation !== policy.generation ||
      fingerprint(intent.snapshot as unknown as typeof snapshot) !==
        fingerprint(snapshot)
    ) {
      throw new RecoveryHold('SCHEDULE_ADMISSION_CHANGED');
    }
    return this.descriptor(intent, slot, root.integration.providerIdentifier);
  }

  /** Application-only DB staging; this method never calls Temporal. */
  async prepareRecoverySlot(
    tx: Prisma.TransactionClient,
    policy: { runId: string; cutoffAt: Date; generation: number },
    organizationId: string,
    postId: string,
    slot: Date,
    anchor: Date
  ) {
    const root = await tx.post.findFirstOrThrow({
      where: { id: postId, organizationId },
      include: { integration: true, organization: true },
    });
    const later = !!root.intervalInDays && +slot !== +root.publishDate;
    if (
      (root.state !== 'QUEUE' && !(later && root.state === 'PUBLISHED')) ||
      root.parentPostId ||
      root.deletedAt ||
      root.adminPausedAt ||
      (!later && (root.releaseId || root.releaseURL || root.youtubeVideoId)) ||
      root.organization.suspendedAt ||
      root.organization.deletionRequestedAt ||
      root.integration.organizationId !== organizationId ||
      root.integration.deletedAt ||
      root.integration.disabled ||
      root.integration.refreshNeeded ||
      root.integration.inBetweenSteps
    )
      throw new RecoveryHold('RECOVERY_FUTURE_UNAVAILABLE');
    if (+slot < +policy.cutoffAt)
      throw new RecoveryHold('RECOVERY_FUTURE_BEFORE_CUTOFF');
    if (
      !later &&
      (await tx.automationEffectAttempt.findFirst({
        where: { postId, phase: { in: ['CLAIMED', 'UNCERTAIN'] } },
      }))
    )
      throw new RecoveryHold('REMOTE_EFFECT_UNCONFIRMED');
    if (
      root.intervalInDays &&
      +nextFixedOccurrence(anchor, root.intervalInDays, slot) !== +slot
    )
      throw new RecoveryHold('RECURRENCE_ANCHOR_UNRESOLVED');
    const previous = await tx.publicationOccurrence.findUnique({
      where: {
        organizationId_postId_scheduleRevision_scheduledAt: {
          organizationId,
          postId,
          scheduleRevision: root.scheduleRevision,
          scheduledAt: slot,
        },
      },
    });
    const members = await this.members(tx, root, slot),
      reviewedIds: Record<string, string> = {};
    for (const member of members) {
      const existing = await tx.publicationOccurrence.findUnique({
        where: {
          organizationId_postId_scheduleRevision_scheduledAt: {
            organizationId,
            postId: member.id,
            scheduleRevision: member.scheduleRevision,
            scheduledAt: new Date(member.scheduledAt),
          },
        },
      });
      if (existing) reviewedIds[member.id] = existing.id;
    }
    if (previous) {
      const intent = await tx.publicationScheduleIntent.findUnique({
        where: { occurrenceId: previous.id },
      });
      if (intent) {
        const frozen = intent.snapshot as any;
        if (
          frozen.integrationId !== root.integrationId ||
          !Array.isArray(frozen.members) ||
          frozen.members.length !== members.length ||
          members.some(
            (m) =>
              !frozen.members.some(
                (f: any) =>
                  f.id === m.id &&
                  f.group === m.group &&
                  f.scheduleRevision === m.scheduleRevision &&
                  f.publishDate === m.publishDate &&
                  f.scheduledAt === m.scheduledAt
              )
          )
        )
          throw new RecoveryHold('RECOVERY_INTENT_CHANGED');
        await tx.publicationScheduleIntent.update({
          where: { occurrenceId: previous.id },
          data: {
            generation: policy.generation,
            workflowId: `publication-${previous.id}`,
            snapshot: {
              ...frozen,
              members: frozen.members.map((m: any) => ({
                ...m,
                ...(reviewedIds[m.id]
                  ? { occurrenceId: reviewedIds[m.id] }
                  : {}),
              })),
            },
          },
        });
      }
    }
    return this.stage(
      tx,
      policy,
      root,
      slot,
      anchor,
      'APPROVED_RECOVERY',
      reviewedIds
    );
  }

  async stagePost(
    organizationId: string,
    postId: string
  ): Promise<ScheduleDescriptor | null> {
    return this.recovery.withOpenPolicy(async (tx, policy) => {
      await tx.$queryRaw`SELECT id FROM "Post" WHERE id=${postId} AND "organizationId"=${organizationId} FOR UPDATE`;
      const root = await tx.post.findFirst({
        where: { id: postId, organizationId, deletedAt: null },
        include: { integration: true, organization: true },
      });
      if (
        !root ||
        root.parentPostId ||
        root.adminPausedAt ||
        root.organization.suspendedAt ||
        root.organization.deletionRequestedAt ||
        root.integration.organizationId !== organizationId ||
        root.integration.disabled ||
        root.integration.deletedAt ||
        root.integration.refreshNeeded ||
        root.integration.inBetweenSteps
      )
        throw new RecoveryHold('PUBLICATION_UNAVAILABLE');
      if (root.state !== 'QUEUE') return null;
      const settings = JSON.parse(root.settings || '{}');
      if (
        !this.derived &&
        (Object.keys(settings).some((k) => k.includes('plug-')) ||
          (await tx.plugs.findFirst({
            where: {
              organizationId,
              integrationId: root.integrationId,
              activated: true,
            },
            select: { id: true },
          })))
      )
        throw new RecoveryHold('DERIVED_SERVICE_UNAVAILABLE');
      // A mutable legacy Post row cannot prove its historical slot or anchor.
      if (root.scheduleRevision < 1)
        throw new RecoveryHold('LEGACY_INVENTORY_REQUIRED');
      if (root.releaseId || root.releaseURL || root.youtubeVideoId)
        throw new RecoveryHold('PUBLICATION_HAS_REMOTE_EVIDENCE');
      if (
        await tx.automationEffectAttempt.findFirst({
          where: {
            organizationId,
            postId,
            phase: { in: ['CLAIMED', 'UNCERTAIN'] },
          },
        })
      )
        throw new RecoveryHold('REMOTE_EFFECT_UNCONFIRMED');
      if (root.intervalInDays !== null)
        nextFixedOccurrence(
          root.publishDate,
          root.intervalInDays,
          policy.cutoffAt
        );
      return this.stage(
        tx,
        policy,
        root,
        root.publishDate,
        root.publishDate,
        'USER_REVISION'
      );
    });
  }

  async enqueue(descriptor: ScheduleDescriptor) {
    // Recheck admission before a producer touches Temporal. An accepted start
    // with a lost response uses the same id and rejects duplicate closed runs.
    await this.recovery.withOpenPolicy(async (tx, policy) => {
      const intent = await tx.publicationScheduleIntent.findUnique({
        where: { occurrenceId: descriptor.occurrenceId },
      });
      const slot = await tx.publicationOccurrence.findUnique({
        where: { id: descriptor.occurrenceId },
      });
      if (
        !intent ||
        !slot ||
        intent.organizationId !== descriptor.organizationId ||
        intent.workflowId !== descriptor.workflowId ||
        intent.generation !== policy.generation ||
        +slot.scheduledAt < +policy.cutoffAt ||
        slot.outcome !== 'PENDING'
      )
        throw new RecoveryHold('SCHEDULE_ADMISSION_CHANGED');
    });
    await this.temporal.client
      .getRawClient()
      .workflow.start('postWorkflowV106', {
        workflowId: descriptor.workflowId,
        taskQueue: 'main',
        args: [descriptor],
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      })
      .catch(async (error) => {
        try {
          await this.temporal.client
            .getRawClient()
            .workflow.getHandle(descriptor.workflowId)
            .describe();
          return;
        } catch {
          throw error;
        }
      });
  }

  async schedulePost(organizationId: string, postId: string) {
    try {
      const descriptor = await this.stagePost(organizationId, postId);
      if (descriptor) await this.enqueue(descriptor);
      return descriptor;
    } catch (error) {
      if (error instanceof RecoveryHold)
        return { held: true, reason: error.reason };
      throw error;
    }
  }

  async rootPostId(descriptor: ScheduleDescriptor) {
    const occurrence = await this.prisma.publicationOccurrence.findFirst({
      where: {
        id: descriptor.occurrenceId,
        organizationId: descriptor.organizationId,
      },
    });
    if (!occurrence) throw new RecoveryHold('OCCURRENCE_UNRESOLVED');
    return occurrence.postId;
  }

  async derivedPlan(organizationId: string, rootOccurrenceId: string) {
    const rows = await this.prisma.publicationDerivedAction.findMany({
      where: { organizationId, rootOccurrenceId },
      select: { id: true, schedule: true },
      orderBy: { id: 'asc' },
    });
    if (rows.length && !this.derived)
      throw new RecoveryHold('DERIVED_SERVICE_UNAVAILABLE');
    return rows.map((row) => ({
      id: row.id,
      checks: row.schedule as unknown as {
        index: number;
        scheduledAt: string;
      }[],
    }));
  }

  async reconcile() {
    // No two-day cutoff: paused/legacy rows remain stored and are never revived.
    let cursor: string | undefined;
    for (;;) {
      const posts = await this.prisma.post.findMany({
        where: {
          parentPostId: null,
          deletedAt: null,
          state: 'QUEUE',
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, organizationId: true },
        orderBy: { id: 'asc' },
        take: 100,
      });
      if (!posts.length) return;
      for (const post of posts)
        await this.schedulePost(post.organizationId, post.id);
      cursor = posts[posts.length - 1].id;
    }
  }

  async bind(
    context: RecoveryWorkflowContext,
    descriptor: ScheduleDescriptor,
    postId: string,
    parentRemoteId?: string
  ) {
    return this.recovery.withOpenPolicy(async (tx, policy) => {
      const intent = await tx.publicationScheduleIntent.findUnique({
        where: { occurrenceId: descriptor.occurrenceId },
      });
      if (
        !intent ||
        context.protocolVersion !== 1 ||
        intent.workflowId !== context.workflowId ||
        intent.workflowId !== descriptor.workflowId ||
        intent.organizationId !== descriptor.organizationId ||
        intent.generation !== policy.generation
      )
        throw new RecoveryHold('SCHEDULE_ADMISSION_CHANGED');
      const snapshot = intent.snapshot as unknown as {
        integrationId: string;
        members: Member[];
      };
      const member = snapshot.members.find((m) => m.id === postId);
      const root = await tx.publicationOccurrence.findUniqueOrThrow({
        where: { id: intent.occurrenceId },
      });
      if (!member || +root.scheduledAt !== +new Date(descriptor.scheduledAt))
        throw new RecoveryHold('SCHEDULE_ADMISSION_CHANGED');
      const id =
        member.occurrenceId ||
        (member.id === root.postId
          ? root.id
          : recoveryKey(
              'publication-slot',
              intent.organizationId,
              member.id,
              member.scheduleRevision,
              member.scheduledAt
            ));
      const post = await tx.post.findFirstOrThrow({
        where: { id: member.id, organizationId: intent.organizationId },
        include: { integration: true },
      });
      if (
        post.group !== member.group ||
        post.scheduleRevision !== member.scheduleRevision ||
        +post.publishDate !== +new Date(member.publishDate)
      )
        throw new RecoveryHold('SCHEDULE_REVISION_CHANGED');
      const isRoot = member.id === root.postId;
      if (!isRoot) {
        const parent = await tx.automationEffectAttempt.findFirst({
          where: {
            occurrenceId: root.id,
            phase: 'CONFIRMED',
            remoteId: parentRemoteId || '__missing__',
          },
        });
        const manual = await tx.publicationEvidence.findFirst({
          where: {
            organizationId: intent.organizationId,
            occurrenceId: root.id,
            origin: 'manual',
            confirmedById: { not: null },
            remoteId: parentRemoteId || '__missing__',
          },
        });
        if (!parent && !manual)
          throw new RecoveryHold('PARENT_CONFIRMATION_REQUIRED');
      }
      const input = {
        ...context,
        organizationId: intent.organizationId,
        integrationId: snapshot.integrationId,
        snapshots: [{ ...member, publishDate: new Date(member.publishDate) }],
        plannedAt: new Date(member.scheduledAt),
        actionKey: `${isRoot ? 'publication' : 'comment'}:${postId}`,
        ...(isRoot ? {} : { parentRemoteId }),
      };
      const hash = publicationRequestHash(input);
      const binding = await tx.automationWorkflowBinding.upsert({
        where: {
          workflowId_runId_actionKey: {
            workflowId: context.workflowId,
            runId: context.runId,
            actionKey: input.actionKey,
          },
        },
        create: {
          organizationId: intent.organizationId,
          workflowId: context.workflowId,
          runId: context.runId,
          occurrenceId: id,
          actionKey: input.actionKey,
          expectedRequestHash: hash,
        },
        update: {},
      });
      if (binding.occurrenceId !== id || binding.expectedRequestHash !== hash)
        throw new RecoveryHold('EFFECT_REQUEST_CHANGED');
      return {
        input,
        post,
        integration: post.integration,
        members: snapshot.members,
      };
    });
  }

  async next(
    context: RecoveryWorkflowContext,
    descriptor: ScheduleDescriptor
  ): Promise<ScheduleDescriptor | null> {
    return this.recovery.withOpenPolicy(async (tx, policy) => {
      const intent = await tx.publicationScheduleIntent.findUnique({
        where: { occurrenceId: descriptor.occurrenceId },
      });
      if (
        !intent ||
        intent.workflowId !== context.workflowId ||
        context.protocolVersion !== 1 ||
        intent.generation !== policy.generation
      )
        throw new RecoveryHold('SCHEDULE_ADMISSION_CHANGED');
      if (!intent.intervalDays) return null;
      if (!intent.seriesAnchor)
        throw new RecoveryHold('RECURRENCE_ANCHOR_UNRESOLVED');
      const occurrence = await tx.publicationOccurrence.findUniqueOrThrow({
        where: { id: intent.occurrenceId },
      });
      const root = await tx.post.findFirst({
        where: {
          id: occurrence.postId,
          organizationId: intent.organizationId,
          deletedAt: null,
        },
        include: { integration: true },
      });
      if (
        !root ||
        root.scheduleRevision !== occurrence.scheduleRevision ||
        root.group !== occurrence.groupSnapshot ||
        root.adminPausedAt ||
        !['QUEUE', 'PUBLISHED'].includes(root.state)
      )
        throw new RecoveryHold('SCHEDULE_REVISION_CHANGED');
      const afterThisSlot = new Date(
        +occurrence.scheduledAt + intent.intervalDays * 86_400_000
      );
      const next = nextFixedOccurrence(
        intent.seriesAnchor,
        intent.intervalDays,
        new Date(Math.max(+policy.cutoffAt, +afterThisSlot))
      );
      return this.stage(
        tx,
        policy,
        root,
        next,
        intent.seriesAnchor,
        intent.source
      );
    });
  }

  async assertSimpleStatusChange(organizationId: string, postId: string) {
    const post = await this.prisma.post.findFirstOrThrow({
      where: { id: postId, organizationId },
    });
    const occurrences = await this.prisma.publicationOccurrence.findMany({
      where: {
        organizationId,
        postId,
        scheduleRevision: post.scheduleRevision,
      },
      select: { outcome: true },
    });
    if (
      post.state === 'ERROR' ||
      post.releaseId ||
      post.releaseURL ||
      occurrences.some((o) => o.outcome !== 'PENDING') ||
      (await this.prisma.automationEffectAttempt.findFirst({
        where: { organizationId, postId },
      }))
    ) {
      throw new ConflictException(
        'Revise e reagende explicitamente. Alterar o estado não autoriza uma nova tentativa.'
      );
    }
  }
}
