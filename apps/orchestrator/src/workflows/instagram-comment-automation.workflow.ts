import { proxyActivities } from '@temporalio/workflow';
import { InstagramCommentAutomationActivity } from '@gitroom/orchestrator/activities/instagram-comment-automation.activity';

const activities = proxyActivities<InstagramCommentAutomationActivity>({
  startToCloseTimeout: '1 minute',
  retry: {
    maximumAttempts: 5,
    backoffCoefficient: 2,
    initialInterval: '2 seconds',
    maximumInterval: '1 minute',
  },
});

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Instagram delivery retries exhausted';

export async function instagramCommentAutomationWorkflow({
  webhookEventId,
}: {
  webhookEventId: string;
}) {
  const preparation = await activities.prepare(webhookEventId);
  if (
    !preparation.process ||
    !preparation.executionId ||
    !preparation.webhookEventId
  ) {
    return preparation.reason || 'skipped';
  }

  if (preparation.publicReplyPending) {
    try {
      await activities.deliverPublicReply(preparation.executionId);
    } catch (error) {
      await activities.markDeliveryFailedAfterRetries(
        preparation.executionId,
        'public',
        errorMessage(error)
      );
    }
  }

  if (preparation.privateReplyPending) {
    try {
      await activities.deliverPrivateReply(preparation.executionId);
    } catch (error) {
      await activities.markDeliveryFailedAfterRetries(
        preparation.executionId,
        'private',
        errorMessage(error)
      );
    }
  }

  return activities.finalize(
    preparation.executionId,
    preparation.webhookEventId
  );
}
