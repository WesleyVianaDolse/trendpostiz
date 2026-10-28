'use client';

import { useId, useMemo, useState } from 'react';
import { useSWRConfig } from 'swr';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useCustomers } from './helpers/use.customers';
import {
  CustomerAccount,
  getNetworkName,
  sortAccounts,
} from './helpers/integration-groups';

export function CustomerModal({
  integration,
  integrations,
  onClose,
}: {
  integration?: CustomerAccount;
  integrations?: CustomerAccount[];
  onClose: () => void;
}) {
  const t = useT();
  const fetch = useFetch();
  const modal = useModals();
  const { mutate } = useSWRConfig();
  const {
    data: customers,
    error: loadError,
    mutate: reloadCustomers,
  } = useCustomers();
  const listId = useId();
  const accounts = useMemo(
    () => sortAccounts(integrations || (integration ? [integration] : [])),
    [integration, integrations]
  );
  const [customer, setCustomer] = useState(integration?.customer?.name || '');
  const [selectedIds, setSelectedIds] = useState(
    integration ? [integration.id] : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function saveCustomer(remove = false) {
    const name = customer.trim();
    if (saving || !selectedIds.length || (!remove && !name)) return;
    setSaving(true);
    setError('');
    const remaining = [...selectedIds];
    let saved = 0;
    try {
      // Reuse the existing endpoint sequentially so new clients are created once.
      for (const id of selectedIds) {
        const response = await fetch(
          `/integrations/${encodeURIComponent(id)}/customer-name`,
          {
            method: 'PUT',
            body: JSON.stringify({ name: remove ? '' : name }),
          }
        );
        if (!response.ok) throw new Error('Client assignment failed');
        remaining.shift();
        saved++;
      }
      await Promise.allSettled([
        mutate('/integrations/list'),
        mutate('/integrations/customers'),
      ]);
      onClose();
      modal.closeCurrent();
    } catch {
      setSelectedIds(remaining);
      if (saved)
        await Promise.allSettled([
          mutate('/integrations/list'),
          mutate('/integrations/customers'),
        ]);
      setError(
        t(
          'customer_profiles_save_error',
          'Could not save every account. Completed changes were kept; retry the remaining selected accounts.'
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <p className="text-sm text-textItemBlur">
        {t(
          'customer_profiles_manage_help',
          'Choose a client or enter a new name, then select the accounts to assign.'
        )}
      </p>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={listId}
          className="text-sm font-semibold text-newTextColor"
        >
          {t('customer_profiles_client', 'Client')}
        </label>
        <input
          id={listId}
          list={`${listId}-options`}
          value={customer}
          onChange={(event) => setCustomer(event.target.value)}
          disabled={saving}
          placeholder={t('customer_profiles_client_placeholder', 'Client name')}
          className="h-11 rounded-lg border border-newTableBorder bg-newBgColorInner px-3 text-sm text-newTextColor focus:border-btnPrimary focus-visible:ring-2 focus-visible:ring-btnPrimary"
        />
        <datalist id={`${listId}-options`}>
          {[...(customers || [])]
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
            .map((item) => (
              <option key={item.id} value={item.name} />
            ))}
        </datalist>
        {loadError && (
          <p role="alert" className="text-xs text-amber-500">
            {t(
              'customer_profiles_load_error',
              'Could not load existing clients.'
            )}{' '}
            <button
              type="button"
              onClick={() => reloadCustomers()}
              className="underline"
            >
              {t('retry', 'Retry')}
            </button>
          </p>
        )}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-textItemBlur">
          <span>
            {t('customer_profiles_accounts', 'Accounts')} · {selectedIds.length}
            /{accounts.length}
          </span>
          {accounts.length > 1 && (
            <button
              type="button"
              disabled={saving}
              className="font-semibold text-btnPrimary"
              onClick={() =>
                setSelectedIds(
                  selectedIds.length === accounts.length
                    ? []
                    : accounts.map((account) => account.id)
                )
              }
            >
              {selectedIds.length === accounts.length
                ? t('customer_profiles_clear', 'Clear selection')
                : t('customer_profiles_select_all', 'Select all')}
            </button>
          )}
        </div>
        <div className="flex max-h-[340px] flex-col gap-2 overflow-y-auto">
          {accounts.map((account) => (
            <label
              key={account.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-newTableBorder p-3 hover:bg-boxHover"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(account.id)}
                disabled={saving}
                onChange={(event) =>
                  setSelectedIds((previous) =>
                    event.target.checked
                      ? [...previous, account.id]
                      : previous.filter((id) => id !== account.id)
                  )
                }
                className="h-4 w-4 shrink-0 accent-[#612bd3]"
              />
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
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-newTextColor">
                  {account.name}
                </span>
                <span className="block truncate text-xs text-textItemBlur">
                  {getNetworkName(account.identifier)} ·{' '}
                  {account.customer?.name ||
                    t('customer_profiles_unassigned', 'No client')}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-newTableBorder pt-4">
        <Button
          onClick={() => saveCustomer()}
          loading={saving}
          disabled={!customer.trim() || !selectedIds.length}
          className="rounded-lg !bg-btnPrimary"
        >
          {t('customer_profiles_assign', 'Assign accounts')}
        </Button>
        <button
          type="button"
          onClick={() => saveCustomer(true)}
          disabled={saving || !selectedIds.length}
          className="text-sm text-textItemBlur underline disabled:opacity-50"
        >
          {t('remove_from_customer', 'Remove from customer')}
        </button>
      </div>
    </div>
  );
}
