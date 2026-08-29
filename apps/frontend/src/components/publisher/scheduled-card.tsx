'use client';

import Link from 'next/link';
import { ScheduledListPost } from '@gitroom/frontend/features/publisher/scheduled/scheduled.types';
import { stateLabel } from '@gitroom/frontend/features/publisher/scheduled/scheduled-api';

function plainText(content: string) {
  return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const stateStyle = {
  QUEUE: 'bg-amber-500/15 text-amber-600',
  PUBLISHED: 'bg-emerald-500/15 text-emerald-600',
  ERROR: 'bg-red-500/15 text-red-600',
  DRAFT: 'bg-slate-500/15 text-textItemBlur',
};

export function ScheduledCard({ post }: { post: ScheduledListPost }) {
  const date = new Date(post.publishDate);
  const time = Number.isNaN(date.getTime())
    ? '--:--'
    : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);

  return (
    <Link
      href={`/publish/scheduled/${encodeURIComponent(post.id)}`}
      className="block rounded-2xl border border-newTableBorder bg-newBgColorInner p-4 shadow-sm transition-transform active:scale-[0.99]"
    >
      <div className="flex gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-newTableHeader text-sm font-bold text-newTextColor">
          {time}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {post.integration?.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.integration.picture} alt="" className="h-6 w-6 rounded-full bg-newTableHeader object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-newTextColor">{post.integration?.name || 'Conta social'}</p>
              <p className="truncate text-[11px] text-textItemBlur">{post.integration?.providerIdentifier || 'Provider'}</p>
            </div>
            <span className={`${stateStyle[post.state] || stateStyle.DRAFT} shrink-0 rounded-full px-2 py-1 text-[10px] font-bold`}>
              {stateLabel(post.state)}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-textItemBlur">
            {plainText(post.content) || 'Publicação sem texto de preview.'}
          </p>
        </div>
      </div>
    </Link>
  );
}
