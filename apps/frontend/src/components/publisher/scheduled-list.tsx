'use client';

import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import useSWRInfinite from 'swr/infinite';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { BottomNavigation } from './bottom-navigation';
import { ScheduledCard } from './scheduled-card';
import { getScheduledPage } from '@gitroom/frontend/features/publisher/scheduled/scheduled-api';
import { ScheduledListPage } from '@gitroom/frontend/features/publisher/scheduled/scheduled.types';

const PAGE_SIZE = 20;

function dayKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'invalid' : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não informada';
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (dayKey(value) === dayKey(today.toISOString())) return 'Hoje';
  if (dayKey(value) === dayKey(tomorrow.toISOString())) return 'Amanhã';
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(date);
}

export function ScheduledList() {
  const fetch = useFetch();
  const loadPage = useCallback(
    ([, page]: [string, number]) => getScheduledPage(fetch, page, PAGE_SIZE),
    [fetch]
  );
  const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite<ScheduledListPage>(
    (page, previous) => previous && !previous.hasMore ? null : ['publisher-scheduled', page],
    loadPage,
    { revalidateOnFocus: false, revalidateFirstPage: true }
  );
  const posts = useMemo(() => {
    const seen = new Set<string>();
    return (data || []).flatMap((page) => page.posts).filter((post) => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
  }, [data]);
  const hasMore = data?.[data.length - 1]?.hasMore || false;

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-y-auto bg-newBgColor">
      <div className="mx-auto min-h-full w-full max-w-[430px] bg-newBgColor pb-[calc(6rem+env(safe-area-inset-bottom))] shadow-[0_0_40px_rgba(0,0,0,0.06)]">
        <header className="flex items-center gap-3 px-5 pb-5 pt-6">
          <Link href="/publish" aria-label="Voltar ao início" className="flex h-11 w-11 items-center justify-center rounded-2xl border border-newTableBorder bg-newBgColorInner text-xl text-newTextColor">←</Link>
          <div>
            <p className="text-xs font-semibold text-textItemBlur">TrendPostiz Publisher</p>
            <h1 className="text-xl font-bold tracking-[-0.02em] text-newTextColor">Agenda</h1>
          </div>
        </header>

        <main className="space-y-5 px-5 pb-8">
          {isLoading ? (
            <div className="space-y-3" aria-label="Carregando agenda">
              {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-newTableHeader" />)}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-5" role="alert">
              <p className="text-sm font-bold text-newTextColor">Não foi possível carregar a agenda.</p>
              <p className="mt-1 text-xs text-textItemBlur">{error instanceof Error ? error.message : 'Tente novamente.'}</p>
              <button type="button" onClick={() => void mutate()} className="mt-3 text-sm font-bold text-btnPrimary">Tentar novamente</button>
            </div>
          ) : null}

          {!isLoading && !error && posts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-newTableBorder bg-newBgColorInner px-5 py-10 text-center">
              <p className="text-lg font-bold text-newTextColor">Agenda livre</p>
              <p className="mt-2 text-sm leading-5 text-textItemBlur">Nenhuma publicação futura está agendada.</p>
              <Link href="/publish/new" className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-btnPrimary px-5 text-sm font-bold text-white">Criar publicação</Link>
            </div>
          ) : null}

          {posts.map((post, index) => {
            const showHeading = index === 0 || dayKey(posts[index - 1].publishDate) !== dayKey(post.publishDate);
            return (
              <section key={post.id}>
                {showHeading ? <h2 className="mb-2 text-sm font-bold capitalize text-newTextColor">{dayLabel(post.publishDate)}</h2> : null}
                <ScheduledCard post={post} />
              </section>
            );
          })}

          {hasMore ? (
            <button type="button" disabled={isValidating} onClick={() => void setSize(size + 1)} className="min-h-12 w-full rounded-xl border border-newTableBorder bg-newBgColorInner text-sm font-bold text-newTextColor disabled:opacity-50">
              {isValidating ? 'Carregando…' : 'Carregar mais'}
            </button>
          ) : null}
        </main>
        <BottomNavigation />
      </div>
    </div>
  );
}
