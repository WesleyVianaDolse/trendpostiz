import striptags from 'striptags';

export type NotificationType = 'success' | 'fail' | 'info';

export type PostNotificationDetails = {
  accountName: string;
  username?: string;
  providerIdentifier: string;
  content?: string;
  releaseURL?: string;
  occurredAt?: string;
};

export type NotificationEmail = {
  message: string;
  title?: string;
  type: NotificationType;
  post?: PostNotificationDetails;
};

export function escapeEmailHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

export function safeEmailUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? escapeEmailHtml(url.href)
      : undefined;
  } catch {
    return undefined;
  }
}

export function notificationPlatform(identifier: string) {
  const platform = identifier.split('-')[0].toLowerCase();
  const names: Record<string, string> = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    linkedin: 'LinkedIn',
    twitter: 'X',
    pinterest: 'Pinterest',
    threads: 'Threads',
    bluesky: 'Bluesky',
    mastodon: 'Mastodon',
    reddit: 'Reddit',
    telegram: 'Telegram',
  };
  return (
    names[platform] || platform.charAt(0).toUpperCase() + platform.slice(1)
  );
}

function postExcerpt(content: string) {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  const text = striptags(content.replace(/<\/(?:p|div)>|<br\s*\/?\s*>/gi, ' '))
    .replace(
      /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
      (match, entity: string) => {
        if (!entity.startsWith('#'))
          return entities[entity.toLowerCase()] || match;
        const code = entity.toLowerCase().startsWith('#x')
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
        return code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
    )
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(text);
  return escapeEmailHtml(
    characters.slice(0, 240).join('') + (characters.length > 240 ? '…' : '')
  );
}

export function postNotificationSubject(
  post: PostNotificationDetails,
  type: NotificationType
) {
  const status =
    type === 'success'
      ? 'Publicação confirmada'
      : type === 'fail'
      ? 'Falha na publicação'
      : 'Publicação precisa de atenção';
  return `[TrendPostiz] ${status}: ${notificationPlatform(
    post.providerIdentifier
  )} · ${post.accountName}`;
}

export function renderPostNotification(email: NotificationEmail) {
  const post = email.post!;
  const platform = notificationPlatform(post.providerIdentifier);
  const success = email.type === 'success';
  const color = success
    ? '#047857'
    : email.type === 'fail'
    ? '#b91c1c'
    : '#92400e';
  const background = success
    ? '#ecfdf5'
    : email.type === 'fail'
    ? '#fef2f2'
    : '#fffbeb';
  const status = success
    ? 'Publicação confirmada'
    : email.type === 'fail'
    ? 'Falha na publicação'
    : 'Atenção necessária';
  const url = success ? safeEmailUrl(post.releaseURL) : undefined;
  const username = post.username?.trim().replace(/^@+/, '');
  const excerpt = post.content ? postExcerpt(post.content) : '';
  const timestamp = post.occurredAt && new Date(post.occurredAt);
  const date =
    timestamp && !isNaN(timestamp.getTime())
      ? `${timestamp.toISOString().slice(8, 10)}/${timestamp
          .toISOString()
          .slice(5, 7)}/${timestamp.toISOString().slice(0, 4)} às ${timestamp
          .toISOString()
          .slice(11, 16)} UTC`
      : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;margin-bottom:16px;">
    <tr><td style="padding:22px;">
      <p style="margin:0 0 14px;font-size:12px;font-weight:700;color:${color};"><span style="background:${background};padding:6px 10px;border-radius:6px;">${status}</span></p>
      <p style="margin:0 0 5px;font-size:12px;font-weight:700;letter-spacing:1px;color:#6366f1;">${escapeEmailHtml(
        platform
      )}</p>
      <h2 style="margin:0;font-size:20px;line-height:28px;color:#172033;overflow-wrap:anywhere;">${escapeEmailHtml(
        post.accountName || 'Conta conectada'
      )}</h2>
      ${
        username
          ? `<p style="margin:4px 0 0;font-size:14px;color:#64748b;overflow-wrap:anywhere;">@${escapeEmailHtml(
              username
            )}</p>`
          : ''
      }
      ${
        date
          ? `<p style="margin:10px 0 0;font-size:12px;color:#64748b;">${date}</p>`
          : ''
      }
      ${
        excerpt
          ? `<p style="margin:16px 0 0;padding:14px;background:#f8fafc;border-left:3px solid #c7d2fe;font-size:14px;line-height:22px;color:#475569;overflow-wrap:anywhere;">${excerpt}</p>`
          : ''
      }
      ${
        !success
          ? `<p style="margin:16px 0 0;font-size:14px;line-height:22px;color:#475569;overflow-wrap:anywhere;">${escapeEmailHtml(
              email.message
            )}</p>`
          : ''
      }
      ${
        url
          ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px;"><tr><td bgcolor="#4f46e5" style="border-radius:7px;mso-padding-alt:12px 18px;"><a href="${url}" style="display:inline-block;padding:12px 18px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">Ver publicação &rarr;</a></td></tr></table>`
          : success
          ? '<p style="margin:16px 0 0;font-size:13px;color:#64748b;">A plataforma não disponibilizou um link para esta publicação.</p>'
          : ''
      }
    </td></tr>
  </table>`;
}

export function renderNotificationDigest(emails: NotificationEmail[]) {
  const success = emails.filter((email) => email.type === 'success').length;
  const failure = emails.filter((email) => email.type === 'fail').length;
  const info = emails.filter((email) => email.type === 'info').length;
  const summary = [
    success ? `${success} ${success === 1 ? 'sucesso' : 'sucessos'}` : '',
    failure ? `${failure} ${failure === 1 ? 'falha' : 'falhas'}` : '',
    info ? `${info} ${info === 1 ? 'aviso' : 'avisos'}` : '',
  ]
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');

  return `<p style="margin:0 0 8px;font-size:15px;line-height:24px;color:#475569;">Confira as atualizações das suas contas conectadas.</p>
    <p style="margin:0 0 24px;padding:12px 16px;background:#eef2ff;border-radius:8px;font-size:14px;font-weight:700;color:#4338ca;">${summary}</p>
    ${emails
      .map((email) =>
        email.post
          ? renderPostNotification(email)
          : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1px solid #e2e8f0;border-radius:10px;"><tr><td style="padding:18px;font-size:14px;line-height:22px;color:#475569;">${
              email.title
                ? `<h2 style="margin:0 0 8px;font-size:16px;color:#172033;">${escapeEmailHtml(
                    email.title
                  )}</h2>`
                : ''
            }${escapeEmailHtml(email.message)}</td></tr></table>`
      )
      .join('')}`;
}
