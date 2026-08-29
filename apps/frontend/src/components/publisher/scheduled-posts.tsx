'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { expandPostsList } from '@gitroom/helpers/utils/posts.list.minify';

interface ScheduledPost {
  id: string;
  content: string;
  publishDate: string;
  state: string;
  integration?: {
    id: string;
    name: string;
    picture?: string;
    providerIdentifier?: string;
  };
}

interface ScheduledPostsResponse {
  posts: ScheduledPost[];
  total: number;
  hasMore: boolean;
}

function plainText(content: string) {
  return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatSchedule(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { day: 'Data', time: '--:--' };

  return {
    day: new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    }).format(date),
    time: new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date),
  };
}

function PostsSkeleton() {
  return (
    <div className="space-y-3" aria-label="Carregando publicações">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-[112px] animate-pulse rounded-2xl bg-newTableHeader" />
      ))}
    </div>
  );
}

export function ScheduledPosts() {
  const fetch = useFetch();
  const loadPosts = useCallback(
    async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Não foi possível carregar as publicações.');
      return expandPostsList(await response.json()) as ScheduledPostsResponse;
    },
    [fetch]
  );
  const { data, error, isLoading, mutate } = useSWR(
    '/posts/list?state=scheduled&page=0&limit=5',
    loadPosts,
    {
      revalidateOnFocus: false,
      refreshInterval: 60_000,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    }
  );
  const posts = data?.posts || [];

  return (
    <section aria-labelledby="publisher-scheduled-title">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="publisher-scheduled-title" className="text-lg font-bold tracking-[-0.01em] text-newTextColor">
            Próximas publicações
          </h2>
          <p className="mt-0.5 text-xs text-textItemBlur">Sua agenda mais próxima</p>
        </div>
        <Link href="/publish/scheduled" className="text-xs font-semibold text-btnPrimary">
          Ver agenda{data && data.total > posts.length ? ` (+${data.total - posts.length})` : ''}
        </Link>
      </div>

      {isLoading ? <PostsSkeleton /> : null}

      {error ? (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-5 text-sm text-newTextColor" role="alert">
          <p>Não foi possível carregar as próximas publicações.</p>
          <button type="button" onClick={() => void mutate()} className="mt-2 font-semibold text-btnPrimary">
            Tentar novamente
          </button>
        </div>
      ) : null}

      {!isLoading && !error && posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-newTableBorder bg-newBgColorInner px-5 py-8 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-newTableHeader text-xl" aria-hidden="true">
            ◷
          </div>
          <p className="mt-3 text-sm font-semibold text-newTextColor">Agenda livre</p>
          <p className="mt-1 text-xs leading-5 text-textItemBlur">Nenhuma publicação futura foi agendada.</p>
        </div>
      ) : null}

      {!isLoading && !error && posts.length > 0 ? (
        <div className="space-y-3">
          {posts.map((post) => {
            const schedule = formatSchedule(post.publishDate);
            const preview = plainText(post.content || '');
            return (
              <Link key={post.id} href={`/publish/scheduled/${encodeURIComponent(post.id)}`} className="block rounded-2xl border border-newTableBorder bg-newBgColorInner p-4 shadow-sm transition-transform active:scale-[0.99]">
                <div className="flex gap-3">
                  <div className="w-14 shrink-0 rounded-xl bg-newTableHeader px-2 py-2 text-center">
                    <p className="truncate text-[10px] font-semibold uppercase text-textItemBlur">{schedule.day}</p>
                    <p className="mt-1 text-base font-bold text-newTextColor">{schedule.time}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {post.integration?.picture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={post.integration.picture} alt="" className="h-5 w-5 rounded-full bg-newTableHeader object-cover" />
                      ) : null}
                      <p className="truncate text-sm font-semibold text-newTextColor">{post.integration?.name || 'Conta social'}</p>
                      <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-semibold text-amber-500">
                        Agendado
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-textItemBlur">
                      {preview || 'Publicação sem texto de preview.'}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
