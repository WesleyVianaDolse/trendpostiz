'use client';

import { useId, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  CustomerAccount,
  getNetworkName,
  groupAccounts,
  sortAccounts,
} from './helpers/integration-groups';

interface CustomerAccountPickerProps<T extends CustomerAccount> {
  accounts: T[];
  selectedIds: string[];
  onToggle: (account: T) => void;
  locked?: boolean;
  getUnavailableReason?: (account: T) => string | undefined;
}

export function CustomerAccountPicker<T extends CustomerAccount>({
  accounts,
  selectedIds,
  onToggle,
  locked,
  getUnavailableReason,
}: CustomerAccountPickerProps<T>) {
  const t = useT();
  const fieldId = useId();
  const [customer, setCustomer] = useState('all');
  const groups = useMemo(() => groupAccounts(accounts), [accounts]);
  const selected = sortAccounts(
    accounts.filter((account) => selectedIds.includes(account.id))
  );
  const activeCustomer = groups.some((group) => group.id === customer)
    ? customer
    : 'all';
  const visible = groups.filter(
    (group) => activeCustomer === 'all' || group.id === activeCustomer
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label
            htmlFor={fieldId}
            className="text-xs font-semibold text-textItemBlur"
          >
            {t('customer_profiles_client', 'Client')}
          </label>
          <select
            id={fieldId}
            value={activeCustomer}
            onChange={(event) => setCustomer(event.target.value)}
            className="h-10 w-full rounded-lg border border-newTableBorder bg-newBgColorInner px-3 text-sm text-newTextColor focus:border-btnPrimary focus-visible:ring-2 focus-visible:ring-btnPrimary"
          >
            <option value="all">
              {t('customer_profiles_all', 'All clients')}
            </option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name || t('customer_profiles_unassigned', 'No client')} (
                {group.values.length})
              </option>
            ))}
          </select>
        </div>
        <span className="pb-2 text-xs text-textItemBlur" role="status">
          {t('customer_profiles_selection', 'Selected profiles')}:{' '}
          {selected.length}
        </span>
      </div>
      {selected.length > 0 && (
        <div
          className="flex flex-wrap gap-2"
          aria-label={t('customer_profiles_selection', 'Selected profiles')}
        >
          {selected.map((account) => (
            <button
              key={account.id}
              type="button"
              disabled={locked}
              onClick={() => onToggle(account)}
              aria-label={`${t('remove', 'Remove')}: ${
                account.name
              } · ${getNetworkName(account.identifier)}`}
              className="flex max-w-full items-center gap-2 rounded-lg border border-newTableBorder bg-btnSimple px-2.5 py-1.5 text-xs text-newTextColor disabled:cursor-default"
            >
              <span className="truncate">
                {account.customer?.name &&
                  account.customer.name
                    .trim()
                    .localeCompare(account.name.trim(), 'pt-BR', {
                      sensitivity: 'base',
                    }) !== 0 &&
                  `${account.customer.name} · `}
                {account.name} · {getNetworkName(account.identifier)}
              </span>
              {!locked && <span aria-hidden="true">×</span>}
            </button>
          ))}
        </div>
      )}
      {visible.map((group) => (
        <div key={group.id} className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-textItemBlur">
            <span>
              {group.name || t('customer_profiles_unassigned', 'No client')}
            </span>
            <span className="rounded-md bg-btnSimple px-1.5 py-0.5 text-[10px]">
              {group.values.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 mobile:grid-cols-1">
            {group.values.map((account) => {
              const active = selectedIds.includes(account.id);
              const reason =
                getUnavailableReason?.(account) ||
                (account.refreshNeeded
                  ? t(
                      'customer_profiles_reconnect',
                      'Reconnect this account to publish.'
                    )
                  : account.disabled || account.inBetweenSteps
                  ? t(
                      'customer_profiles_unavailable',
                      'This account is unavailable for publishing.'
                    )
                  : undefined);
              return (
                <button
                  key={account.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${account.name} · ${getNetworkName(
                    account.identifier
                  )}`}
                  disabled={locked || Boolean(reason)}
                  onClick={() => onToggle(account)}
                  title={`${account.name} · ${getNetworkName(
                    account.identifier
                  )}${reason ? ` — ${reason}` : ''}`}
                  className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 text-start transition-colors focus-visible:ring-2 focus-visible:ring-btnPrimary ${
                    active
                      ? 'border-btnPrimary bg-newSettings'
                      : 'border-newTableBorder bg-newBgColorInner hover:bg-boxHover'
                  } ${reason ? 'opacity-50' : ''} disabled:cursor-default`}
                >
                  <div className="relative h-10 w-10 shrink-0">
                    <img
                      src={account.picture || '/no-picture.jpg'}
                      alt=""
                      onError={(event) => {
                        if (
                          event.currentTarget.getAttribute('src') !==
                          '/no-picture.jpg'
                        ) {
                          event.currentTarget.src = '/no-picture.jpg';
                        }
                      }}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                    <img
                      src={`/icons/platforms/${
                        account.identifier === 'youtube'
                          ? 'youtube.svg'
                          : `${account.identifier}.png`
                      }`}
                      alt=""
                      className="absolute -bottom-0.5 -end-0.5 h-4 w-4 rounded bg-newBgColorInner"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-newTextColor">
                      {account.name}
                    </div>
                    <div className="mt-0.5 text-xs text-textItemBlur">
                      {getNetworkName(account.identifier)}
                    </div>
                    {reason && (
                      <div className="mt-1 text-xs text-amber-500">
                        {reason}
                      </div>
                    )}
                  </div>
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                      active
                        ? 'border-btnPrimary bg-btnPrimary text-white'
                        : 'border-newTableBorder'
                    }`}
                  >
                    {active ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
