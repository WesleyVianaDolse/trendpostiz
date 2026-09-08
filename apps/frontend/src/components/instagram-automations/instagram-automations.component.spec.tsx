import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useSWR from 'swr';
import {
  InstagramAutomationsPage,
  InstagramAutomationWizard,
} from './instagram-automations.component';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('swr', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => jest.fn(),
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));

const mockedSWR = useSWR as jest.Mock;

describe('Instagram automations list UI', () => {
  it('renders the empty state and creation action', () => {
    mockedSWR.mockReturnValue({
      data: [],
      isLoading: false,
      mutate: jest.fn(),
    });
    const html = renderToStaticMarkup(<InstagramAutomationsPage />);
    expect(html).toContain('Automatize comentários do Instagram');
    expect(html).toContain('Criar primeira automação');
    expect(html).toContain('/instagram/automations/new');
  });

  it('renders automation data, metrics and responsive cards', () => {
    mockedSWR.mockReturnValue({
      isLoading: false,
      mutate: jest.fn(),
      data: [
        {
          id: 'automation-1',
          integrationId: 'integration-1',
          mediaId: 'media-1',
          enabled: true,
          matchType: 'EXACT',
          publicReplyEnabled: true,
          publicReplyText: 'Público',
          privateReplyEnabled: true,
          privateReplyText: 'Direct',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          integration: {
            id: 'integration-1',
            name: 'Conta',
            profile: 'conta',
            picture: null,
          },
          media: {
            id: 'media-1',
            caption: 'Legenda do post',
            mediaType: 'IMAGE',
            thumbnailUrl: null,
            permalink: null,
            timestamp: null,
          },
          triggers: [
            {
              id: 'trigger-1',
              phrase: 'EU QUERO',
              normalizedPhrase: 'eu quero',
            },
          ],
          metrics: {
            executions: 4,
            publicReplies: 3,
            privateReplies: 2,
            failures: 1,
            lastExecutionAt: null,
          },
        },
      ],
    });
    const html = renderToStaticMarkup(<InstagramAutomationsPage />);
    expect(html).toContain('@conta');
    expect(html).toContain('Legenda do post');
    expect(html).toContain('EU QUERO');
    expect(html).toContain('Exatamente igual');
    expect(html).toContain('lg:grid-cols-2');
    expect(html).toContain('/instagram/automations/automation-1/executions');
  });

  it('shows provider-agnostic capability status and reconnection guidance', () => {
    mockedSWR.mockImplementation((key: string) => ({
      isLoading: false,
      mutate: jest.fn(),
      data:
        key === '/instagram-comment-automations/accounts'
          ? [
              {
                id: 'traditional-old',
                name: 'Minha conta',
                profile: 'minhaconta',
                picture: null,
                disabled: false,
                refreshNeeded: false,
                capabilities: {
                  commentsWebhook: false,
                  publicReply: false,
                  privateReply: false,
                  reconnectRequired: true,
                },
                status: {
                  comments: 'RECONNECT_REQUIRED',
                  publicReply: 'UNAVAILABLE',
                  privateReply: 'UNAVAILABLE',
                },
              },
            ]
          : undefined,
    }));

    const html = renderToStaticMarkup(<InstagramAutomationWizard />);
    expect(html).toContain('@minhaconta');
    expect(html).toContain('Requer reconexão');
    expect(html).toContain(
      'Reconecte esta conta do Instagram para habilitar automações.'
    );
    expect(html).not.toContain('instagram-standalone');
    expect(html).not.toContain('Business Manager');
  });
});
