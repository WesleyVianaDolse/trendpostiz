import { proxyActivities, sleep, startChild } from '@temporalio/workflow';
import type { RecoveryPublicationActivity } from '@gitroom/orchestrator/activities/recovery-publication.activity';
import type { ScheduleDescriptor } from '@gitroom/nestjs-libraries/automation-recovery/publication-scheduling.service';
import { derivedPublicationWorkflow } from '@gitroom/orchestrator/workflows/derived-publication.workflow';

// New history contract. The five legacy exports and their commands stay intact.
// Workflow inputs/results contain identifiers and receipts, never access tokens.
export async function postWorkflowV106(descriptor: ScheduleDescriptor) {
  await sleep(Math.max(0, +new Date(descriptor.scheduledAt) - Date.now()));
  const main = proxyActivities<RecoveryPublicationActivity>({
    startToCloseTimeout: '2 minutes',
    retry: { maximumAttempts: 3 },
  });
  const delivery = proxyActivities<RecoveryPublicationActivity>({
    taskQueue: descriptor.taskQueue,
    startToCloseTimeout: '10 minutes',
    retry: { maximumAttempts: 3 },
  });
  const plan = await main.recoveryPublicationPlan(descriptor);
  // Preserve the next valid cadence even if this occurrence cannot be sent.
  if (plan.next)
    await startChild(postWorkflowV106, {
      workflowId: plan.next.workflowId,
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
      parentClosePolicy: 'ABANDON',
      args: [plan.next],
    });
  const root = await delivery.recoveryPublicationDeliver(
    descriptor,
    plan.members[0].id
  );
  // Child metadata was frozen at admission. ABANDON preserves future derived
  // checks independently of this thread/next recurrence. Parent proof is read
  // from the ledger, never inferred from child start or workflow completion.
  if (plan.derived.length)
    await startChild(derivedPublicationWorkflow, {
      workflowId: `derived-${descriptor.occurrenceId}`,
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
      parentClosePolicy: 'ABANDON',
      args: [
        {
          organizationId: descriptor.organizationId,
          rootOccurrenceId: descriptor.occurrenceId,
          taskQueue: descriptor.taskQueue,
          actions: plan.derived,
        },
      ],
    });
  if (!plan.commentable) return root;
  let lastRemoteId: string | undefined;
  for (const member of plan.members.slice(1)) {
    await sleep(Math.max(0, +new Date(member.scheduledAt) - Date.now()));
    const result = await delivery.recoveryPublicationDeliver(
      descriptor,
      member.id,
      root[0].postId,
      lastRemoteId
    );
    lastRemoteId = result[0].postId;
  }
  return root;
}
