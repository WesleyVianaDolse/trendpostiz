import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { PublicationRecoveryHistory } from './publication-recovery-history';

jest.mock('swr', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: jest.fn(),
}));
const swr = useSWR as jest.Mock,
  fetcher = jest.fn();
let data: any, mutate: jest.Mock;
beforeEach(() => {
  fetcher.mockReset();
  (useFetch as jest.Mock).mockReturnValue(fetcher);
  if (!global.crypto.randomUUID)
    Object.defineProperty(global.crypto, 'randomUUID', {
      value: () => '00000000-0000-4000-8000-000000000001',
    });
  data = {
    canConfirmManual: true,
    occurrences: [
      {
        id: 'occurrence',
        scheduledAt: '2026-11-16T12:00:00Z',
        revision: 1,
        automaticOutcome: 'EXPIRED',
        attempts: [],
        evidence: [],
      },
    ],
  };
  mutate = jest.fn().mockResolvedValue(undefined);
  swr.mockImplementation(() => ({ data, mutate }));
});
afterEach(cleanup);
function fill() {
  fireEvent.click(screen.getByText('Registrar confirmação manual'));
  expect(
    (screen.getByText('Registrar confirmação') as HTMLButtonElement).disabled
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Identificador público'), {
    target: { value: 'manual-confirmed' },
  });
  fireEvent.change(screen.getByLabelText('Link público HTTPS'), {
    target: { value: 'https://example.test/manual' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
}
describe('recovery reconciliation interaction and outcomes', () => {
  it('keeps automatic expiry and manual confirmation separate', () => {
    data.occurrences[0].evidence = [
      {
        origin: 'manual',
        confirmedAt: '2026-11-16T12:01:00Z',
        remoteUrl: 'https://example.test/manual',
      },
    ];
    render(<PublicationRecoveryHistory postId="post-a" />);
    expect(screen.getByText(/Falhou por vencimento/)).toBeTruthy();
    expect(
      screen.getByText(/Publicação manual: confirmada pela equipe/)
    ).toBeTruthy();
    expect((screen.getByText('Ver publicação') as HTMLAnchorElement).rel).toBe(
      'noopener noreferrer'
    );
  });
  it('requires attestation and submits only the displayed occurrence once while busy', async () => {
    let release: any;
    fetcher.mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        })
    );
    mutate.mockImplementation(async () => {
      data.occurrences[0].evidence = [
        {
          origin: 'manual',
          confirmedAt: new Date().toISOString(),
          remoteUrl: 'https://example.test/manual',
        },
      ];
    });
    render(<PublicationRecoveryHistory postId="post-a" />);
    fill();
    const button = screen.getByText('Registrar confirmação');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [route, options] = fetcher.mock.calls[0],
      body = JSON.parse(options.body);
    expect(route).toBe('/posts/post-a/manual-publication-confirmation');
    expect(body).toMatchObject({
      occurrenceId: 'occurrence',
      attestation: 'CONFIRM_MANUAL_PUBLICATION',
      remoteId: 'manual-confirmed',
    });
    expect(body.userId).toBeUndefined();
    expect(body.organizationId).toBeUndefined();
    expect(body.requestId).toMatch(/^[a-f\d-]{36}$/i);
    release({ ok: true });
    await waitFor(() =>
      expect(screen.queryByText('Registrar confirmação')).toBeNull()
    );
    expect(screen.getByText(/Falhou por vencimento/)).toBeTruthy();
    expect(
      screen.getByText(/Publicação manual: confirmada pela equipe/)
    ).toBeTruthy();
  });
  it('shows a permission failure without claiming confirmation or losing history', async () => {
    fetcher.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Acesso à conciliação não autorizado.' }),
    });
    render(<PublicationRecoveryHistory postId="post-a" />);
    fill();
    fireEvent.click(screen.getByText('Registrar confirmação'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('não autorizado')
    );
    expect(screen.getByText(/Falhou por vencimento/)).toBeTruthy();
    expect(screen.queryByText(/Publicação manual: confirmada/)).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });
  it('offers no confirmation action to a reader', () => {
    data.canConfirmManual = false;
    render(<PublicationRecoveryHistory postId="post-a" />);
    expect(screen.queryByText('Registrar confirmação manual')).toBeNull();
  });
  it('keeps a confirmed primary distinct from uncertain derived/ancillary results', () => {
    Object.assign(data.occurrences[0], {
      automaticOutcome: 'CONFIRMED',
      attempts: [{ phase: 'CONFIRMED' }],
      derivedActions: [
        { id: 'plug', method: 'autoPlugPost', phase: 'UNCERTAIN' },
      ],
      completionActions: [{ actionKey: 'webhook:1', phase: 'UNCERTAIN' }],
    });
    render(<PublicationRecoveryHistory postId="post-a" />);
    expect(screen.getByText(/Publicação automática confirmada/)).toBeTruthy();
    expect(
      screen.getByText(/resultado incerto; reenvio bloqueado/)
    ).toBeTruthy();
    expect(screen.getByText(/repetição automática bloqueada/)).toBeTruthy();
  });
  it('exposes an unresolved series even when it has no occurrence rows', () => {
    data.occurrences = [];
    data.inventoryIssues = [
      {
        subjectKey: 'series:post-a:0',
        decision: 'RETAIN',
        reason: 'RECURRENCE_ANCHOR_UNRESOLVED',
      },
    ];
    render(<PublicationRecoveryHistory postId="post-a" />);
    expect(screen.getByText(/A série foi preservada/)).toBeTruthy();
    expect(screen.queryByText('Registrar confirmação manual')).toBeNull();
  });
});
