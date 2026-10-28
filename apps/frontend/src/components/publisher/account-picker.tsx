'use client';

import { getProviderRule } from '@gitroom/frontend/features/publisher/model/provider-rules';
import { PublisherIntegration } from '@gitroom/frontend/features/publisher/model/publisher.types';
import { CustomerAccountPicker } from '../launches/customer-account-picker';

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
        <h2
          id="publisher-account-picker-title"
          className="mt-1 text-lg font-bold text-newTextColor"
        >
          Selecione as contas
        </h2>
        <p className="mt-1 text-sm text-textItemBlur">
          Você pode publicar em mais de uma conta.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3" aria-label="Carregando contas">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-28 animate-pulse rounded-2xl bg-newTableHeader"
            />
          ))}
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-newTextColor"
          role="alert"
        >
          <p>Não foi possível carregar as contas.</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 font-semibold text-btnPrimary"
          >
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
        <CustomerAccountPicker
          accounts={accounts}
          selectedIds={selectedIds}
          onToggle={onToggle}
          getUnavailableReason={(account) => {
            const rule = getProviderRule(account.identifier);
            return account.refreshNeeded
              ? 'Reconecte esta conta nas integrações.'
              : !rule.supported
              ? rule.unavailableReason || 'Disponível em fase futura'
              : undefined;
          }}
        />
      ) : null}

      {validationError ? (
        <p className="mt-2 text-xs font-medium text-red-500">
          {validationError}
        </p>
      ) : null}
    </section>
  );
}
