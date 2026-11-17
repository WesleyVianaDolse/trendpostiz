'use client';

import { useCallback, useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

type Occurrence = {
  id: string;
  scheduledAt: string;
  revision: number;
  automaticOutcome: string;
  failureReason?: string;
  evidence: {
    origin: string;
    remoteId?: string;
    remoteUrl?: string;
    confirmedAt: string;
  }[];
  attempts: { phase: string; failureReason?: string }[];
  derivedActions?: {
    id: string;
    method: string;
    phase: string;
    reason?: string;
  }[];
  completionActions?: { actionKey: string; phase: string }[];
};
const outcomes: Record<string, string> = {
  EXPIRED: 'Falhou por vencimento',
  FAILED: 'Falha da publicação automática',
  CONFIRMED: 'Publicação automática confirmada',
  PENDING: 'Pendente',
  UNCERTAIN: 'Resultado sem confirmação; novo envio bloqueado',
};

export function PublicationRecoveryHistory({ postId }: { postId: string }) {
  const fetcher = useFetch();
  const [occurrenceId, setOccurrence] = useState(''),
    [remoteId, setRemoteId] = useState(''),
    [remoteUrl, setRemoteUrl] = useState('');
  const [attested, setAttested] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const requestId = useRef<string | undefined>(undefined);
  const url = `/posts/${encodeURIComponent(postId)}/recovery-history`;
  const load = useCallback(async () => {
    const response = await fetcher(url);
    if (!response.ok) throw Error('Não foi possível consultar a conciliação.');
    return response.json();
  }, [fetcher, url]);
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR<{
    canConfirmManual: boolean;
    occurrences: Occurrence[];
    inventoryIssues?: {
      subjectKey: string;
      decision: string;
      reason: string;
    }[];
  }>(url, load);
  const confirm = async () => {
    setBusy(true);
    setError('');
    requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetcher(
        `/posts/${encodeURIComponent(postId)}/manual-publication-confirmation`,
        {
          method: 'POST',
          body: JSON.stringify({
            occurrenceId,
            remoteId,
            remoteUrl,
            requestId: requestId.current,
            attestation: 'CONFIRM_MANUAL_PUBLICATION',
          }),
        }
      );
      if (!response.ok) {
        const body = await response.json();
        throw Error(body.message || 'Confirmação não registrada.');
      }
      await mutate();
      setOccurrence('');
      setAttested(false);
      requestId.current = undefined;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Confirmação não registrada.'
      );
    } finally {
      setBusy(false);
    }
  };
  if (!data?.occurrences.length && !data?.inventoryIssues?.length && !loadError)
    return null;
  return (
    <section
      className="mt-3 space-y-2 rounded-xl border border-newTableBorder p-3 text-sm"
      aria-label="Conciliação da publicação"
    >
      <p className="font-semibold">Histórico e conciliação</p>
      {data?.inventoryIssues
        ?.filter((i) => i.decision === 'RETAIN')
        .map((i, index) => (
          <p key={`${i.subjectKey}:${index}`}>
            Prévia de recuperação:{' '}
            {i.reason === 'RECURRENCE_ANCHOR_UNRESOLVED'
              ? 'recorrência retida; horário de origem não comprovado. A série foi preservada.'
              : 'item retido para revisão, sem autorização de envio.'}
          </p>
        ))}
      {loadError && <p role="alert">Não foi possível consultar o histórico.</p>}
      {data?.occurrences.map((o) => (
        <div key={o.id} className="border-b border-newTableBorder pb-2">
          <p>
            {new Date(o.scheduledAt).toLocaleString()} · revisão {o.revision}
          </p>
          <p>
            Automação:{' '}
            {o.attempts.some((a) => ['UNCERTAIN', 'CLAIMED'].includes(a.phase))
              ? 'Resultado sem confirmação; novo envio bloqueado'
              : o.automaticOutcome === 'PENDING' &&
                o.evidence.some((e) => e.origin === 'manual')
              ? 'Envio automático retido após confirmação manual'
              : outcomes[o.automaticOutcome] || 'Retida para análise'}
          </p>
          {o.automaticOutcome === 'EXPIRED' && (
            <p>Verifique se o conteúdo foi publicado manualmente.</p>
          )}
          {o.derivedActions?.map((action) => (
            <p key={action.id}>
              Ação adicional ({action.method}):{' '}
              {action.phase === 'CONFIRMED'
                ? 'efeito confirmado'
                : action.phase === 'NOT_EXECUTED'
                ? 'condição não atingida; sem envio'
                : action.phase === 'UNCERTAIN'
                ? 'resultado incerto; reenvio bloqueado — requer conciliação'
                : action.phase === 'EXPIRED'
                ? 'suprimida por vencimento'
                : action.phase === 'RETAINED'
                ? 'retida para conciliação'
                : 'agendada'}
            </p>
          ))}
          {o.completionActions?.map((action) => (
            <p key={action.actionKey}>
              Notificações e webhooks ({action.actionKey}):{' '}
              {action.phase === 'ACKNOWLEDGED'
                ? 'processamento confirmado pelo serviço'
                : 'resultado não confirmado; repetição automática bloqueada'}
            </p>
          ))}
          {o.evidence
            .filter((e) => e.origin === 'manual')
            .map((e, i) => (
              <p key={i}>
                Publicação manual: confirmada pela equipe em{' '}
                {new Date(e.confirmedAt).toLocaleString()}
                {e.remoteUrl && (
                  <>
                    {' '}
                    ·{' '}
                    <a
                      className="underline"
                      href={e.remoteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Ver publicação
                    </a>
                  </>
                )}
              </p>
            ))}
          {data.canConfirmManual && (
            <button
              type="button"
              className="underline"
              disabled={busy}
              onClick={() => {
                setOccurrence(o.id);
                setAttested(false);
                setRemoteId('');
                setRemoteUrl('');
                requestId.current = undefined;
              }}
            >
              Registrar confirmação manual
            </button>
          )}
        </div>
      ))}
      {occurrenceId && (
        <div className="space-y-2">
          <p>
            Confirme somente após conferir a publicação na rede. O resultado
            automático e qualquer tentativa incerta serão preservados.
          </p>
          <label className="block">
            Identificador público
            <input
              className="block w-full bg-transparent border"
              value={remoteId}
              maxLength={2048}
              onChange={(e) => {
                setRemoteId(e.target.value);
                requestId.current = undefined;
              }}
            />
          </label>
          <label className="block">
            Link público HTTPS
            <input
              className="block w-full bg-transparent border"
              type="url"
              value={remoteUrl}
              maxLength={2048}
              onChange={(e) => {
                setRemoteUrl(e.target.value);
                requestId.current = undefined;
              }}
            />
          </label>
          <label className="block">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />{' '}
            Conferi e confirmo que a equipe publicou este conteúdo manualmente.
          </label>
          <button
            type="button"
            disabled={
              busy || !attested || !remoteId.trim() || !remoteUrl.trim()
            }
            onClick={confirm}
          >
            Registrar confirmação
          </button>
          <button
            type="button"
            className="ml-3"
            disabled={busy}
            onClick={() => setOccurrence('')}
          >
            Cancelar
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
