export type InstagramWebhookIssue =
  | 'RECONNECT_REQUIRED'
  | 'SUBSCRIPTION_FAILED'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'WEBHOOK_CONFIGURATION_INCOMPLETE';

export const instagramWebhookIssueMessages: Record<
  InstagramWebhookIssue,
  string
> = {
  RECONNECT_REQUIRED:
    'Reconecte esta conta do Instagram para habilitar automações.',
  SUBSCRIPTION_FAILED:
    'A inscrição de comentários falhou. Solicite uma nova tentativa ao administrador.',
  INSUFFICIENT_PERMISSIONS:
    'Permissões insuficientes. Verifique as autorizações da conta e o nível de acesso do aplicativo na Meta.',
  WEBHOOK_CONFIGURATION_INCOMPLETE:
    'A configuração do webhook está incompleta. Verifique o campo comments do objeto Instagram no aplicativo Meta.',
};

// Read structured failures as well as errors recorded before this classification existed.
// Never expose Meta's raw error text through the accounts API.
export function getInstagramWebhookIssue(
  error?: string | null
): InstagramWebhookIssue {
  try {
    const failure = JSON.parse(error || '{}');
    if (
      Object.prototype.hasOwnProperty.call(
        instagramWebhookIssueMessages,
        failure?.reason
      )
    ) {
      return failure.reason;
    }
    if (Number(failure?.code) === 190 || Number(failure?.code) === 102) {
      return 'RECONNECT_REQUIRED';
    }
    if ([10, 200].includes(Number(failure?.code))) {
      return 'INSUFFICIENT_PERMISSIONS';
    }
    if (
      /subscribed_fields|callback|webhook/i.test(String(failure?.message || ''))
    ) {
      return 'WEBHOOK_CONFIGURATION_INCOMPLETE';
    }
  } catch {}
  return 'SUBSCRIPTION_FAILED';
}
