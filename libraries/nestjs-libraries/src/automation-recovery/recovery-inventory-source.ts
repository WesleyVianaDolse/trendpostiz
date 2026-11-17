import type { Client } from '@temporalio/client';
import { Prisma } from '@prisma/client';
import {
  inventoryHash,
  projectRecoveryHistory,
  RecoveryInventory,
} from './recovery-inventory';
import { RecoveryHold } from './recovery-policy';
import { PrismaService } from '../database/prisma/prisma.service';

const select = (fields: string[]) =>
  Object.fromEntries(fields.map((k) => [k, true]));
const PAGE = 250;

/** Reads application-owned metadata only. No client token, payload or Mastra DML. */
export async function readRecoveryDatabase(
  prisma: PrismaService,
  scope: string[]
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return readRecoveryDatabaseTx(tx, scope);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 120000,
    }
  );
}

/** Identical projection under the applicator's serializable write transaction. */
export async function readRecoveryDatabaseTx(
  tx: Prisma.TransactionClient,
  scope: string[]
) {
  const tables: Record<string, any[]> = {};
  const control = await tx.automationRecoveryControl.findUnique({
    where: { id: 'global' },
  });
  tables.recoveryControl = control ? [control] : [];
  const load = async (
    model: string,
    where: any,
    fields: string[],
    project = (row: any) => row
  ) => {
    const rows: any[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await (tx as any)[model].findMany({
        where: {
          AND: [where, ...(cursor ? [{ id: { gt: cursor } }] : [])],
        },
        select: select(fields),
        orderBy: { id: 'asc' },
        take: PAGE,
      });
      rows.push(...page.map(project));
      if (page.length < PAGE) break;
      cursor = page.at(-1).id;
    }
    tables[model] = rows;
  };
  const org = { organizationId: { in: scope } };
  await load(
    'plugs',
    org,
    [
      'id',
      'organizationId',
      'integrationId',
      'activated',
      'plugFunction',
      'data',
    ],
    ({ data, ...row }) => ({ ...row, configurationHash: inventoryHash(data) })
  );
  await load('organization', { id: { in: scope } }, [
    'id',
    'suspendedAt',
    'deletionRequestedAt',
  ]);
  await load('integration', org, [
    'id',
    'organizationId',
    'providerIdentifier',
    'disabled',
    'deletedAt',
    'refreshNeeded',
    'inBetweenSteps',
    'updatedAt',
  ]);
  await load(
    'post',
    org,
    [
      'id',
      'organizationId',
      'integrationId',
      'group',
      'parentPostId',
      'delay',
      'publishDate',
      'scheduleRevision',
      'intervalInDays',
      'state',
      'adminPausedAt',
      'deletedAt',
      'updatedAt',
      'releaseId',
      'releaseURL',
      'youtubeVideoId',
      'youtubeUploadState',
      'youtubeUploadKey',
      'content',
      'settings',
      'image',
    ],
    (r) => {
      const {
        content,
        settings,
        image,
        releaseId,
        releaseURL,
        youtubeVideoId,
        youtubeUploadKey,
        ...metadata
      } = r;
      return {
        ...metadata,
        hasRemoteReference: !!(releaseId || releaseURL || youtubeVideoId),
        remoteReferenceHash: inventoryHash([
          releaseId,
          releaseURL,
          youtubeVideoId,
          youtubeUploadKey,
        ]),
        configurationHash: inventoryHash([content, settings, image]),
      };
    }
  );
  await load(
    'publicationOccurrence',
    org,
    [
      'id',
      'organizationId',
      'postId',
      'scheduleRevision',
      'scheduledAt',
      'groupSnapshot',
      'outcome',
      'attemptState',
      'claimId',
      'claimGeneration',
      'remoteId',
      'failureReason',
      'updatedAt',
    ],
    ({ claimId, ...row }) => ({ ...row, claimHash: inventoryHash(claimId) })
  );
  await load(
    'automationEffectAttempt',
    org,
    [
      'id',
      'organizationId',
      'subjectKey',
      'actionKey',
      'occurrenceId',
      'postId',
      'phase',
      'requestHash',
      'remoteId',
      'generation',
      'claimId',
      'receipt',
      'failureReason',
      'updatedAt',
    ],
    ({ claimId, receipt, ...row }) => ({
      ...row,
      claimHash: inventoryHash(claimId),
      receiptHash: inventoryHash(receipt),
    })
  );
  await load('automationRecoveryDecision', org, [
    'id',
    'organizationId',
    'subjectKey',
    'action',
    'reason',
    'recoveryId',
  ]);
  await load('automationWorkflowBinding', org, [
    'id',
    'organizationId',
    'workflowId',
    'runId',
    'occurrenceId',
    'actionKey',
    'expectedRequestHash',
    'derivedActionId',
    'derivedCheckIndex',
  ]);
  await load(
    'publicationEvidence',
    org,
    [
      'id',
      'organizationId',
      'occurrenceId',
      'origin',
      'remoteId',
      'remoteUrl',
      'confirmedById',
      'confirmedAt',
    ],
    ({ remoteUrl, ...row }) => ({
      ...row,
      remoteUrlHash: inventoryHash(remoteUrl),
    })
  );
  await load(
    'publicationRecordEvidence',
    org,
    [
      'id',
      'organizationId',
      'postId',
      'revision',
      'groupSnapshot',
      'dateSnapshot',
      'stateSnapshot',
      'remoteId',
      'remoteUrl',
      'youtubeVideoId',
      'uploadKey',
      'origin',
      'capturedAt',
    ],
    ({ remoteId, remoteUrl, youtubeVideoId, uploadKey, ...row }) => ({
      ...row,
      remoteReferenceHash: inventoryHash([
        remoteId,
        remoteUrl,
        youtubeVideoId,
        uploadKey,
      ]),
    })
  );
  await load('publicationDerivedAction', org, [
    'id',
    'organizationId',
    'rootOccurrenceId',
    'postId',
    'sourceIntegrationId',
    'targetIntegrationId',
    'method',
    'configurationHash',
    'schedule',
    'phase',
    'reason',
    'updatedAt',
  ]);
  // These two tables have a different stable primary key or contain a private snapshot.
  const intents = await tx.publicationScheduleIntent.findMany({
    where: org,
    orderBy: { occurrenceId: 'asc' },
  });
  tables.publicationScheduleIntent = intents.map(({ snapshot, ...i }) => ({
    ...i,
    snapshotHash: inventoryHash(snapshot),
  }));
  await load(
    'instagramWebhookEvent',
    { OR: [{ integration: org }, { integrationId: null }] },
    [
      'id',
      'integrationId',
      'receivedAt',
      'occurredAt',
      'occurredAtSource',
      'status',
      'recoverySkipReason',
    ]
  );
  await load(
    'instagramCommentAutomationExecution',
    { automation: { integration: org } },
    [
      'id',
      'webhookEventId',
      'publicReplyStatus',
      'privateReplyStatus',
      'publicReplyId',
      'privateReplyId',
      'processedAt',
    ]
  );
  return tables;
}

