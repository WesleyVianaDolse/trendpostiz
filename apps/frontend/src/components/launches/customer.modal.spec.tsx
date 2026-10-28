import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomerModal } from './customer.modal';

const request = jest.fn();
const close = jest.fn();
const revalidate = jest.fn().mockResolvedValue(undefined);
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => request,
}));
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ closeCurrent: close }),
}));
jest.mock('swr', () => ({ useSWRConfig: () => ({ mutate: revalidate }) }));
jest.mock('./helpers/use.customers', () => ({
  useCustomers: () => ({ data: [{ id: 'd', name: 'Danilo' }] }),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const accounts = [
  {
    id: 'one',
    name: 'Danilo',
    identifier: 'facebook',
    customer: { id: 'old', name: 'Old client' },
  },
  { id: 'two', name: 'Danilo', identifier: 'instagram' },
];

describe('client assignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    request.mockReset().mockResolvedValue({ ok: true });
  });

  function selectAllAndName() {
    fireEvent.change(screen.getByLabelText('Client'), {
      target: { value: '  Danilo  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign accounts' }));
  }

  it('assigns multiple profiles using the existing API and trimmed name', async () => {
    const updated = jest.fn();
    render(<CustomerModal integrations={accounts} onClose={updated} />);
    selectAllAndName();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/integrations/one/customer-name',
      '/integrations/two/customer-name',
    ]);
    expect(
      request.mock.calls.every(
        ([, options]) => JSON.parse(options.body).name === 'Danilo'
      )
    ).toBe(true);
    expect(updated).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledWith('/integrations/list');
    expect(revalidate).toHaveBeenCalledWith('/integrations/customers');
  });

  it('keeps failures open and retries only unfinished assignments', async () => {
    request
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true });
    const updated = jest.fn();
    render(<CustomerModal integrations={accounts} onClose={updated} />);
    selectAllAndName();
    await screen.findByRole('alert');
    expect(close).not.toHaveBeenCalled();
    expect(updated).not.toHaveBeenCalled();
    expect(
      (screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked
    ).toBe(false);
    expect(
      (screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Assign accounts' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/integrations/one/customer-name',
      '/integrations/two/customer-name',
      '/integrations/two/customer-name',
    ]);
  });

  it('can remove the existing assignment without entering a new client', async () => {
    render(<CustomerModal integration={accounts[0]} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Client'), {
      target: { value: '' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove from customer' })
    );
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ name: '' });
  });

  it('does not submit a blank client name or an empty selection', () => {
    render(<CustomerModal integrations={accounts} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Assign accounts' }));
    fireEvent.change(screen.getByLabelText('Client'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign accounts' }));
    expect(request).not.toHaveBeenCalled();
  });
});
