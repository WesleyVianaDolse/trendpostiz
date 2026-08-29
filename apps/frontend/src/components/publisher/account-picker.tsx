'use client';

import {
  getProviderRule,
} from '@gitroom/frontend/features/publisher/model/provider-rules';
import { PublisherIntegration } from '@gitroom/frontend/features/publisher/model/publisher.types';

interface AccountPickerProps {
  accounts: PublisherIntegration[];
  selectedIds: string[];
  loading: boolean;
  error?: Error;
  onRetry: () => void;
  onToggle: (integration: PublisherIntegration) => void;
  validationError?: string;
}

export function AccountPicker({
  accounts,
  selectedIds,
  loading,
  error,
  onRetry,
  onToggle,
  validationError,
}: AccountPickerProps) {
  return (
    <section aria-labelledby="publisher-account-picker-title">
      <div className="mb-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-btnPrimary">
          Etapa 1
        </p>
        <h2 id="publisher-account-picker-title" className="mt-1 text-lg font-bold text-newTextColor">
          Selecione as contas
        </h2>
        <p className="mt-1 text-sm text-textItemBlur">Você pode publicar em mais de uma conta.</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3" aria-label="Carregando contas">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-2xl bg-newTableHeader" />
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-newTextColor" role="alert">
          <p>Não foi possível carregar as contas.</p>
          <button type="button" onClick={onRetry} className="mt-2 font-semibold text-btnPrimary">
            Tentar novamente
          </button>
        </div>
      ) : null}

      {!loading && !error && accounts.length === 0 ? (
        <div className="rounded-2xl border border-newTableBorder bg-newBgColorInner p-4 text-sm text-textItemBlur">
          Nenhuma conta social disponível nesta organização.
        </div>
      ) : null}

      {!loading && !error && accounts.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {accounts.map((account) => {
            const rule = getProviderRule(account.identifier);
            const reconnect = Boolean(account.refreshNeeded);
            const unavailable = reconnect || !rule.supported;
            const selected = selectedIds.includes(account.id);
            const status = reconnect
              ? 'Reconexão necessária'
              : !rule.supported
              ? 'Disponível em fase futura'
              : selected
              ? 'Selecionada'
              : 'Disponível';
            const reason = reconnect
              ? 'Reconecte esta conta nas integrações.'
              : rule.unavailableReason;

            return (
              <button
                key={account.id}
                type="button"
                disabled={unavailable}
                onClick={() => onToggle(account)}
                aria-pressed={selected}
                className={`min-h-28 rounded-2xl border p-3 text-left transition-colors ${
                  selected
                    ? 'border-btnPrimary bg-btnPrimary/10'
                    : 'border-newTableBorder bg-newBgColorInner'
                } ${unavailable ? 'cursor-not-allowed opacity-65' : 'active:scale-[0.98]'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  {account.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={account.picture} alt="" className="h-9 w-9 rounded-full bg-newTableHeader object-cover" />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-newTableHeader text-sm font-bold text-newTextColor">
                      {(account.name || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className={`mt-1 h-3 w-3 rounded-full border-2 border-newBgColorInner ${unavailable ? 'bg-amber-400' : selected ? 'bg-btnPrimary' : 'bg-emerald-500'}`} />
                </div>
                <p className="mt-2 truncate text-sm font-bold text-newTextColor">{account.name}</p>
                <p className="truncate text-[11px] text-textItemBlur">{account.display || account.identifier}</p>
                <p className={`mt-1 text-[10px] font-semibold leading-4 ${unavailable ? 'text-amber-500' : selected ? 'text-btnPrimary' : 'text-textItemBlur'}`}>
                  {status}
                </p>
                {unavailable && reason ? (
                  <span className="mt-1 line-clamp-2 block text-[9px] leading-3 text-textItemBlur">{reason}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {validationError ? <p className="mt-2 text-xs font-medium text-red-500">{validationError}</p> : null}
    </section>
  );
}