/** No Workflow start/signal/cancel/reset/terminate API is used by this adapter. */
export async function readRecoveryTemporal(
  client: Client,
  scope: string[],
  known: { workflowId: string; runId: string }[],
  requiredQueues: string[]
) {
  const namespace = client.options.namespace,
    executions = new Map<string, { workflowId: string; runId: string }>();
  const list = async () => {
    const values: any[] = [];
    for await (const info of client.workflow.list({ pageSize: PAGE }))
      values.push({ workflowId: info.workflowId, runId: info.runId });
    return values.sort((a, b) =>
      `${a.workflowId}:${a.runId}`.localeCompare(`${b.workflowId}:${b.runId}`)
    );
  };
  const before = await list();
  for (const v of [...before, ...known])
    executions.set(`${v.workflowId}:${v.runId}`, v);
  const workflows: any[] = [],
    warnings: string[] = [];
  for (const execution of executions.values()) {
    const handle = client.workflow.getHandle(
      execution.workflowId,
      execution.runId
    );
    try {
      const description = await handle.describe(),
        history = await handle.fetchHistory();
      const projected = projectRecoveryHistory(
        execution.workflowId,
        execution.runId,
        history,
        description
      );
      if (
        !projected.input.organizationId ||
        scope.includes(projected.input.organizationId)
      )
        workflows.push(projected);
    } catch {
      warnings.push(
        `TEMPORAL_EXECUTION_UNREADABLE:${inventoryHash(execution)}`
      );
    }
  }
  const after = await list();
  if (inventoryHash(before) !== inventoryHash(after))
    throw new RecoveryHold('TEMPORAL_VISIBILITY_CHANGED');
  // Visibility is eventually consistent. This stability check is evidence for
  // review, not an authoritative completeness certificate or admission grant.
  const queues: any[] = [];
  const names = [
    ...new Set(
      [
        ...requiredQueues,
        ...workflows.map((w) => w.taskQueue),
        ...workflows.flatMap((w) => w.activities.map((a: any) => a.taskQueue)),
      ].filter(Boolean)
    ),
  ].sort();
  for (const name of names)
    for (const taskQueueType of [1, 2]) {
      try {
        const value = await client.workflowService.describeTaskQueue({
          namespace,
          taskQueue: { name },
          taskQueueType,
          includeTaskQueueStatus: true,
        });
        queues.push({
          name,
          kind: taskQueueType,
          pollers: (value.pollers || []).map((p) => ({
            identityHash: inventoryHash(p.identity),
            lastAccessAt: p.lastAccessTime
              ? new Date(
                  Number(p.lastAccessTime.seconds) * 1000 +
                    Number(p.lastAccessTime.nanos) / 1e6
                ).toISOString()
              : null,
            protocolReported: false,
          })),
          backlogHint:
            value.taskQueueStatus?.backlogCountHint?.toString() || null,
        });
        if (value.pollers?.length)
          warnings.push(
            `ACTIVE_POLLER_REQUIRES_CONTAINMENT:${name}:${taskQueueType}`
          );
      } catch {
        warnings.push(`TASK_QUEUE_UNREADABLE:${name}:${taskQueueType}`);
      }
    }
  return {
    workflows: workflows.sort((a, b) =>
      `${a.workflowId}:${a.runId}`.localeCompare(`${b.workflowId}:${b.runId}`)
    ),
    queues,
    warnings,
  };
}

export async function captureRecoveryInventory(
  prisma: PrismaService,
  client: Client,
  scope: string[],
  queues: string[]
): Promise<RecoveryInventory> {
  if (!scope.length || new Set(scope).size !== scope.length)
    throw new RecoveryHold('INVALID_INVENTORY_SCOPE');
  const tables = await readRecoveryDatabase(prisma, scope);
  const temporal = await readRecoveryTemporal(
    client,
    scope,
    tables.automationWorkflowBinding,
    queues
  );
  const finalTables = await readRecoveryDatabase(prisma, scope);
  if (inventoryHash(tables) !== inventoryHash(finalTables))
    throw new RecoveryHold('DATABASE_INVENTORY_CHANGED');
  return { scope: [...scope].sort(), tables, ...temporal };
}
