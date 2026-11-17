import { proxyActivities, sleep } from '@temporalio/workflow';
import type { RecoveryPublicationActivity } from '../activities/recovery-publication.activity';

export async function derivedPublicationWorkflow(input: {
  organizationId: string;
  rootOccurrenceId: string;
  taskQueue: string;
  actions: { id: string; checks: { index: number; scheduledAt: string }[] }[];
}) {
  const activities = proxyActivities<RecoveryPublicationActivity>({
    taskQueue: input.taskQueue,
    startToCloseTimeout: '10 minutes',
    retry: { maximumAttempts: 3 },
  });
  const pending = input.actions
    .flatMap((action) =>
      action.checks.map((check) => ({ ...check, id: action.id }))
    )
    .sort(
      (a, b) =>
        +new Date(a.scheduledAt) - +new Date(b.scheduledAt) ||
        a.id.localeCompare(b.id)
    );
  const terminal = new Set<string>();
  for (const check of pending) {
    if (terminal.has(check.id)) continue;
    await sleep(Math.max(0, +new Date(check.scheduledAt) - Date.now()));
    const outcome = await activities.recoveryDerivedDeliver(
      input.organizationId,
      input.rootOccurrenceId,
      check.id,
      check.index
    );
    if (outcome.kind === 'CONFIRMED' || outcome.kind === 'UNCERTAIN')
      terminal.add(check.id);
    // NOT_EXECUTED is evidence for this check only. A later original check is
    // preserved; its occurrence/cutoff/configuration are revalidated by activity.
  }
}
