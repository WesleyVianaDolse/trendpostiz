import { fireEvent, render, screen } from '@testing-library/react';
import { SelectCustomer } from './select.customer';

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

it('keeps calendar client filters controlled, alphabetical and clearable', () => {
  const change = jest.fn();
  render(
    <SelectCustomer
      customer="w"
      onChange={change}
      integrations={
        [
          {
            id: 'one',
            name: 'One',
            identifier: 'facebook',
            customer: { id: 'w', name: 'Wesley' },
          },
          {
            id: 'two',
            name: 'Two',
            identifier: 'instagram',
            customer: { id: 'd', name: 'Danilo' },
          },
        ] as any
      }
    />
  );
  expect(
    screen.getAllByRole('option').map((option) => option.textContent)
  ).toEqual(['All clients', 'Danilo', 'Wesley']);
  expect((screen.getByLabelText('Client') as HTMLSelectElement).value).toBe(
    'w'
  );
  fireEvent.change(screen.getByLabelText('Client'), { target: { value: '' } });
  expect(change).toHaveBeenCalledWith('');
});
