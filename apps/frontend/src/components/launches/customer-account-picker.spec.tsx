import { fireEvent, render, screen, within } from '@testing-library/react';
import { CustomerAccountPicker } from './customer-account-picker';
import { CustomerAccount } from './helpers/integration-groups';

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const accounts: CustomerAccount[] = [
  {
    id: 'wf',
    name: 'Wesley',
    identifier: 'facebook',
    customer: { id: 'w', name: 'Wesley' },
  },
  {
    id: 'di',
    name: 'Danilo',
    identifier: 'instagram',
    customer: { id: 'd', name: 'Danilo' },
  },
  {
    id: 'df',
    name: 'Danilo',
    identifier: 'facebook',
    customer: { id: 'd', name: 'Danilo' },
  },
  { id: 'u', name: 'Other profile', identifier: 'tiktok' },
];

describe('client account picker', () => {
  it('labels accounts with their network and filters clients without changing selections', () => {
    const toggle = jest.fn();
    render(
      <CustomerAccountPicker
        accounts={accounts}
        selectedIds={['wf']}
        onToggle={toggle}
      />
    );
    expect(
      screen.getAllByRole('option').map((option) => option.textContent)
    ).toEqual(['All clients', 'Danilo (2)', 'Wesley (1)', 'No client (1)']);
    fireEvent.change(screen.getByLabelText('Client'), {
      target: { value: 'd' },
    });
    expect(
      screen.getByRole('button', { name: 'Danilo · Facebook' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Danilo · Instagram' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Wesley · Facebook' })
    ).toBeNull();
    // Selections in other groups remain visible and removable.
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove: Wesley · Facebook' })
    );
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledWith(accounts[0]);
  });

  it('selects the specific account and supports the unassigned group', () => {
    const toggle = jest.fn();
    render(
      <CustomerAccountPicker
        accounts={accounts}
        selectedIds={[]}
        onToggle={toggle}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Danilo · Instagram' }));
    expect(toggle).toHaveBeenCalledWith(accounts[1]);
    fireEvent.change(screen.getByLabelText('Client'), {
      target: { value: '' },
    });
    expect(
      screen.getByRole('button', { name: 'Other profile · TikTok' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Danilo · Instagram' })
    ).toBeNull();
  });

  it('does not enable disconnected or unsupported accounts', () => {
    const toggle = jest.fn();
    render(
      <CustomerAccountPicker
        accounts={[{ ...accounts[0], refreshNeeded: true }, accounts[1]]}
        selectedIds={[]}
        onToggle={toggle}
        getUnavailableReason={(account) =>
          account.id === 'di' ? 'Unsupported' : undefined
        }
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Wesley · Facebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Danilo · Instagram' }));
    expect(toggle).not.toHaveBeenCalled();
    expect(screen.getByText('Unsupported')).toBeTruthy();
    expect(screen.getByText('Reconnect this account to publish.')).toBeTruthy();
  });

  it('keeps editing a published account locked', () => {
    const toggle = jest.fn();
    render(
      <CustomerAccountPicker
        accounts={[accounts[0]]}
        selectedIds={['wf']}
        onToggle={toggle}
        locked
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Wesley · Facebook' }));
    const selected = screen.getByLabelText('Selected profiles');
    fireEvent.click(within(selected).getByRole('button'));
    expect(toggle).not.toHaveBeenCalled();
  });

  it('recovers when a client disappears after integrations refresh', () => {
    const props = { selectedIds: [], onToggle: jest.fn() };
    const { rerender } = render(
      <CustomerAccountPicker {...props} accounts={accounts} />
    );
    fireEvent.change(screen.getByLabelText('Client'), {
      target: { value: 'd' },
    });
    rerender(<CustomerAccountPicker {...props} accounts={[accounts[0]]} />);
    expect((screen.getByLabelText('Client') as HTMLSelectElement).value).toBe(
      'all'
    );
    expect(
      screen.getByRole('button', { name: 'Wesley · Facebook' })
    ).toBeTruthy();
  });
});
