import { renderEmailLayout } from './email.layout';
import {
  NotificationEmail,
  notificationPlatform,
  postNotificationSubject,
  renderNotificationDigest,
  renderPostNotification,
} from './notification.email';

const published: NotificationEmail = {
  title: 'Published',
  message: 'Your post has been published',
  type: 'success',
  post: {
    accountName: 'Clínica São Paulo',
    username: '@clinica.sp',
    providerIdentifier: 'instagram-standalone',
    content:
      '<p>Conheça a clínica &amp; nossa equipe.</p><p>Agende uma visita.</p>',
    releaseURL: 'https://www.instagram.com/reel/example/?a=1&b=2',
    occurredAt: '2026-10-12T18:30:00.000Z',
  },
};

describe('notification email rendering', () => {
  it('identifies the account, provider variant, post excerpt and publication link', () => {
    const html = renderPostNotification(published);
    expect(html).toContain('Clínica São Paulo');
    expect(html).toContain('@clinica.sp');
    expect(html).not.toContain('@@');
    expect(html).toContain('Instagram');
    expect(html).not.toContain('instagram-standalone');
    expect(html).toContain(
      'Conheça a clínica &amp; nossa equipe. Agende uma visita.'
    );
    expect(html).toContain(
      'href="https://www.instagram.com/reel/example/?a=1&amp;b=2"'
    );
    expect(html).toContain('12/10/2026 às 18:30 UTC');
    expect(postNotificationSubject(published.post!, 'success')).toContain(
      'Instagram · Clínica São Paulo'
    );
  });

  it('keeps two accounts on the same platform distinguishable', () => {
    const html = renderNotificationDigest([
      published,
      {
        ...published,
        post: {
          ...published.post!,
          accountName: 'Outra clínica',
          username: 'outra.clinica',
        },
      },
    ]);
    expect(html).toContain('Clínica São Paulo');
    expect(html).toContain('Outra clínica');
    expect(html).toContain('@outra.clinica');
    expect(html).toContain('2 sucessos');
  });

  it('escapes account data and rejects links with unsafe schemes', () => {
    const html = renderPostNotification({
      ...published,
      post: {
        ...published.post!,
        accountName: '<img src=x onerror="alert(1)">',
        username: '"><script>alert(1)</script>',
        content: '<p>&lt;img src=x onerror=alert(1)&gt; &#128512;</p>',
        releaseURL: 'javascript:alert(1)',
      },
    });
    expect(html).not.toMatch(/<img|<script|href=/);
    expect(html).toContain('&lt;img');
    expect(html).toContain('😀');
    expect(html).toContain('não disponibilizou um link');
  });

  it('handles missing usernames, invalid timestamps and a long emoji caption', () => {
    const html = renderPostNotification({
      ...published,
      post: {
        ...published.post!,
        username: '',
        occurredAt: 'invalid',
        content: '😀'.repeat(241),
        releaseURL: '',
      },
    });
    expect(html).toContain('😀'.repeat(240) + '…');
    expect(html).not.toContain('Invalid Date');
    expect(html).not.toContain('@');
    expect(html).not.toContain('Ver publicação');
  });

  it('shows failures without a misleading publication button and accepts older queue entries', () => {
    const html = renderNotificationDigest([
      published,
      {
        ...published,
        type: 'fail',
        message: 'Token inválido <script>alert(1)</script>',
      },
      {
        type: 'info',
        title: 'Reconnect <account>',
        message: 'Reconnect your account',
      },
    ]);
    expect(html).toContain(
      '1 sucesso &nbsp;·&nbsp; 1 falha &nbsp;·&nbsp; 1 aviso'
    );
    expect(html).toContain('Token inválido &lt;script&gt;');
    expect(html).toContain('Reconnect &lt;account&gt;');
    expect(html.match(/Ver publicação/g)).toHaveLength(1);
  });

  it('builds a table based shell and safely links to account settings', () => {
    const html = renderEmailLayout(
      '[TrendPostiz] <Resumo>',
      '<p>Body</p>',
      '<Brand>',
      'https://app.example.com/'
    );
    expect(html).toContain('&lt;Resumo&gt;');
    expect(html).toContain('&lt;Brand&gt;');
    expect(html).toContain('href="https://app.example.com/settings"');
    expect(html).toContain('<p>Body</p>');
    expect(html).not.toContain('display: flex');
    expect(
      renderEmailLayout('Subject', '', 'Brand', 'javascript:alert(1)')
    ).not.toContain('href=');
    expect(notificationPlatform('linkedin-page')).toBe('LinkedIn');
  });
});
