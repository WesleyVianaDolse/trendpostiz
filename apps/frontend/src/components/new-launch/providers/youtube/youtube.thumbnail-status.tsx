'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

const labels: Record<string, string> = {
  pending: 'Capa pendente: aguardando processamento',
  retrying: 'Capa pendente: nova tentativa agendada',
  applying: 'Enviando capa',
  applied: 'Capa enviada ao YouTube',
  failed: 'Não foi possível enviar a capa',
  waiting: 'Capa pendente: tentativas automáticas encerradas',
  uncertain: 'Envio da capa não confirmado',
};

export function YoutubeThumbnailStatus({ postId }: { postId: string }) {
  const fetcher = useFetch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = `/posts/${encodeURIComponent(postId)}/youtube-thumbnail`;
  const load = useCallback(async () => {
    const response = await fetcher(url);
    if (!response.ok)
      throw new Error('Não foi possível consultar o estado da capa.');
    return response.json();
  }, [fetcher, url]);
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR(url, load, { refreshInterval: 15000 });
  const retry = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetcher(`${url}/retry`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.message || 'Não foi possível solicitar uma nova tentativa.'
        );
      await mutate();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Falha ao reenviar capa.'
      );
    } finally {
      setBusy(false);
    }
  };
  if (!data?.status && !loadError) return null;
  return (
    <div
      className="mt-3 space-y-2 rounded-xl border border-newTableBorder p-3 text-xs"
      aria-live="polite"
    >
      <p className="font-semibold">
        {labels[data?.status] || 'Estado da capa indisponível'}
      </p>
      {data?.error && <p>{data.error}</p>}
      {data?.nextAttemptAt && (
        <p>
          {data.status === 'waiting'
            ? 'Nova tentativa permitida após: '
            : 'Próxima tentativa: '}
          {new Date(data.nextAttemptAt).toLocaleString()}
        </p>
      )}
      {data?.videoId && (
        <a
          className="underline"
          href={`https://www.youtube.com/watch?v=${encodeURIComponent(
            data.videoId
          )}`}
          target="_blank"
          rel="noreferrer"
        >
          Conferir vídeo no YouTube
        </a>
      )}
      {data?.canRetry && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void retry()}
          className="block min-h-11 rounded-lg border border-newTableBorder px-3 disabled:opacity-50"
        >
          {busy ? 'Solicitando…' : 'Tentar enviar somente a capa novamente'}
        </button>
      )}
      {data?.status === 'uncertain' && (
        <p>
          Confira a capa no YouTube antes de reenviar. Uma nova tentativa pode
          consumir quota novamente.
        </p>
      )}
      {(error || loadError) && <p role="alert">{error || loadError.message}</p>}
    </div>
  );
}
