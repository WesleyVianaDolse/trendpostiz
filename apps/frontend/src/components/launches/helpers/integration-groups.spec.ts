import { groupAccounts, sortAccounts } from './integration-groups';

describe('client account organization', () => {
  it('sorts names alphabetically with accents and numeric suffixes without mutating the input', () => {
    const accounts = [
      { id: '3', name: 'Wesley', identifier: 'instagram' },
      { id: '2', name: 'Álvaro 10', identifier: 'facebook' },
      { id: '1', name: 'alvaro 2', identifier: 'tiktok' },
    ];
    expect(sortAccounts(accounts).map((account) => account.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(accounts[0].id).toBe('3');
  });

  it('groups by explicit client IDs, orders clients and puts unassigned accounts last', () => {
    const accounts = [
      { id: '1', name: 'Danilo', identifier: 'instagram' },
      {
        id: '2',
        name: 'Zoe',
        identifier: 'tiktok',
        customer: { id: 'w', name: 'Wesley' },
      },
      {
        id: '3',
        name: 'Zoe',
        identifier: 'facebook',
        customer: { id: 'd', name: 'Danilo' },
      },
      {
        id: '4',
        name: 'Ana',
        identifier: 'instagram',
        customer: { id: 'd', name: 'Danilo' },
      },
    ];
    const groups = groupAccounts(accounts);
    expect(groups.map((group) => group.id)).toEqual(['d', 'w', '']);
    expect(groups[0].values.map((account) => account.id)).toEqual(['4', '3']);
    expect(groups[2].values[0].id).toBe('1');
  });

  it('keeps clients with identical names separate and accepts null customer data', () => {
    const groups = groupAccounts([
      {
        id: '1',
        name: 'Profile',
        identifier: 'facebook',
        customer: { id: 'one', name: 'Client' },
      },
      {
        id: '2',
        name: 'Profile',
        identifier: 'instagram',
        customer: { id: 'two', name: 'Client' },
      },
      { id: '3', name: 'Profile', identifier: 'tiktok', customer: null },
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.values.length)).toEqual([1, 1, 1]);
    expect(groupAccounts([])).toEqual([]);
  });
});
