'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AccountPicker } from './account-picker';
import { BottomNavigation } from './bottom-navigation';
import { ProviderSettings } from './provider-settings';
import { PublishReview } from './publish-review';
import { MediaUploader } from './media-uploader';
import { buildPostPayload } from '@gitroom/frontend/features/publisher/model/build-post-payload';
import {
  getDefaultProviderSettings,
  getMaximumCharacters,
  getProviderRule,
  validatePublisherForm,
} from '@gitroom/frontend/features/publisher/model/provider-rules';
import {
  PublisherAcceptedSubmission,
  PublisherIntegration,
  PublisherMedia,
  PublisherMode,
  PublisherPostPayload,
  PublisherProviderSettings,
  PublisherSubmissionState,
  PublisherValidationErrors,
} from '@gitroom/frontend/features/publisher/model/publisher.types';
import {
  createPublisherSubmissionGuard,
  PublisherSubmissionError,
  ShortlinkPreference,
  submitPublisherPost,
} from '@gitroom/frontend/features/publisher/submission/publisher-submission';

interface IntegrationsResponse {
  integrations?: PublisherIntegration[];
}

interface ShortlinkPreferenceResponse {
  shortlink: ShortlinkPreference;
}

export function NewPublishForm() {
  const fetch = useFetch();
  const { mutate: mutateCache } = useSWRConfig();
  const scrollContainer = useRef<HTMLDivElement>(null);
  const submissionGuard = useRef(createPublisherSubmissionGuard());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<PublisherMode>('now');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [settingsByIntegration, setSettingsByIntegration] = useState<
    Record<string, PublisherProviderSettings>
  >({});
  const [errors, setErrors] = useState<PublisherValidationErrors>({});
  const [payload, setPayload] = useState<PublisherPostPayload>();
  const [submissionState, setSubmissionState] =
    useState<PublisherSubmissionState>('idle');
  const [submissionError, setSubmissionError] =
    useState<PublisherSubmissionError>();
  const [acceptedSubmission, setAcceptedSubmission] =
    useState<PublisherAcceptedSubmission>();
  const [media, setMedia] = useState<PublisherMedia[]>([]);
  const [uploadStatus, setUploadStatus] = useState({
    uploading: false,
    hasErrors: false,
  });
  const [group] = useState(() => makeId(10));

  const loadAccounts = useCallback(
    async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Não foi possível carregar as contas.');
      return (await response.json()) as IntegrationsResponse;
    },
    [fetch]
  );
  const {
    data,
    error: accountsError,
    isLoading,
    mutate,
  } = useSWR('/integrations/list', loadAccounts, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const loadShortlinkPreference = useCallback(
    async (path: string) => {
      const response = await fetch(path);
      if (!response.ok)
        throw new Error('Não foi possível carregar a preferência de links.');
      return (await response.json()) as ShortlinkPreferenceResponse;
    },
    [fetch]
  );
  const { data: shortlinkPreferenceData } = useSWR(
    '/settings/shortlink',
    loadShortlinkPreference,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const accounts = useMemo(
    () =>
      (data?.integrations || []).filter(
        (integration) => !integration.disabled && !integration.inBetweenSteps
      ),
    [data]
  );
  const selectedIntegrations = useMemo(
    () =>
      accounts.filter((integration) => selectedIds.includes(integration.id)),
    [accounts, selectedIds]
  );
  const strictestLimit = useMemo(() => {
    if (!selectedIntegrations.length) return undefined;
    return Math.min(
      ...selectedIntegrations.map((integration) =>
        getMaximumCharacters(integration)
      )
    );
  }, [selectedIntegrations]);

  const toggleIntegration = useCallback((integration: PublisherIntegration) => {
    if (
      integration.refreshNeeded ||
      !getProviderRule(integration.identifier).supported
    )
      return;

    setSelectedIds((current) =>
      current.includes(integration.id)
        ? current.filter((id) => id !== integration.id)
        : [...current, integration.id]
    );
    setSettingsByIntegration((current) =>
      current[integration.id]
        ? current
        : {
            ...current,
            [integration.id]: getDefaultProviderSettings(
              integration.identifier
            ),
          }
    );
    setErrors((current) => ({ ...current, accounts: undefined }));
  }, []);

  const changeProviderSetting = useCallback(
    (integrationId: string, key: string, value: unknown) => {
      setSettingsByIntegration((current) => ({
        ...current,
        [integrationId]: {
          ...(current[integrationId] || {}),
          [key]: value,
        },
      }));
      setErrors((current) => ({ ...current, settings: undefined }));
    },
    []
  );

  const changeMedia = useCallback((nextMedia: PublisherMedia[]) => {
    setMedia(nextMedia);
    setErrors((current) => ({
      ...current,
      media: undefined,
      content: undefined,
    }));
  }, []);

  const changeUploadStatus = useCallback(
    (status: { uploading: boolean; hasErrors: boolean }) => {
      setUploadStatus(status);
      if (!status.uploading && !status.hasErrors) {
        setErrors((current) => ({ ...current, media: undefined }));
      }
    },
    []
  );

  const review = useCallback(() => {
    setSubmissionState('validating');
    setSubmissionError(undefined);
    const nextErrors = validatePublisherForm({
      mode,
      content,
      selectedIntegrations,
      settingsByIntegration,
      scheduleDate,
      scheduleTime,
      media,
      uploadInProgress: uploadStatus.uploading,
      uploadHasErrors: uploadStatus.hasErrors,
    });
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      setSubmissionState('idle');
      return;
    }

    setPayload(
      buildPostPayload({
        mode,
        content,
        group,
        scheduleDate,
        scheduleTime,
        media,
        integrations: selectedIntegrations.map((integration) => ({
          id: integration.id,
          settings: settingsByIntegration[integration.id] || {},
        })),
      })
    );
    setSubmissionState('idle');
    scrollContainer.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [
    content,
    group,
    mode,
    media,
    scheduleDate,
    scheduleTime,
    selectedIntegrations,
    settingsByIntegration,
    uploadStatus.hasErrors,
    uploadStatus.uploading,
  ]);

  const submit = useCallback(async () => {
    if (!payload || submissionGuard.current.active) return;

    setSubmissionState('validating');
    setSubmissionError(undefined);

    const nextErrors = validatePublisherForm({
      mode,
      content,
      selectedIntegrations,
      settingsByIntegration,
      scheduleDate,
      scheduleTime,
      media,
      uploadInProgress: uploadStatus.uploading,
      uploadHasErrors: uploadStatus.hasErrors,
    });
    setErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setSubmissionError(
        new PublisherSubmissionError(
          'O formulário mudou ou possui uma pendência. Volte e revise os campos antes de enviar.',
          'validation'
        )
      );
      setSubmissionState('error');
      return;
    }

    try {
      const result = await submissionGuard.current.run(() =>
        submitPublisherPost({
          fetcher: fetch,
          payload,
          integrations: selectedIntegrations,
          shortlinkPreference: shortlinkPreferenceData?.shortlink || 'ASK',
          confirmShortlink: () =>
            window.confirm(
              'Deseja encurtar os links? Isso permite acompanhar estatísticas de cliques.'
            ),
          onPostStarted: () => setSubmissionState('submitting'),
        })
      );

      setAcceptedSubmission(result);
      setSubmissionState('accepted');
      if (payload.type === 'schedule') {
        void mutateCache('/posts/list?state=scheduled&page=0&limit=5');
      }
      scrollContainer.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setSubmissionError(
        error instanceof PublisherSubmissionError
          ? error
          : new PublisherSubmissionError(
              'Ocorreu um erro inesperado. O formulário foi preservado.',
              'unexpected'
            )
      );
      setSubmissionState('error');
    }
  }, [
    content,
    fetch,
    media,
    mode,
    mutateCache,
    payload,
    scheduleDate,
    scheduleTime,
    selectedIntegrations,
    settingsByIntegration,
    shortlinkPreferenceData?.shortlink,
    uploadStatus.hasErrors,
    uploadStatus.uploading,
  ]);

  const scheduleLabel =
    mode === 'now'
      ? 'Agora'
      : `${scheduleDate.split('-').reverse().join('/')} às ${scheduleTime}`;

  return (
    <div
      ref={scrollContainer}
      className="flex min-h-0 w-full flex-1 overflow-y-auto bg-newBgColor"
    >
      <div className="mx-auto min-h-full w-full max-w-[430px] bg-newBgColor pb-[calc(5rem+env(safe-area-inset-bottom))] shadow-[0_0_40px_rgba(0,0,0,0.06)]">
        <header className="flex items-center gap-3 px-5 pb-5 pt-6">
          <Link
            href="/publish"
            aria-label="Voltar para o início"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-newTableBorder bg-newBgColorInner text-xl text-newTextColor"
          >
            ←
          </Link>
          <div>
            <p className="text-xs font-semibold text-textItemBlur">
              TrendPostiz Publisher
            </p>
            <p className="text-xl font-bold tracking-[-0.02em] text-newTextColor">
              Nova publicação
            </p>
          </div>
        </header>

        {payload ? (
          <PublishReview
            payload={payload}
            accounts={selectedIntegrations}
            content={content}
            scheduleLabel={scheduleLabel}
            state={submissionState}
            error={submissionError}
            accepted={acceptedSubmission}
            onSubmit={() => void submit()}
            onBack={() => {
              setSubmissionState('idle');
              setSubmissionError(undefined);
              setAcceptedSubmission(undefined);
              setPayload(undefined);
              scrollContainer.current?.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        ) : (
          <main className="space-y-8 px-5 pb-28">
            <AccountPicker
              accounts={accounts}
              selectedIds={selectedIds}
              loading={isLoading}
              error={accountsError}
              onRetry={() => void mutate()}
              onToggle={toggleIntegration}
              validationError={errors.accounts}
            />

            <section aria-labelledby="publisher-content-title">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-btnPrimary">
                Etapa 2
              </p>
              <div className="mt-1 flex items-end justify-between gap-3">
                <h2
                  id="publisher-content-title"
                  className="text-lg font-bold text-newTextColor"
                >
                  Escreva o conteúdo
                </h2>
                <span
                  className={`text-xs font-semibold ${
                    strictestLimit && content.length > strictestLimit
                      ? 'text-red-500'
                      : 'text-textItemBlur'
                  }`}
                >
                  {content.length}
                  {strictestLimit ? ` / ${strictestLimit}` : ''}
                </span>
              </div>
              <textarea
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  setErrors((current) => ({ ...current, content: undefined }));
                }}
                rows={7}
                placeholder="O que você quer compartilhar?"
                className="mt-3 w-full resize-y rounded-2xl border border-newTableBorder bg-newBgColorInner p-4 text-base leading-6 text-newTextColor outline-none placeholder:text-textItemBlur focus:border-btnPrimary"
              />
              {errors.content ? (
                <p className="mt-2 text-xs font-medium text-red-500">
                  {errors.content}
                </p>
              ) : null}
            </section>

            <MediaUploader
              onChange={changeMedia}
              onStatusChange={changeUploadStatus}
              validationError={errors.media}
            />

            <ProviderSettings
              integrations={selectedIntegrations}
              settingsByIntegration={settingsByIntegration}
              onChange={changeProviderSetting}
              validationError={errors.settings}
            />

            <section aria-labelledby="publisher-mode-title">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-btnPrimary">
                Etapa 4
              </p>
              <h2
                id="publisher-mode-title"
                className="mt-1 text-lg font-bold text-newTextColor"
              >
                Quando publicar?
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {(['now', 'schedule'] as PublisherMode[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setMode(item);
                      setErrors((current) => ({
                        ...current,
                        schedule: undefined,
                      }));
                    }}
                    aria-pressed={mode === item}
                    className={`min-h-14 rounded-2xl border px-3 text-sm font-bold ${
                      mode === item
                        ? 'border-btnPrimary bg-btnPrimary/10 text-btnPrimary'
                        : 'border-newTableBorder bg-newBgColorInner text-newTextColor'
                    }`}
                  >
                    {item === 'now' ? 'Publicar agora' : 'Agendar'}
                  </button>
                ))}
              </div>

              {mode === 'schedule' ? (
                <div className="mt-3 grid grid-cols-2 gap-3 rounded-2xl border border-newTableBorder bg-newBgColorInner p-4">
                  <label className="text-xs font-semibold text-newTextColor">
                    Data
                    <input
                      type="date"
                      value={scheduleDate}
                      onChange={(event) => {
                        setScheduleDate(event.target.value);
                        setErrors((current) => ({
                          ...current,
                          schedule: undefined,
                        }));
                      }}
                      className="mt-2 min-h-12 w-full rounded-xl border border-newTableBorder bg-newTableHeader px-2 text-sm text-newTextColor outline-none focus:border-btnPrimary"
                    />
                  </label>
                  <label className="text-xs font-semibold text-newTextColor">
                    Horário
                    <input
                      type="time"
                      value={scheduleTime}
                      onChange={(event) => {
                        setScheduleTime(event.target.value);
                        setErrors((current) => ({
                          ...current,
                          schedule: undefined,
                        }));
                      }}
                      className="mt-2 min-h-12 w-full rounded-xl border border-newTableBorder bg-newTableHeader px-2 text-sm text-newTextColor outline-none focus:border-btnPrimary"
                    />
                  </label>
                </div>
              ) : null}
              {errors.schedule ? (
                <p className="mt-2 text-xs font-medium text-red-500">
                  {errors.schedule}
                </p>
              ) : null}
            </section>

            <div className="sticky bottom-20 z-20 rounded-2xl bg-newBgColor/95 pt-2 backdrop-blur">
              <button
                type="button"
                onClick={review}
                className="min-h-14 w-full rounded-2xl bg-btnPrimary px-5 text-base font-bold text-white shadow-[0_10px_24px_rgba(97,43,211,0.25)] active:scale-[0.98]"
              >
                Revisar publicação
              </button>
              <p className="mt-2 text-center text-[10px] text-textItemBlur">
                Você confirmará o envio na próxima etapa.
              </p>
            </div>
          </main>
        )}

        <BottomNavigation />
      </div>
    </div>
  );
}
