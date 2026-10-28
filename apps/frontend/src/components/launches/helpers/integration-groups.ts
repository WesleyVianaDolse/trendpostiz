export interface CustomerAccount {
  id: string;
  name: string;
  identifier: string;
  picture?: string;
  disabled?: boolean;
  inBetweenSteps?: boolean;
  refreshNeeded?: boolean;
  customer?: { id?: string; name?: string } | null;
}

const alphabetic = new Intl.Collator('pt-BR', {
  sensitivity: 'base',
  numeric: true,
});

export function sortAccounts<T extends CustomerAccount>(accounts: T[]): T[] {
  return [...accounts].sort(
    (a, b) =>
      alphabetic.compare(a.name, b.name) ||
      alphabetic.compare(a.identifier, b.identifier) ||
      alphabetic.compare(a.id, b.id)
  );
}

export function groupAccounts<T extends CustomerAccount>(accounts: T[]) {
  const groups = new Map<string, { id: string; name: string; values: T[] }>();
  for (const account of sortAccounts(accounts)) {
    const id = account.customer?.id || '';
    const group = groups.get(id) || {
      id,
      name: account.customer?.name || '',
      values: [],
    };
    group.values.push(account);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.id) return b.id ? 1 : 0;
    if (!b.id) return -1;
    return alphabetic.compare(a.name, b.name) || alphabetic.compare(a.id, b.id);
  });
}

const networkNames: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  'instagram-standalone': 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  'tiktok-business': 'TikTok Business',
  linkedin: 'LinkedIn',
  'linkedin-page': 'LinkedIn Page',
  x: 'X',
  gmb: 'Google Business Profile',
  bluesky: 'Bluesky',
};

export function getNetworkName(identifier: string) {
  return (
    networkNames[identifier] ||
    identifier
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}
