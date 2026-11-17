import { createHash } from 'node:crypto';
import { defaultPayloadConverter } from '@temporalio/common';
import {
  RecoveryHold,
  nextFixedOccurrence,
  recoveryKey,
} from './recovery-policy';

export const inventoryHash = (value: unknown): string => {
  const stable = (v: any): any =>
    v instanceof Date
      ? v.toISOString()
      : Buffer.isBuffer(v) || v instanceof Uint8Array
      ? Buffer.from(v).toString('base64')
      : Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .filter((k) => v[k] !== undefined)
            .map((k) => [k, stable(v[k])])
        )
      : v;
  return createHash('sha256')
    .update(value === undefined ? 'undefined' : JSON.stringify(stable(value)))
    .digest('hex');
};
const pick = (v: any, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => v?.[k] !== undefined).map((k) => [k, v[k]])
  );
const number = (v: any) => Number(v?.toString?.() ?? v ?? 0);
const instant = (v: any) =>
  v && Number.isFinite(number(v.seconds))
    ? new Date(
        number(v.seconds) * 1000 + Math.floor(number(v.nanos) / 1e6)
      ).toISOString()
    : null;
const duration = (v: any) => number(v?.seconds) * 1000 + number(v?.nanos) / 1e6;
function decode(payloads: any): any[] {
  try {
    return (payloads?.payloads || []).map((p: any) =>
      defaultPayloadConverter.fromPayload(p)
    );
  } catch {
    return [];
  } // A custom/encrypted payload requires operator review.
}

/** Whitelist projection. Never persists workflow inputs/results or failures. */
export function projectRecoveryHistory(
  workflowId: string,
  runId: string,
  history: any,
  description: any
) {
  const events: any[] = history.events || [],
    start = events[0]?.workflowExecutionStartedEventAttributes;
  if (!start) throw new RecoveryHold('TEMPORAL_HISTORY_INCOMPLETE');
  const input = decode(start.input)[0];
  const scheduled = new Map<string, any>(),
    timers: any[] = [],
    children: any[] = [],
    snapshots: any[] = [],
    receipts: any[] = [];
  for (const event of events) {
    const s = event.activityTaskScheduledEventAttributes;
    if (s)
      scheduled.set(String(event.eventId), {
        eventId: String(event.eventId),
        activityId: s.activityId,
        type: s.activityType?.name,
        taskQueue: s.taskQueue?.name,
        requestHash: inventoryHash(s.input),
        scheduledAt: instant(event.eventTime),
      });
    const done = event.activityTaskCompletedEventAttributes;
    if (done) {
      const activity = scheduled.get(String(done.scheduledEventId)),
        values = decode(done.result);
      if (['getPost', 'getPostsList'].includes(activity?.type))
        for (const v of values.flat())
          if (v?.id)
            snapshots.push({
              ...pick(v, [
                'id',
                'organizationId',
                'integrationId',
                'group',
                'publishDate',
                'scheduleRevision',
                'parentPostId',
                'intervalInDays',
                'delay',
                'state',
              ]),
              integrationId: v.integrationId || v.integration?.id,
              sourceEventId: String(event.eventId),
            });
      if (
        ['postSocial', 'postComment', 'recoveryPublicationDeliver'].includes(
          activity?.type
        )
      )
        for (const v of values.flat())
          if (typeof v?.postId === 'string')
            receipts.push({
              activityEventId: activity.eventId,
              postId: v.id,
              remoteId: v.postId,
              receiptHash: inventoryHash(v),
            });
    }
    const t = event.timerStartedEventAttributes;
    if (t)
      timers.push({
        eventId: String(event.eventId),
        timerId: t.timerId,
        firesAt: new Date(
          +new Date(instant(event.eventTime)!) + duration(t.startToFireTimeout)
        ).toISOString(),
      });
    const child = event.startChildWorkflowExecutionInitiatedEventAttributes;
    if (child)
      children.push({
        eventId: String(event.eventId),
        workflowId: child.workflowId,
        workflowType: child.workflowType?.name,
        parentClosePolicy: number(child.parentClosePolicy),
        inputHash: inventoryHash(child.input),
        ...pick(decode(child.input)[0], [
          'postId',
          'organizationId',
          'postNow',
          'occurrenceId',
          'scheduledAt',
        ]),
      });
  }
  return {
    workflowId,
    runId,
    workflowType: start.workflowType?.name,
    taskQueue: start.taskQueue?.name,
    status: description?.status?.name || 'UNKNOWN',
    lastEventId: String(events.at(-1)?.eventId || 0),
    historyHash: inventoryHash(history),
    input: pick(input, [
      'postId',
      'organizationId',
      'postNow',
      'occurrenceId',
      'rootOccurrenceId',
      'scheduledAt',
    ]),
    parent: description?.parentExecution
      ? pick(description.parentExecution, ['workflowId', 'runId'])
      : null,
    snapshots,
    receipts,
    timers,
    children,
    activities: [...scheduled.values()],
    pendingActivities: (description?.raw?.pendingActivities || []).map(
      (a: any) => ({
        activityId: a.activityId,
        type: a.activityType?.name,
        attempt: a.attempt,
        state: a.state,
        scheduledAt: instant(a.scheduledTime),
        lastStartedAt: instant(a.lastStartedTime),
      })
    ),
  };
}

