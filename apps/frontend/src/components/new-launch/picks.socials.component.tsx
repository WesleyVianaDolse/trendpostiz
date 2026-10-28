'use client';

import { FC } from 'react';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useShallow } from 'zustand/react/shallow';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { CustomerAccountPicker } from '@gitroom/frontend/components/launches/customer-account-picker';

export const PicksSocialsComponent: FC<{ toolTip?: boolean }> = () => {
  const existing = useExistingData();
  const {
    locked,
    addOrRemoveSelectedIntegration,
    integrations,
    selectedIntegrations,
  } = useLaunchStore(
    useShallow((state) => ({
      integrations: state.integrations,
      selectedIntegrations: state.selectedIntegrations,
      addOrRemoveSelectedIntegration: state.addOrRemoveSelectedIntegration,
      locked: state.locked,
    }))
  );

  return (
    <CustomerAccountPicker
      accounts={integrations.filter((account) =>
        existing.integration
          ? account.id === existing.integration
          : !account.inBetweenSteps && !account.disabled
      )}
      selectedIds={selectedIntegrations.map((item) => item.integration.id)}
      locked={locked || Boolean(existing.integration)}
      onToggle={(account) => addOrRemoveSelectedIntegration(account, {})}
    />
  );
};
