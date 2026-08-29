'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { BottomNavigation } from './bottom-navigation';
import { ProviderSettings } from './provider-settings';
import { isVideoMedia } from '@gitroom/frontend/features/publisher/media/media-validation';
import { validatePublisherForm } from '@gitroom/frontend/features/publisher/model/provider-rules';
import {
  PublisherIntegration,
  PublisherProviderSettings,
} from '@gitroom/frontend/features/publisher/model/publisher.types';
import {
  PublisherSubmissionError,
  ShortlinkPreference,
  submitPublisherPost,
} from '@gitroom/frontend/features/publisher/submission/publisher-submission';
import {
  buildScheduledEditPayload,
  canEditScheduledDetail,
  createScheduledActionGuard,
  deleteScheduledPost,
  ensureMutableScheduledPost,
  getDetailIntegration,
  getScheduledDetail,
  localScheduleParts,
  localScheduleToUtc,
  reschedulePost,
  ScheduledApiError,
  stateLabel,
} from '@gitroom/frontend/features/publisher/scheduled/scheduled-api';
import {
  ScheduledActionIssue,
  ScheduledPostDetail,
} from '@gitroom/frontend/features/publisher/scheduled/scheduled.types';

interface IntegrationsResponse { integrations?: PublisherIntegration[] }
interface ShortlinkResponse { shortlink: ShortlinkPreference }

function plainText(content: string) {
  return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Data indisponível'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short' }).format(date);
}

function issueFrom(error: unknown): ScheduledActionIssue {
  if (error instanceof ScheduledApiError || error instanceof PublisherSubmissionError) {
    return { message: error.message, ambiguous: error.ambiguous };
  }
  return { message: 'Ocorreu um erro inesperado. Os dados da tela foram preservados.', ambiguous: false };
}

function revalidationKey(key: unknown) {
  return key === '/posts/list?state=scheduled&page=0&limit=5' ||
    (Array.isArray(key) && key[0] === 'publisher-scheduled');
}