export type InventoryItem = {
  subjectKey: string;
  organizationId?: string;
  postId?: string;
  decision: string;
  reason: string;
  metadata: any;
};
export type RecoveryInventory = {
  scope: string[];
  tables: Record<string, any[]>;
  workflows: any[];
  queues: any[];
  warnings: string[];
};

/** A pre-ledger activity may have reached the provider. Never infer no effect
 * from an absent v1.7.5 claim. Only a proven different slot excludes it. */
export function uncertainLegacySlot(
  source: RecoveryInventory,
  postId: string,
  at: Date
): boolean {
  for (const w of source.workflows) {
    if (
      !w.pendingActivities?.some(
        (a: any) =>
          /^(postSocial|postComment|processPlug|processInternalPlug|recoveryPublicationDeliver|recoveryDerivedDeliver)$/.test(
            a.type
          ) &&
          (a.lastStartedAt ||
            [
              2,
              3,
              'STARTED',
              'CANCEL_REQUESTED',
              'ACTIVITY_TASK_STATE_STARTED',
              'ACTIVITY_TASK_STATE_CANCEL_REQUESTED',
            ].includes(a.state))
      )
    )
      continue;
    const bindings = (source.tables.automationWorkflowBinding || []).filter(
      (b) => b.workflowId === w.workflowId && b.runId === w.runId
    );
    const slots = bindings
      .map((b) =>
        (source.tables.publicationOccurrence || []).find(
          (o) => o.id === b.occurrenceId && o.postId === postId
        )
      )
      .filter(Boolean);
    if (slots.length && slots.every((o) => +new Date(o.scheduledAt) !== +at))
      continue;
    const snapshots = (w.snapshots || []).filter((s: any) => s.id === postId);
    const root = (source.tables.publicationOccurrence || []).find(
      (o) => o.id === w.input?.rootOccurrenceId
    );
    if (
      w.input?.postId !== postId &&
      !snapshots.length &&
      !slots.length &&
      root?.postId !== postId
    )
      continue;
    const dates = [...new Set(snapshots.map((s: any) => s.publishDate))];
    if (
      !slots.length &&
      w.input?.postNow !== true &&
      dates.length === 1 &&
      Number.isFinite(+new Date(dates[0] as string)) &&
      +new Date(dates[0] as string) !== +at
    )
      continue;
    return true;
  }
  return false;
}

