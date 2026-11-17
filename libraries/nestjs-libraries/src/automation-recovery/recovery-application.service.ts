import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma/prisma.service';
import { PublicationSchedulingService } from './publication-scheduling.service';
import {
  classifyRecoveryInventory,
  inventoryHash,
  RecoveryInventory,
  uncertainLegacySlot,
} from './recovery-inventory';
import { readRecoveryDatabaseTx } from './recovery-inventory-source';
import {
  approvedContract,
  authorityHash,
  json,
  manifestContent,
  verifyApproval,
} from './recovery-approval';
import {
  PublicationEffectContext,
  publicationRequestHash,
  RECOVERY_EXPIRED_MESSAGE,
  RecoveryHold,
} from './recovery-policy';

export type RecoveryPlanItem = {
  ordinal: number;
  mode: 'APPLY' | 'RETAIN';
  bindings?: PublicationEffectContext[];
  future?: { scheduledAt: string; anchor: string };
};
export const databaseInventoryHash = (tables: Record<string, any[]>) =>
  inventoryHash(
    Object.fromEntries(
      Object.entries(tables).filter(([key]) => key !== 'recoveryControl')
    )
  );

/** Bind the applicator as well as the independently built worker artifact. */
export const applicationArtifactHash = () =>
  inventoryHash(
    [
      'recovery-application.service',
      'recovery-approval',
      'recovery-policy',
      'recovery-inventory',
      'recovery-inventory-source',
      'publication-scheduling.service',
      'derived-publication.service',
    ].map((module) => ({
      module,
      hash: inventoryHash(readFileSync(require.resolve('./' + module))),
    }))
  );

const assertApplicationArtifact = (payload: any) => {
  if (payload.applicationDigest !== applicationArtifactHash())
    throw new RecoveryHold('APPLICATION_ARTIFACT_CHANGED');
};

@Injectable()
export class RecoveryApplicationService {
  constructor(
    private prisma: PrismaService,
    private scheduling: PublicationSchedulingService
  ) {}

