import { ScheduledPostDetailView } from '@gitroom/frontend/components/publisher/scheduled-post-detail';

export default async function ScheduledPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScheduledPostDetailView postId={id} />;
}