/** Read-only classification. No binding, termination, Post mutation or enqueue. */
export function classifyRecoveryInventory(
  source: RecoveryInventory,
  cutoffAt: Date
): InventoryItem[] {
  if (!Number.isFinite(+cutoffAt))
    throw new RecoveryHold('INVALID_RECOVERY_CUTOFF');
  const t = source.tables,
    items: InventoryItem[] = [],
    add = (v: InventoryItem) => items.push(v);
  const occurrences = t.publicationOccurrence || [],
    attempts = t.automationEffectAttempt || [],
    evidence = t.publicationEvidence || [];
  for (const o of occurrences) {
    const post = (t.post || []).find((p) => p.id === o.postId),
      integration = (t.integration || []).find(
        (i) => i.id === post?.integrationId
      ),
      org = (t.organization || []).find((g) => g.id === o.organizationId);
    const unavailable =
      !post ||
      !integration ||
      !org ||
      post.adminPausedAt ||
      post.deletedAt ||
      ['DRAFT', 'ERROR'].includes(post.state) ||
      org.suspendedAt ||
      org.deletionRequestedAt ||
      integration.organizationId !== o.organizationId ||
      integration.disabled ||
      integration.deletedAt ||
      integration.refreshNeeded ||
      integration.inBetweenSteps ||
      post.scheduleRevision !== o.scheduleRevision ||
      post.group !== o.groupSnapshot;
    const a = attempts.filter(
      (a) => a.occurrenceId === o.id && a.subjectKey === `occurrence:${o.id}`
    );
    const unknown =
      ['CLAIMED', 'UNCERTAIN'].includes(o.attemptState) ||
      uncertainLegacySlot(source, o.postId, new Date(o.scheduledAt)) ||
      a.some((a) => ['CLAIMED', 'UNCERTAIN'].includes(a.phase));
    const confirmed =
      a.some((a) => a.phase === 'CONFIRMED') || o.outcome === 'CONFIRMED';
    const manual = evidence.some(
      (e) =>
        e.occurrenceId === o.id &&
        e.origin === 'manual' &&
        e.confirmedById &&
        e.remoteId
    );
    const expired = (t.automationRecoveryDecision || []).some(
      (d) => d.subjectKey === `occurrence:${o.id}` && d.action === 'EXPIRE'
    );
    add({
      subjectKey: `occurrence:${o.id}`,
      organizationId: o.organizationId,
      postId: o.postId,
      decision: unknown
        ? 'RETAIN'
        : confirmed || manual
        ? 'PRESERVE_EVIDENCE'
        : o.outcome === 'FAILED'
        ? 'PRESERVE_FAILURE'
        : expired || +new Date(o.scheduledAt) < +cutoffAt
        ? 'EXPIRE'
        : unavailable
        ? 'RETAIN'
        : 'PRESERVE_FUTURE',
      reason: unknown
        ? 'REMOTE_OUTCOME_UNCONFIRMED'
        : confirmed
        ? 'CONFIRMED_REMOTE_EFFECT'
        : manual
        ? 'MANUAL_ATTESTATION'
        : o.outcome === 'FAILED'
        ? 'AUTOMATIC_FAILURE_PRESERVED'
        : expired
        ? 'PERSISTED_EXPIRY'
        : +new Date(o.scheduledAt) < +cutoffAt
        ? 'PUBLICATION_BEFORE_T0'
        : unavailable
        ? 'SOURCE_SCOPE_OR_REVISION_UNAVAILABLE'
        : 'ELIGIBLE_SLOT',
      metadata: {
        occurrenceId: o.id,
        revision: o.scheduleRevision,
        group: o.groupSnapshot,
        scheduledAt: o.scheduledAt,
        automaticOutcome: o.outcome,
        manualConfirmed: !!manual,
        preserveSchedule: true,
        restrictionsPresent: !!unavailable,
      },
    });
  }
  for (const post of t.post || []) {
    const slots = occurrences.filter((o) => o.postId === post.id);
    if (!slots.length)
      add({
        subjectKey: `post:${post.id}`,
        organizationId: post.organizationId,
        postId: post.id,
        decision: post.hasRemoteReference ? 'PRESERVE_EVIDENCE' : 'RETAIN',
        reason: post.hasRemoteReference
          ? 'REMOTE_REFERENCE_ORIGIN_UNVERIFIED'
          : 'OCCURRENCE_NOT_PROVEN',
        metadata: {
          dateSnapshot: post.publishDate,
          revision: post.scheduleRevision,
          state: post.state,
        },
      });
    if (post.intervalInDays) {
      const intentions = (t.publicationScheduleIntent || []).filter((i) =>
        slots.some((o) => o.id === i.occurrenceId)
      );
      const anchors = [
        ...new Set(
          intentions
            .filter(
              (i) => i.seriesAnchor && i.intervalDays === post.intervalInDays
            )
            .map((i) => new Date(i.seriesAnchor).toISOString())
        ),
      ];
      let next: Date | null = null;
      if (anchors.length === 1) {
        try {
          next = nextFixedOccurrence(
            new Date(anchors[0]),
            post.intervalInDays,
            cutoffAt
          );
        } catch {
          /* Corrupt cadence remains visible/retained, not guessed. */
        }
        // Existing confirmed/manual slots must never become a replacement.
        for (let n = 0; next && n <= slots.length; n++) {
          const slot = slots.find(
            (o) =>
              +new Date(o.scheduledAt) === +next! &&
              (o.outcome !== 'PENDING' ||
                attempts.some(
                  (a) =>
                    a.occurrenceId === o.id &&
                    ['CLAIMED', 'UNCERTAIN'].includes(a.phase)
                ) ||
                evidence.some(
                  (e) => e.occurrenceId === o.id && e.origin === 'manual'
                ))
          );
          if (!slot) break;
          next = new Date(+next + post.intervalInDays * 86400000);
        }
      }
      add({
        subjectKey: `series:${post.id}:${post.scheduleRevision}`,
        organizationId: post.organizationId,
        postId: post.id,
        decision: next ? 'PRESERVE_SERIES' : 'RETAIN',
        reason: next ? 'FIXED_CADENCE_PROVEN' : 'RECURRENCE_ANCHOR_UNRESOLVED',
        metadata: {
          revision: post.scheduleRevision,
          intervalDays: post.intervalInDays,
          anchor: anchors.length === 1 ? anchors[0] : null,
          nextScheduledAt: next?.toISOString() || null,
          replacementRequired:
            !!next && !slots.some((o) => +new Date(o.scheduledAt) === +next!),
          applyAutomatically: false,
        },
      });
    }
  }
  for (const e of t.instagramWebhookEvent || []) {
    const integration = (t.integration || []).find(
      (i) => i.id === e.integrationId
    );
    const execution = (t.instagramCommentAutomationExecution || []).find(
      (x) => x.webhookEventId === e.id
    );
    const old =
      e.recoverySkipReason ||
      +new Date(e.receivedAt) < +cutoffAt ||
      (e.occurredAtSource === 'META_COMMENT_CREATED_TIME' &&
        +new Date(e.occurredAt) < +cutoffAt);
    add({
      subjectKey: `comment:${e.id}`,
      organizationId: integration?.organizationId,
      decision: !integration
        ? 'RETAIN'
        : old
        ? 'SUPPRESS_PENDING'
        : e.occurredAtSource === 'META_COMMENT_CREATED_TIME'
        ? 'PRESERVE_ELIGIBILITY'
        : 'RETAIN',
      reason: !integration
        ? 'COMMENT_INTEGRATION_UNRESOLVED'
        : old
        ? 'COMMENT_BEFORE_T0'
        : e.occurredAtSource === 'META_COMMENT_CREATED_TIME'
        ? 'CREATION_TIME_PROVEN'
        : 'COMMENT_CREATION_TIME_UNVERIFIED',
      metadata: {
        eventId: e.id,
        receivedAt: e.receivedAt,
        occurredAt: e.occurredAt,
        eventStatus: e.status,
        publicReplyStatus: execution?.publicReplyStatus || null,
        privateReplyStatus: execution?.privateReplyStatus || null,
        preserveResults: true,
      },
    });
  }
  for (const a of t.publicationDerivedAction || [])
    for (const check of a.schedule || []) {
      const unknown =
        a.phase === 'UNCERTAIN' ||
        uncertainLegacySlot(
          source,
          a.postId,
          new Date(
            occurrences.find((o) => o.id === a.rootOccurrenceId)?.scheduledAt ||
              check.scheduledAt
          )
        ) ||
        attempts.some(
          (e) =>
            e.subjectKey === `derived:${a.id}` &&
            ['CLAIMED', 'UNCERTAIN'].includes(e.phase)
        );
      const expired = (t.automationRecoveryDecision || []).some(
        (d) =>
          d.subjectKey === `derived:${a.id}` &&
          d.action === `EXPIRE_CHECK:${check.index}`
      );
      add({
        subjectKey: `derived:${a.id}:check:${check.index}`,
        organizationId: a.organizationId,
        postId: a.postId,
        decision: unknown
          ? 'RETAIN'
          : a.phase === 'CONFIRMED'
          ? 'PRESERVE_EVIDENCE'
          : expired || +new Date(check.scheduledAt) < +cutoffAt
          ? 'EXPIRE'
          : 'PRESERVE_DEPENDENT',
        reason: unknown
          ? 'REMOTE_OUTCOME_UNCONFIRMED'
          : a.phase === 'CONFIRMED'
          ? 'CONFIRMED_REMOTE_EFFECT'
          : expired || +new Date(check.scheduledAt) < +cutoffAt
          ? 'DERIVED_BEFORE_T0'
          : 'PARENT_PROOF_REQUIRED',
        metadata: {
          actionId: a.id,
          rootOccurrenceId: a.rootOccurrenceId,
          configurationHash: a.configurationHash,
          scheduledAt: check.scheduledAt,
          phase: a.phase,
        },
      });
    }
  for (const w of source.workflows) {
    // A timer firing time is not a publication slot. A mutable Post is not a
    // legacy occurrence. Preserve all observations and require reviewed mapping.
    const bindings = (t.automationWorkflowBinding || []).filter(
      (b) => b.workflowId === w.workflowId && b.runId === w.runId
    );
    add({
      subjectKey: `workflow:${w.workflowId}:${w.runId}`,
      organizationId: w.input?.organizationId,
      postId: w.input?.postId,
      decision: bindings.length ? 'REVIEW_BINDINGS' : 'RETAIN',
      reason: bindings.length
        ? 'REVALIDATE_PENDING_COMMANDS'
        : 'LEGACY_HISTORY_BINDING_REQUIRED',
      metadata: w,
    });
  }
  for (const warning of source.warnings)
    add({
      subjectKey: `inventory-warning:${recoveryKey(warning)}`,
      decision: 'RETAIN',
      reason: warning,
      metadata: {},
    });
  return items.sort((a, b) => a.subjectKey.localeCompare(b.subjectKey));
}