export function ScheduledPostDetailView({ postId }: { postId: string }) {
  const fetch = useFetch();
  const router = useRouter();
  const { mutate: mutateCache } = useSWRConfig();
  const actionGuard = useRef(createScheduledActionGuard());
  const [editing, setEditing] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [action, setAction] = useState<'edit' | 'reschedule' | 'delete'>();
  const [issue, setIssue] = useState<ScheduledActionIssue>();
  const [notice, setNotice] = useState('');
  const [contents, setContents] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<PublisherProviderSettings>({});
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [validationError, setValidationError] = useState('');

  const loadDetail = useCallback(() => getScheduledDetail(fetch, postId), [fetch, postId]);
  const { data, error, isLoading, mutate } = useSWR<ScheduledPostDetail>(`/posts/${postId}`, loadDetail, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const loadIntegrations = useCallback(async () => {
    const response = await fetch('/integrations/list');
    if (!response.ok) return { integrations: [] };
    return (await response.json()) as IntegrationsResponse;
  }, [fetch]);
  const { data: integrationsData } = useSWR<IntegrationsResponse>('publisher-detail-integrations', loadIntegrations, {
    revalidateOnFocus: false,
  });

  const loadShortlink = useCallback(async () => {
    const response = await fetch('/settings/shortlink');
    if (!response.ok) throw new Error('shortlink');
    return (await response.json()) as ShortlinkResponse;
  }, [fetch]);
  const { data: shortlinkData } = useSWR<ShortlinkResponse>('publisher-detail-shortlink', loadShortlink, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const integration = useMemo(() => {
    if (!data) return undefined;
    const fallback = getDetailIntegration(data);
    return integrationsData?.integrations?.find((item) => item.id === data.integration) || fallback;
  }, [data, integrationsData]);
  const editable = Boolean(data && canEditScheduledDetail(data));
  const busy = Boolean(action);

  useEffect(() => {
    if (!data || editing) return;
    setContents(Object.fromEntries(data.posts.map((post) => [post.id, post.content])));
    setSettings(data.settings || {});
    const parts = localScheduleParts(data.posts[0].publishDate);
    setScheduleDate(parts.date);
    setScheduleTime(parts.time);
  }, [data, editing]);

  const revalidateLists = useCallback(() => {
    void mutateCache(revalidationKey, undefined, { revalidate: true });
  }, [mutateCache]);

  const handleMutationError = useCallback(async (caught: unknown) => {
    setIssue(issueFrom(caught));
    if (caught instanceof ScheduledApiError && (caught.code === 'conflict' || caught.code === 'not_found')) {
      await mutate();
      revalidateLists();
    }
  }, [mutate, revalidateLists]);

  const saveEdit = useCallback(async () => {
    if (!data || !integration || actionGuard.current.busy) return;
    setIssue(undefined);
    setNotice('');
    setValidationError('');

    const parts = localScheduleParts(data.posts[0].publishDate);
    const errors = data.posts.map((post) => validatePublisherForm({
      mode: 'schedule',
      content: contents[post.id] ?? '',
      selectedIntegrations: [integration],
      settingsByIntegration: { [integration.id]: settings },
      scheduleDate: parts.date,
      scheduleTime: parts.time,
      media: post.image || [],
    }));
    const firstError = errors.flatMap((item) => Object.values(item).filter(Boolean))[0];
    if (firstError) {
      setValidationError(firstError);
      return;
    }

    setAction('edit');
    try {
      await actionGuard.current.run(async () => {
        const current = await ensureMutableScheduledPost(fetch, postId, data.group);
        if (current.posts.length !== data.posts.length) {
          throw new ScheduledApiError('A sequência da publicação mudou. Os dados foram atualizados.', 'conflict');
        }
        const payload = buildScheduledEditPayload(current, contents, settings);
        await submitPublisherPost({
          fetcher: fetch,
          payload,
          integrations: [integration],
          shortlinkPreference: shortlinkData?.shortlink || 'ASK',
          confirmShortlink: () => window.confirm('Deseja encurtar os links desta publicação?'),
        });
      });
      setEditing(false);
      setNotice('Publicação atualizada e mantida na agenda.');
      await mutate();
      revalidateLists();
    } catch (caught) {
      await handleMutationError(caught);
    } finally {
      setAction(undefined);
    }
  }, [contents, data, fetch, handleMutationError, integration, mutate, postId, revalidateLists, settings, shortlinkData?.shortlink]);

  const saveSchedule = useCallback(async () => {
    if (!data || actionGuard.current.busy) return;
    setIssue(undefined);
    setNotice('');
    let utcDate: string;
    try {
      utcDate = localScheduleToUtc(scheduleDate, scheduleTime);
    } catch (caught) {
      setIssue(issueFrom(caught));
      return;
    }
    setAction('reschedule');
    try {
      await actionGuard.current.run(async () => {
        await ensureMutableScheduledPost(fetch, postId, data.group);
        await reschedulePost(fetch, postId, utcDate);
      });
      setShowReschedule(false);
      setNotice('Publicação reagendada.');
      await mutate();
      revalidateLists();
    } catch (caught) {
      await handleMutationError(caught);
    } finally {
      setAction(undefined);
    }
  }, [data, fetch, handleMutationError, mutate, postId, revalidateLists, scheduleDate, scheduleTime]);

  const removePost = useCallback(async () => {
    if (!data || actionGuard.current.busy) return;
    if (!window.confirm('Cancelar esta publicação agendada? Ela deixará de ser publicada.')) return;
    setIssue(undefined);
    setNotice('');
    setAction('delete');
    try {
      await actionGuard.current.run(async () => {
        const current = await ensureMutableScheduledPost(fetch, postId, data.group);
        await deleteScheduledPost(fetch, current.group);
      });
      revalidateLists();
      router.replace('/publish/scheduled');
    } catch (caught) {
      await handleMutationError(caught);
    } finally {
      setAction(undefined);
    }
  }, [data, fetch, handleMutationError, postId, revalidateLists, router]);

  if (isLoading) {
    return <div className="mx-auto w-full max-w-[430px] space-y-4 p-5"><div className="h-12 animate-pulse rounded-xl bg-newTableHeader" /><div className="h-80 animate-pulse rounded-2xl bg-newTableHeader" /></div>;
  }

  if (error || !data || !integration) {
    return (
      <div className="mx-auto w-full max-w-[430px] p-5">
        <Link href="/publish/scheduled" className="text-sm font-bold text-btnPrimary">← Voltar para a agenda</Link>
        <div className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 p-5" role="alert">
          <p className="font-bold text-newTextColor">Não foi possível abrir a publicação.</p>
          <p className="mt-2 text-sm text-textItemBlur">{error instanceof Error ? error.message : 'Ela pode ter sido removida.'}</p>
        </div>
      </div>
    );
  }

  const root = data.posts[0];
  const lockedByAmbiguousError = Boolean(issue?.ambiguous);

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-y-auto bg-newBgColor">
      <div className="mx-auto min-h-full w-full max-w-[430px] bg-newBgColor pb-[calc(6rem+env(safe-area-inset-bottom))] shadow-[0_0_40px_rgba(0,0,0,0.06)]">
        <header className="flex items-center gap-3 px-5 pb-5 pt-6">
          <Link href="/publish/scheduled" aria-label="Voltar para a agenda" className="flex h-11 w-11 items-center justify-center rounded-2xl border border-newTableBorder bg-newBgColorInner text-xl text-newTextColor">←</Link>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-textItemBlur">{integration.display || integration.identifier}</p>
            <h1 className="truncate text-xl font-bold text-newTextColor">{integration.name}</h1>
          </div>
        </header>

        <main className="space-y-5 px-5 pb-8">
          <section className="rounded-2xl border border-newTableBorder bg-newBgColorInner p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-newTextColor">{stateLabel(root.state)}</span>
              <span className="text-xs text-textItemBlur">{formatDate(root.publishDate)}</span>
            </div>
            {root.error ? <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-xs leading-5 text-red-600">{root.error}</p> : null}
          </section>

          {notice ? <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-newTextColor" role="status">{notice}</div> : null}
          {issue ? <div className={`${issue.ambiguous ? 'border-amber-500/30 bg-amber-500/10' : 'border-red-500/30 bg-red-500/10'} rounded-2xl border p-4 text-sm text-newTextColor`} role="alert">{issue.message}</div> : null}

          <section className="space-y-3">
            {data.posts.map((post, index) => (
              <div key={post.id} className="rounded-2xl border border-newTableBorder bg-newBgColorInner p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-textItemBlur">{data.posts.length > 1 ? `Parte ${index + 1}` : 'Conteúdo'}</p>
                {editing ? (
                  <textarea value={contents[post.id] || ''} onChange={(event) => setContents((current) => ({ ...current, [post.id]: event.target.value }))} rows={6} className="mt-2 w-full rounded-xl border border-newTableBorder bg-newTableHeader p-3 text-sm leading-6 text-newTextColor outline-none focus:border-btnPrimary" />
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-newTextColor">{plainText(post.content) || 'Sem texto.'}</p>
                )}
                {post.image?.length ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {post.image.map((media) => isVideoMedia(media) ? (
                      <video key={media.id} src={media.url || media.path} controls muted playsInline className="aspect-square w-full rounded-xl bg-black object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={media.id} src={media.url || media.path} alt={media.alt || 'Mídia da publicação'} className="aspect-square w-full rounded-xl bg-newTableHeader object-cover" />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </section>

          {editing ? (
            <ProviderSettings integrations={[integration]} settingsByIntegration={{ [integration.id]: settings }} onChange={(_, key, value) => setSettings((current) => ({ ...current, [key]: value }))} validationError={validationError} />
          ) : (
            <section className="rounded-2xl border border-newTableBorder bg-newBgColorInner p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-textItemBlur">Configurações</p>
              <div className="mt-2 space-y-1 text-xs text-newTextColor">
                {Object.entries(settings).filter(([key]) => key !== '__type').length
                  ? Object.entries(settings).filter(([key]) => key !== '__type').map(([key, value]) => <p key={key}><span className="font-bold">{key}:</span> {typeof value === 'string' ? value : JSON.stringify(value)}</p>)
                  : <p className="text-textItemBlur">Sem configurações adicionais.</p>}
              </div>
            </section>
          )}

          {!editable ? (
            <div className="rounded-2xl bg-amber-500/10 p-4 text-sm leading-5 text-amber-700">
              {root.state !== 'QUEUE' ? 'Esta publicação está disponível somente para visualização.' : 'Edite esta publicação pelo TrendPostiz completo.'}
            </div>
          ) : null}

          {editable && !lockedByAmbiguousError ? (
            <section className="space-y-3">
              {editing ? (
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" disabled={busy} onClick={() => { setEditing(false); setValidationError(''); }} className="min-h-12 rounded-xl border border-newTableBorder bg-newBgColorInner text-sm font-bold text-newTextColor disabled:opacity-50">Cancelar</button>
                  <button type="button" disabled={busy} onClick={() => void saveEdit()} className="min-h-12 rounded-xl bg-btnPrimary text-sm font-bold text-white disabled:opacity-50">{action === 'edit' ? 'Salvando…' : 'Salvar alterações'}</button>
                </div>
              ) : (
                <button type="button" disabled={busy} onClick={() => { setEditing(true); setShowReschedule(false); setIssue(undefined); }} className="min-h-12 w-full rounded-xl bg-btnPrimary text-sm font-bold text-white disabled:opacity-50">Editar conteúdo e configurações</button>
              )}

              {showReschedule ? (
                <div className="rounded-2xl border border-newTableBorder bg-newBgColorInner p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-bold text-newTextColor">Data<input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-newTableBorder bg-newTableHeader px-2" /></label>
                    <label className="text-xs font-bold text-newTextColor">Horário<input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-newTableBorder bg-newTableHeader px-2" /></label>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button type="button" disabled={busy} onClick={() => setShowReschedule(false)} className="min-h-12 rounded-xl border border-newTableBorder text-sm font-bold text-newTextColor">Cancelar</button>
                    <button type="button" disabled={busy} onClick={() => void saveSchedule()} className="min-h-12 rounded-xl bg-btnPrimary text-sm font-bold text-white disabled:opacity-50">{action === 'reschedule' ? 'Reagendando…' : 'Confirmar nova data'}</button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={busy || editing} onClick={() => { setShowReschedule(true); setIssue(undefined); }} className="min-h-12 w-full rounded-xl border border-newTableBorder bg-newBgColorInner text-sm font-bold text-newTextColor disabled:opacity-50">Reagendar</button>
              )}

              <button type="button" disabled={busy || editing} onClick={() => void removePost()} className="min-h-12 w-full rounded-xl border border-red-500/40 bg-red-500/10 text-sm font-bold text-red-600 disabled:opacity-50">{action === 'delete' ? 'Cancelando…' : 'Cancelar e excluir'}</button>
            </section>
          ) : null}
        </main>
        <BottomNavigation />
      </div>
    </div>
  );
}
