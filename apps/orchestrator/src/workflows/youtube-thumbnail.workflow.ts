import {
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';
import type { PostActivity } from '../activities/post.activity';

const { processYoutubeThumbnail, stopYoutubeThumbnail } =
  proxyActivities<PostActivity>({
    startToCloseTimeout: '5 minutes',
    retry: {
      maximumAttempts: 3,
      initialInterval: '30 seconds',
      maximumInterval: '2 minutes',
    },
  });

// signalWithStart coalesces concurrent starts and manual retries into one worker.
const wake = defineSignal('wake');
export async function youtubeThumbnailWorkflow({
  organizationId,
  postId,
  videoId,
}: {
  organizationId: string;
  postId: string;
  videoId: string;
}) {
  let wakeRequested = false;
  setHandler(wake, () => {
    wakeRequested = true;
  });
  // A separate durable timer frees the activity worker between processing checks.
  // The persisted attempt budget also survives workflow restarts.
  try {
    for (let i = 0; i <= 12; i++) {
      wakeRequested = false;
      const result = await processYoutubeThumbnail(
        organizationId,
        postId,
        videoId
      );
      if (result.done && !wakeRequested) return;
      if (wakeRequested) continue;
      await sleep(Math.max(1000, result.delay));
    }
  } catch {
    // Record a visible, isolated thumbnail failure after activity retries end.
  }
  await stopYoutubeThumbnail(organizationId, postId, videoId);
}
