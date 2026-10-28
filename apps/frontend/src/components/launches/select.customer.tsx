'use client';

import { useId, useMemo } from 'react';
import { Integrations } from './calendar.context';
import { groupAccounts } from './helpers/integration-groups';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export function SelectCustomer({
  onChange,
  integrations,
  customer = '',
}: {
  onChange: (value: string) => void;
  integrations: Integrations[];
  customer?: string;
}) {
  const t = useT();
  const fieldId = useId();
  const groups = useMemo(
    () => groupAccounts(integrations).filter((group) => group.id),
    [integrations]
  );
  if (!groups.length) return null;
  return (
    <div className="flex min-w-0 items-center">
      <label htmlFor={fieldId} className="sr-only">
        {t('customer_profiles_client', 'Client')}
      </label>
      <select
        id={fieldId}
        value={customer}
        onChange={(event) => onChange(event.target.value)}
        className="h-[42px] max-w-[220px] rounded-lg border border-newColColor bg-newBgColorInner px-3 text-sm text-newTextColor focus-visible:ring-2 focus-visible:ring-btnPrimary"
      >
        <option value="">{t('customer_profiles_all', 'All clients')}</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
    </div>
  );
}
