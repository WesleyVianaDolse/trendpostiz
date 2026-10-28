'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export function useCustomers() {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error('Could not load clients');
      return response.json() as Promise<{ id: string; name: string }[]>;
    },
    [fetch]
  );
  return useSWR('/integrations/customers', load);
}
