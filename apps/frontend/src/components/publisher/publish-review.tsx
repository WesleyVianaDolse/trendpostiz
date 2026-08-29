'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  PublisherAcceptedSubmission,
  PublisherIntegration,
  PublisherPostPayload,
  PublisherSubmissionState,
} from '@gitroom/frontend/features/publisher/model/publisher.types';
import {
  isPublisherSubmissionBusy,
  PublisherSubmissionError,
} from '@gitroom/frontend/features/publisher/submission/publisher-submission';
import { isVideoMedia } from '@gitroom/frontend/features/publisher/media/media-validation';

interface PublishReviewProps {
  payload: PublisherPostPayload;
  accounts: PublisherIntegration[];
  content: string;
  scheduleLabel: string;
  state: PublisherSubmissionState;
  error?: PublisherSubmissionError;
  accepted?: PublisherAcceptedSubmission;
  onBack: () => void;
  onSubmit: () => void;
}

export function PublishReview({
  payload,
  accounts,
  content,
  scheduleLabel,
  state,
  error,
  accepted,
  onBack,
  onSubmit,
}: PublishReviewProps) {
  const [confirmed, setConfirmed] = useState(false);
  const busy = isPublisherSubmissionBusy(state);
  const submitLabel = payload.type === 'now' ? 'Publicar agora' : 'Agendar publicação';

  if (state === 'accepted' && accepted) {
    return (
      <main className="space-y-5 px-5 pb-28" aria-live="polite">
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5" role="status">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-600">Solicitação aceita</p>
          <h1 className="mt-2 text-2xl font-bold tracking-[-0.02em] text-newTextColor">
            {payload.type === 'now' ? 'Enviado para publicação' : 'Publicação agendada'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-textItemBlur">
            {payload.type === 'now'
              ? 'O processamento foi iniciado. A publicação na rede social ainda não está confirmada.'
              : `Agendada para ${scheduleLabel}, no seu horário local.`}
          </p>
          <p className="mt-3 text-xs text-textItemBlur">
            {accepted.posts.length} {accepted.posts.length === 1 ? 'post aceito' : 'posts aceitos'} pelo backend.
          </p>
        </section>

        <Link href="/publish" className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-btnPrimary px-5 text-base font-bold text-white">
          Voltar ao Publisher
        </Link>
      </main>
    );
  }

  return (
    <main className="space-y-5 px-5 pb-28">
      <section>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-500">Confirmação final</p>
        <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em] text-newTextColor">Revise a publicação</h1>
        <p className="mt-2 text-sm leading-5 text-textItemBlur">O envio só começa depois da sua confirmação abaixo.</p>
      </section>

      <section className="rounded-2xl border border-newTableBorder bg-newBgColorInner p-4">
        <div className="flex items-center justify-between gap-3 border-b border-newTableBorder pb-3">
          <span className="text-xs text-textItemBlur">Modo</span>
          <span className="text-sm font-bold text-newTextColor">{payload.type === 'now' ? 'Publicar agora' : 'Agendar'}</span>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-newTableBorder py-3">
          <span className="text-xs text-textItemBlur">Quando</span>
          <span className="text-right text-sm font-semibold text-newTextColor">{scheduleLabel}</span>
        </div>
        <div className="py-3">
          <span className="text-xs text-textItemBlur">Contas e redes</span>
          <div className="mt-2 space-y-2">
            {accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-3 rounded-xl bg-newTableHeader px-3 py-2">
                <span className="min-w-0 truncate text-xs font-semibold text-newTextColor">{account.name}</span>
                <span className="shrink-0 text-[11px] text-textItemBlur">{account.display || account.identifier}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-newTableBorder pt-3">
          <span className="text-xs text-textItemBlur">Conteúdo</span>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-newTextColor">{content}</p>
        </div>
        {payload.posts[0]?.value[0]?.image.length ? (
          <div className="mt-3 border-t border-newTableBorder pt-3">
            <span className="text-xs text-textItemBlur">Mídia</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {payload.posts[0].value[0].image.map((media) =>
                isVideoMedia(media) ? (
                  <video key={media.id} src={media.path} className="aspect-square w-full rounded-xl bg-black object-cover" muted playsInline controls />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={media.id} src={media.path} alt={media.alt || 'Mídia da publicação'} className="aspect-square w-full rounded-xl bg-newTableHeader object-cover" />
                )
              )}
            </div>
          </div>
        ) : null}
      </section>

      {process.env.NODE_ENV !== 'production' ? (
        <details className="rounded-2xl border border-dashed border-newTableBorder bg-newBgColorInner p-4">
          <summary className="cursor-pointer text-sm font-bold text-newTextColor">Inspecionar payload de desenvolvimento</summary>
          <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-newTableHeader p-3 text-[11px] leading-5 text-newTextColor">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </details>
      ) : null}

      {error ? (
        <div className={`${error.ambiguous ? 'border-amber-500/30 bg-amber-500/10' : 'border-red-500/30 bg-red-500/10'} rounded-2xl border p-4`} role="alert">
          <p className="text-sm font-bold text-newTextColor">Não foi possível confirmar o envio</p>
          <p className="mt-1 text-xs leading-5 text-textItemBlur">{error.message}</p>
        </div>
      ) : null}

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-newTableBorder bg-newBgColorInner p-4">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 h-5 w-5 accent-[var(--btn-primary)]"
        />
        <span className="text-xs leading-5 text-newTextColor">Revisei contas, rede, conteúdo, mídia e horário e confirmo este envio.</span>
      </label>

      {!error?.ambiguous ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={!confirmed || busy}
          aria-disabled={!confirmed || busy}
          className="min-h-14 w-full rounded-2xl bg-btnPrimary px-5 text-base font-bold text-white shadow-[0_10px_24px_rgba(97,43,211,0.25)] disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
        >
          {state === 'validating' ? 'Validando…' : state === 'submitting' ? 'Enviando…' : submitLabel}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className="min-h-14 w-full rounded-2xl border border-newTableBorder bg-newBgColorInner px-5 text-base font-bold text-newTextColor disabled:opacity-50 active:scale-[0.98]"
      >
        Voltar e editar
      </button>
    </main>
  );
}
