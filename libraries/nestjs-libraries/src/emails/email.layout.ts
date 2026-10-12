import { escapeEmailHtml, safeEmailUrl } from './notification.email';

export function renderEmailLayout(
  subject: string,
  html: string,
  brand: string,
  frontendUrl?: string
) {
  const title = escapeEmailHtml(subject.replace(/^\[TrendPostiz\]\s*/, ''));
  const settingsUrl = safeEmailUrl(
    frontendUrl ? `${frontendUrl.replace(/\/$/, '')}/settings` : undefined
  );
  return `<!DOCTYPE html>
  <html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#172033;">
    <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${title}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9" style="table-layout:fixed;"><tr><td align="center" style="padding:28px 12px;">
      <!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;table-layout:fixed;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <tr><td bgcolor="#172033" style="padding:26px 28px;border-top:4px solid #818cf8;">
          <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${escapeEmailHtml(
            brand
          )}</p>
          <p style="margin:7px 0 0;color:#cbd5e1;font-size:13px;">Suas contas. Suas publicações. Tudo em um só lugar.</p>
        </td></tr>
        <tr><td style="padding:28px 24px 12px;">
          <h1 style="margin:0 0 20px;font-size:26px;line-height:34px;color:#172033;overflow-wrap:anywhere;">${title}</h1>
          <div style="font-size:14px;line-height:22px;color:#475569;overflow-wrap:anywhere;">${html}</div>
        </td></tr>
        <tr><td style="padding:22px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;">
          <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#334155;">${escapeEmailHtml(
            brand
          )}</p>
          <p style="margin:0;font-size:12px;line-height:20px;color:#64748b;">${
            settingsUrl
              ? `Você pode ajustar quais e-mails recebe nas <a href="${settingsUrl}" style="color:#4f46e5;text-decoration:underline;">configurações da sua conta</a>.`
              : 'Atualizações da sua conta.'
          }</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr></table>
  </body></html>`;
}
