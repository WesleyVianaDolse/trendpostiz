'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

interface PublisherIntegration {
  id: string;
  name: string;
  display?: string;
  picture?: string;
  identifier?: string;
  disabled?: boolean;
  inBetweenSteps?: boolean;
  refreshNeeded?: boolean;
}

interface IntegrationsResponse {
  integrations?: PublisherIntegration[];
}

function AccountSkeleton() {
  return (
    <div className="flex gap-3" aria-label="Carregando contas">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-[76px] w-[112px] shrink-0 animate-pulse rounded-2xl bg-newTableHeader" />
      ))}
    </div>
  );
}

export function AccountSummary() {
  const fetch = useFetch();
  const loadAccounts = useCallback(
    async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Não foi possível carregar as contas.');
      return (await response.json()) as IntegrationsResponse;
    },
    [fetch]
  );
  const { data, error, isLoading, mutate } = useSWR(
    '/integrations/list',
    loadAccounts,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
  const accounts = (data?.integrations || []).filter(
    (account) => !account.disabled && !account.inBetweenSteps
  );

  return (
    <section aria-labelledby="publisher-accounts-title">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="publisher-accounts-title" className="text-base font-bold text-newTextColor">
            Contas sociais
          </h2>
          <p className="mt-0.5 text-xs text-textItemBlur">Conectadas à organização atual</p>
        </div>
        {!isLoading && !error ? (
          <span className="text-xs font-semibold text-textItemBlur">{accounts.length}</span>
        ) : null}
      </div>

      {isLoading ? <AccountSkeleton /> : null}

      {error ? (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-newTextColor" role="alert">
          <p>Não foi possível carregar as contas.</p>
          <button type="button" onClick={() => void mutate()} className="mt-2 font-semibold text-btnPrimary">
            Tentar novamente
          </button>
        </div>
      ) : null}

      {!isLoading && !error && accounts.length === 0 ? (
        <div className="rounded-2xl border border-newTableBorder bg-newBgColorInner p-4 text-sm text-textItemBlur">
          Nenhuma conta social disponível nesta organização.
        </div>
      ) : null}

      {!isLoading && !error && accounts.length > 0 ? (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 scrollbar-none">
          {accounts.map((account) => (
            <article key={account.id} className="w-[124px] shrink-0 rounded-2xl border border-newTableBorder bg-newBgColorInner p-3">
              <div className="flex items-center gap-2">
                {account.picture ? (
                  // Provider avatars can come from domains configured by each integration.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={account.picture} alt="" className="h-9 w-9 rounded-full bg-newTableHeader object-cover" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-newTableHeader text-sm font-bold text-newTextColor">
                    {(account.name || account.display || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <span className={`h-2.5 w-2.5 rounded-full ${account.refreshNeeded ? 'bg-amber-400' : 'bg-emerald-500'}`} aria-hidden="true" />
              </div>
              <p className="mt-2 truncate text-sm font-semibold text-newTextColor">{account.name || account.display}</p>
              <p className={`mt-0.5 text-[10px] font-medium leading-tight ${account.refreshNeeded ? 'text-amber-500' : 'text-textItemBlur'}`}>
                {account.refreshNeeded ? 'Reconexão necessária' : account.identifier || 'Disponível'}
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
