'use client';

import Link from 'next/link';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { AccountSummary } from '@gitroom/frontend/components/publisher/account-summary';
import { BottomNavigation } from '@gitroom/frontend/components/publisher/bottom-navigation';
import { PublisherHeader } from '@gitroom/frontend/components/publisher/publisher-header';
import { ScheduledPosts } from '@gitroom/frontend/components/publisher/scheduled-posts';

export function PublishShell() {
  const user = useUser();

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-y-auto bg-newBgColor">
      <div className="mx-auto min-h-full w-full max-w-[430px] bg-newBgColor pb-[calc(5rem+env(safe-area-inset-bottom))] shadow-[0_0_40px_rgba(0,0,0,0.06)]">
        <PublisherHeader userName={user?.name} userEmail={user?.email} />

        <main className="space-y-7 px-5 pb-8">
          <AccountSummary />
          <ScheduledPosts />

          <Link
            href="/publish/new"
            className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-btnPrimary px-5 text-base font-bold text-white shadow-[0_10px_24px_rgba(97,43,211,0.25)] transition-transform active:scale-[0.98]"
          >
            + Nova publicação
          </Link>
        </main>

        <BottomNavigation />
      </div>
    </div>
  );
}