  private async locked(tx: any, userId: string) {
    await tx.$queryRaw`SELECT id FROM "AutomationRecoveryControl" WHERE id='global' FOR UPDATE`;
    const c = await tx.automationRecoveryControl.findUnique({
        where: { id: 'global' },
      }),
      u = await tx.user.findUnique({ where: { id: userId } });
    if (!c || c.phase === 'OPEN')
      throw new RecoveryHold('APPLICATION_REQUIRES_CONTAINMENT');
    if (!u?.activated || u.disabledAt || !u.isSuperAdmin)
      throw new RecoveryHold('RECOVERY_OPERATOR_UNAUTHORIZED');
    return c;
  }
  private transaction<T>(work: (tx: any) => Promise<T>) {
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 120000,
      maxWait: 10000,
    });
  }

  /** Signature creation is deliberately outside the application. No private key here. */
  async approve(
    userId: string,
    payload: any,
    signature: string,
    source: RecoveryInventory,
    plan: RecoveryPlanItem[]
  ) {
    verifyApproval(payload, signature, 'RECOVERY_APPROVAL');
    assertApplicationArtifact(payload);
    return this.transaction(async (tx) => {
      const control = await this.locked(tx, userId);
      const previous = await tx.recoveryAuthorization.aggregate({
        where: { id: { not: payload.authorizationId } },
        _max: { generation: true },
      });
      const m = await tx.recoveryManifest.findUniqueOrThrow({
        where: { id: payload.manifestId },
        include: { items: { orderBy: { ordinal: 'asc' } } },
      });
      const items = manifestContent(m);
      if (
        payload.approvedById !== userId ||
        payload.inventoryHash !== inventoryHash(source) ||
        payload.inventoryHash !== m.sourceHash ||
        payload.planHash !== inventoryHash(plan) ||
        plan.length !== items.length ||
        plan.some(
          (p, i) => p.ordinal !== i || !['APPLY', 'RETAIN'].includes(p.mode)
        ) ||
        !Number.isSafeInteger(payload.generation) ||
        payload.generation !==
          Math.max(control.generation, previous._max.generation || 0) + 1 ||
        source.warnings.length ||
        source.queues.some((q) => q.pollers?.length)
      )
        throw new RecoveryHold('APPROVAL_SOURCE_OR_GENERATION_CHANGED');
      const tables = await readRecoveryDatabaseTx(tx, m.scope as string[]);
      if (
        databaseInventoryHash(tables) !== databaseInventoryHash(source.tables)
      )
        throw new RecoveryHold('DATABASE_INVENTORY_CHANGED');
      const row = await tx.recoveryAuthorization.upsert({
        where: { id: payload.authorizationId },
        create: {
          id: payload.authorizationId,
          manifestId: m.id,
          generation: payload.generation,
          approval: json(payload),
          approvalSignature: signature,
          authorityHash: authorityHash(),
          plan: json(plan),
          source: json(source),
          expectedDbHash: databaseInventoryHash(tables),
          resultHash: inventoryHash({ approval: payload, signature }),
          approvedById: userId,
        },
        update: {},
      });
      if (
        inventoryHash(row.approval) !== inventoryHash(payload) ||
        row.approvalSignature !== signature
      )
        throw new RecoveryHold('APPROVAL_ID_REUSED');
      await approvedContract(tx, row.id);
      return {
        authorizationId: row.id,
        phase: row.phase,
        consumptionOpened: false,
      };
    });
  }

  async applyBatch(
    userId: string,
    id: string,
    batchSize = 100,
    beforeCommit?: () => Promise<void>,
    afterCommit?: () => Promise<void>
  ) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500)
      throw new RecoveryHold('INVALID_APPLICATION_BATCH');
    const result = await this.transaction(async (tx) => {
      const control = await this.locked(tx, userId),
        { a, m, p } = await approvedContract(tx, id);
      assertApplicationArtifact(p);
      const latest = await tx.recoveryAuthorization.aggregate({
        _max: { generation: true },
      });
      if (
        a.approvedById !== userId ||
        control.generation >= a.generation ||
        latest._max.generation !== a.generation
      )
        throw new RecoveryHold('APPLICATION_GENERATION_CHANGED');
      if (!['APPROVED', 'APPLYING', 'APPLIED'].includes(a.phase))
        throw new RecoveryHold('APPLICATION_PHASE_CHANGED');
      const before = await readRecoveryDatabaseTx(tx, m.scope as string[]);
      if (databaseInventoryHash(before) !== a.expectedDbHash)
        throw new RecoveryHold('APPLICATION_SOURCE_CHANGED');
      if (a.phase === 'APPLIED')
        return { cursor: a.cursor, complete: true, resultHash: a.resultHash };
      let chain = a.resultHash;
      const end = Math.min(m.itemCount, a.cursor + batchSize),
        plan = a.plan as RecoveryPlanItem[];
      for (let i = a.cursor; i < end; i++) {
        const item = m.items[i],
          op = plan[i];
        const result = await this.applyItem(tx, a, m, item, op);
        const next = inventoryHash({
          previous: chain,
          ordinal: i,
          fingerprint: item.fingerprint,
          result,
        });
        await tx.recoveryApplicationItem.create({
          data: {
            authorizationId: id,
            ordinal: i,
            fingerprint: item.fingerprint,
            result: json(result),
            previousHash: chain,
            resultHash: next,
          },
        });
        chain = next;
      }
      const tables = await readRecoveryDatabaseTx(tx, m.scope as string[]);
      await tx.recoveryAuthorization.update({
        where: { id },
        data: {
          cursor: end,
          resultHash: chain,
          expectedDbHash: databaseInventoryHash(tables),
          phase: end === m.itemCount ? 'APPLIED' : 'APPLYING',
        },
      });
      if (beforeCommit) await beforeCommit();
      assertApplicationArtifact(p);
      return { cursor: end, complete: end === m.itemCount, resultHash: chain };
    });
    if (afterCommit) await afterCommit();
    return result;
  }

  private async applyItem(
    tx: any,
    a: any,
    m: any,
    item: any,
    op: RecoveryPlanItem
  ) {
    const meta = item.metadata,
      scope = m.scope as string[];
    if (item.organizationId && !scope.includes(item.organizationId))
      throw new RecoveryHold('APPLICATION_TENANT_MISMATCH');
    const decision = async (
      subjectKey: string,
      action: string,
      reason: string
    ) => {
      if (!item.organizationId)
        throw new RecoveryHold('APPLICATION_ORGANIZATION_UNRESOLVED');
      await tx.automationRecoveryDecision.upsert({
        where: { subjectKey_action: { subjectKey, action } },
        create: {
          recoveryId: m.recoveryId,
          organizationId: item.organizationId,
          subjectKey,
          action,
          reason,
        },
        update: {},
      });
    };
    const retainWorkflow = async () => {
      if (item.subjectKey.startsWith('workflow:'))
        await tx.automationRecoveryDecision.upsert({
          where: {
            subjectKey_action: {
              subjectKey: item.subjectKey,
              action: 'HOLD_WORKFLOW',
            },
          },
          create: {
            recoveryId: m.recoveryId,
            organizationId: item.organizationId || '__unresolved__',
            subjectKey: item.subjectKey,
            action: 'HOLD_WORKFLOW',
            reason: 'APPROVED_MANIFEST_RETENTION',
          },
          update: {},
        });
    };
    if (op.mode === 'RETAIN') {
      await retainWorkflow();
      return { outcome: 'RETAINED', reason: 'OPERATOR_RETAINED' };
    }
    if (item.subjectKey.startsWith('occurrence:')) {
      const o = await tx.publicationOccurrence.findUniqueOrThrow({
        where: { id: meta.occurrenceId },
      });
      if (item.decision === 'EXPIRE') {
        const attempted = await tx.automationEffectAttempt.count({
            where: { occurrenceId: o.id },
          }),
          manual = await tx.publicationEvidence.count({
            where: { occurrenceId: o.id },
          });
        if (attempted || manual || o.remoteId || o.outcome === 'CONFIRMED')
          throw new RecoveryHold('EXPIRY_HAS_REMOTE_EVIDENCE');
        if (+o.scheduledAt >= +m.cutoffAt)
          throw new RecoveryHold('EXPIRY_CUTOFF_MISMATCH');
        await decision(item.subjectKey, 'EXPIRE', 'PUBLICATION_BEFORE_T0');
        await tx.publicationOccurrence.updateMany({
          where: { id: o.id, outcome: 'PENDING', attemptState: 'UNATTEMPTED' },
          data: { outcome: 'EXPIRED', failureReason: 'PUBLICATION_BEFORE_T0' },
        });
        await tx.post.updateMany({
          where: {
            id: o.postId,
            organizationId: o.organizationId,
            group: o.groupSnapshot,
            scheduleRevision: o.scheduleRevision,
            publishDate: o.scheduledAt,
            intervalInDays: null,
            state: 'QUEUE',
            releaseId: null,
            releaseURL: null,
            youtubeVideoId: null,
            adminPausedAt: null,
            deletedAt: null,
          },
          data: { state: 'ERROR', error: RECOVERY_EXPIRED_MESSAGE },
        });
      } else if (item.reason === 'REMOTE_OUTCOME_UNCONFIRMED')
        await decision(item.subjectKey, 'HOLD_UNCERTAIN', item.reason);
      else if (item.decision === 'PRESERVE_FUTURE')
        await tx.publicationScheduleIntent.updateMany({
          where: { occurrenceId: o.id },
          data: { generation: a.generation },
        });
    } else if (
      item.subjectKey.startsWith('derived:') &&
      item.decision === 'EXPIRE'
    ) {
      if (+new Date(meta.scheduledAt) >= +m.cutoffAt)
        throw new RecoveryHold('DERIVED_EXPIRY_CUTOFF_MISMATCH');
      const check = Number(item.subjectKey.split(':').at(-1));
      await decision(
        `derived:${meta.actionId}`,
        `EXPIRE_CHECK:${check}`,
        'DERIVED_BEFORE_T0'
      );
    } else if (
      item.subjectKey.startsWith('comment:') &&
      item.decision === 'SUPPRESS_PENDING'
    ) {
      const event = await tx.instagramWebhookEvent.findUniqueOrThrow({
        where: { id: meta.eventId },
        include: { automationExecution: true },
      });
      await decision(item.subjectKey, 'EXPIRE', 'COMMENT_BEFORE_T0');
      const execution = event.automationExecution;
      if (execution)
        for (const side of ['public', 'private']) {
          const key = side + 'ReplyStatus';
          if (execution[key] !== 'PENDING') continue;
          const attempt = await tx.automationEffectAttempt.findFirst({
            where: {
              subjectKey: item.subjectKey,
              actionKey: `instagram:${side}`,
            },
          });
          const confirmed =
            attempt?.phase === 'CONFIRMED' &&
            typeof attempt.receipt === 'string';
          await tx.instagramCommentAutomationExecution.update({
            where: { id: execution.id },
            data: {
              [key]: confirmed ? 'SUCCESS' : attempt ? 'FAILED' : 'SKIPPED',
              [side + 'ReplyError']: confirmed
                ? null
                : attempt
                ? 'REMOTE_UNCONFIRMED'
                : 'COMMENT_BEFORE_T0',
              ...(confirmed ? { [side + 'ReplyId']: attempt.receipt } : {}),
            },
          });
        }
      const final =
        execution &&
        (await tx.instagramCommentAutomationExecution.findUnique({
          where: { id: execution.id },
        }));
      const statuses = final
        ? [final.publicReplyStatus, final.privateReplyStatus]
        : [];
      await tx.instagramWebhookEvent.update({
        where: { id: event.id },
        data: {
          recoverySkipReason: event.recoverySkipReason || 'COMMENT_BEFORE_T0',
          ...(execution
            ? {
                status: statuses.includes('FAILED')
                  ? 'FAILED'
                  : statuses.includes('SUCCESS')
                  ? 'REPLIED'
                  : 'SKIPPED',
              }
            : ['RECEIVED', 'PROCESSING'].includes(event.status)
            ? { status: 'SKIPPED' }
            : {}),
        },
      });
    }
    if (op.bindings?.length) {
      if (!item.subjectKey.startsWith('workflow:'))
        throw new RecoveryHold('BINDING_REVIEW_REQUIRED');
      for (const b of op.bindings) {
        if (
          uncertainLegacySlot(
            a.source as RecoveryInventory,
            b.snapshots[0]?.id,
            new Date(b.plannedAt)
          )
        )
          throw new RecoveryHold('LEGACY_REMOTE_OUTCOME_UNCONFIRMED');
        if (
          b.workflowId !== meta.workflowId ||
          b.runId !== meta.runId ||
          b.organizationId !== item.organizationId ||
          b.protocolVersion !== 1 ||
          !/^publication:|^comment:/.test(b.actionKey)
        )
          throw new RecoveryHold('BINDING_SCOPE_CHANGED');
        const occurrence = (
          a.source as RecoveryInventory
        ).tables.publicationOccurrence.find(
          (o) =>
            o.postId === b.snapshots[0]?.id &&
            o.organizationId === b.organizationId &&
            +new Date(o.scheduledAt) === +new Date(b.plannedAt)
        );
        const expectedRequestHash = publicationRequestHash(b);
        if (
          ![
            'publication:' + b.snapshots[0]?.id,
            'comment:' + b.snapshots[0]?.id,
          ].includes(b.actionKey)
        )
          throw new RecoveryHold('BINDING_ACTION_CHANGED');
        const reviewed = (
          a.source as RecoveryInventory
        ).tables.automationWorkflowBinding.some(
          (row) =>
            row.workflowId === b.workflowId &&
            row.runId === b.runId &&
            row.organizationId === b.organizationId &&
            row.occurrenceId === occurrence?.id &&
            row.actionKey === b.actionKey &&
            row.expectedRequestHash === expectedRequestHash
        );
        if (
          !occurrence ||
          !b.snapshots.length ||
          (!reviewed &&
            b.snapshots.some(
              (s) =>
                !meta.snapshots.some(
                  (h) =>
                    h.id === s.id &&
                    h.group === s.group &&
                    h.scheduleRevision === s.scheduleRevision &&
                    +new Date(h.publishDate) === +new Date(s.publishDate)
                )
            ))
        )
          throw new RecoveryHold('LEGACY_HISTORY_PROOF_REQUIRED');
        if (b.actionKey.startsWith('comment:') && !b.parentRemoteId)
          throw new RecoveryHold('LEGACY_PARENT_PROOF_REQUIRED');
        const row = await tx.automationWorkflowBinding.upsert({
          where: {
            workflowId_runId_actionKey: {
              workflowId: b.workflowId,
              runId: b.runId,
              actionKey: b.actionKey,
            },
          },
          create: {
            workflowId: b.workflowId,
            runId: b.runId,
            actionKey: b.actionKey,
            organizationId: b.organizationId,
            occurrenceId: occurrence.id,
            expectedRequestHash,
          },
          update: {},
        });
        if (
          row.expectedRequestHash !== expectedRequestHash ||
          row.occurrenceId !== occurrence.id ||
          row.organizationId !== b.organizationId
        )
          throw new RecoveryHold('LEGACY_BINDING_CHANGED');
      }
    }
    let descriptor: any = null,
      priorIntent: any = null;
    if (op.future) {
      if (!item.postId || !/^(post|series|occurrence):/.test(item.subjectKey))
        throw new RecoveryHold('FUTURE_REVIEW_REQUIRED');
      const at = new Date(op.future.scheduledAt),
        anchor = new Date(op.future.anchor),
        source = (a.source as RecoveryInventory).tables.post.find(
          (p) => p.id === item.postId
        );
      if (uncertainLegacySlot(a.source as RecoveryInventory, item.postId, at))
        throw new RecoveryHold('LEGACY_REMOTE_OUTCOME_UNCONFIRMED');
      if (
        !source ||
        +at < +m.cutoffAt ||
        !Number.isFinite(+at) ||
        !Number.isFinite(+anchor) ||
        (item.subjectKey.startsWith('post:') &&
          (+at !== +new Date(source.publishDate) || +anchor !== +at)) ||
        (item.subjectKey.startsWith('series:') &&
          (meta.nextScheduledAt !== at.toISOString() ||
            meta.anchor !== anchor.toISOString())) ||
        (item.subjectKey.startsWith('occurrence:') &&
          (item.decision !== 'PRESERVE_FUTURE' ||
            +new Date(meta.scheduledAt) !== +at ||
            (!source.intervalInDays && +anchor !== +at) ||
            (!!source.intervalInDays &&
              !(
                a.source as RecoveryInventory
              ).tables.publicationScheduleIntent.some(
                (i) =>
                  i.occurrenceId === meta.occurrenceId &&
                  +new Date(i.seriesAnchor) === +anchor
              ))))
      )
        throw new RecoveryHold('FUTURE_SLOT_UNPROVEN');
      const existing = await tx.publicationOccurrence.findUnique({
        where: {
          organizationId_postId_scheduleRevision_scheduledAt: {
            organizationId: item.organizationId,
            postId: item.postId,
            scheduleRevision: source.scheduleRevision,
            scheduledAt: at,
          },
        },
      });
      const intent =
        existing &&
        (await tx.publicationScheduleIntent.findUnique({
          where: { occurrenceId: existing.id },
        }));
      if (intent) {
        const { snapshot, ...metadata } = intent;
        priorIntent = { ...metadata, snapshotHash: inventoryHash(snapshot) };
      }
      descriptor = await this.scheduling.prepareRecoverySlot(
        tx,
        { runId: m.recoveryId, cutoffAt: m.cutoffAt, generation: a.generation },
        item.organizationId,
        item.postId,
        at,
        anchor
      );
    }
    const retained =
      ['RETAIN', 'REVIEW_BINDINGS'].includes(item.decision) &&
      !op.bindings?.length &&
      !op.future;
    if (retained) await retainWorkflow();
    return {
      outcome: retained ? 'RETAINED' : 'APPLIED',
      decision: item.decision,
      bindings: op.bindings?.length || 0,
      descriptor,
      priorIntent,
    };
  }

  /** Last revalidation requires a fresh complete read-only capture, then admission signature. */
  async admit(
    userId: string,
    id: string,
    payload: any,
    signature: string,
    fresh: RecoveryInventory
  ) {
    verifyApproval(payload, signature, 'WORKER_ADMISSION');
    return this.transaction(async (tx) => {
      const control = await this.locked(tx, userId),
        { a, m, p } = await approvedContract(tx, id, true);
      assertApplicationArtifact(p);
      const tables = await readRecoveryDatabaseTx(tx, m.scope as string[]);
      const temporalHash = (v: RecoveryInventory) =>
        inventoryHash({
          workflows: v.workflows,
          queues: v.queues,
          warnings: v.warnings,
        });
      const latest = await tx.recoveryAuthorization.aggregate({
        _max: { generation: true },
      });
      if (
        a.approvedById !== userId ||
        a.phase !== 'APPLIED' ||
        control.generation >= a.generation ||
        latest._max.generation !== a.generation ||
        inventoryHash(fresh.scope) !== inventoryHash(m.scope) ||
        databaseInventoryHash(tables) !== a.expectedDbHash ||
        databaseInventoryHash(fresh.tables) !== a.expectedDbHash ||
        temporalHash(fresh) !== temporalHash(a.source as RecoveryInventory) ||
        fresh.warnings.length ||
        fresh.queues.some((q) => q.pollers?.length) ||
        payload.authorizationId !== id ||
        payload.approvalHash !== inventoryHash(p) ||
        payload.applicationHash !== a.resultHash ||
        payload.expectedDbHash !== a.expectedDbHash ||
        payload.cutoffAt !== p.cutoffAt ||
        payload.generation !== a.generation ||
        payload.sourceDigest !== p.sourceDigest ||
        payload.imageDigest !== p.imageDigest ||
        payload.containmentHash !== p.containmentHash ||
        payload.resumeNotAfter !== p.resumeNotAfter ||
        Date.now() > Date.parse(p.resumeNotAfter) ||
        payload.temporalHash !== temporalHash(fresh) ||
        +m.cutoffAt > Date.now()
      )
        throw new RecoveryHold('ADMISSION_REVALIDATION_CHANGED');
      // Production scope remains unavailable until separately reviewed VPS evidence.
      if (p.scope !== 'ISOLATED_LAB' || payload.scope !== p.scope)
        throw new RecoveryHold('PRODUCTION_ACTIVATION_NOT_RELEASED');
      await tx.recoveryAuthorization.update({
        where: { id },
        data: {
          phase: 'ADMITTED',
          admitted: json(payload),
          admittedSignature: signature,
        },
      });
      await tx.automationRecoveryRun.update({
        where: { id: m.recoveryId },
        data: {
          phase: 'VERIFIED',
          manifestHash: m.manifestHash,
          authorizedById: userId,
          authorizedAt: new Date(),
        },
      });
      await tx.automationRecoveryControl.update({
        where: { id: 'global' },
        data: { runId: m.recoveryId, generation: a.generation, phase: 'OPEN' },
      });
      return { admitted: true, scope: p.scope, workersStarted: false };
    });
  }
}
