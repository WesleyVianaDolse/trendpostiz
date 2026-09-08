export type MatchType = 'CONTAINS' | 'EXACT';

export interface InstagramAccount {
  id: string;
  name: string;
  profile: string | null;
  picture: string | null;
  disabled: boolean;
  refreshNeeded: boolean;
  capabilities: {
    commentsWebhook: boolean;
    publicReply: boolean;
    privateReply: boolean;
    reconnectRequired: boolean;
  };
  status: {
    comments: 'ACTIVE' | 'RECONNECT_REQUIRED' | 'UNAVAILABLE';
    publicReply: 'AVAILABLE' | 'UNAVAILABLE';
    privateReply: 'AVAILABLE' | 'UNAVAILABLE';
  };
}

export interface InstagramMedia {
  id: string;
  caption: string;
  mediaType: string;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
  automationId?: string | null;
}

export interface AutomationFormData {
  integrationId: string;
  mediaId: string;
  matchType: MatchType;
  triggers: string[];
  publicReplyEnabled: boolean;
  publicReplyText: string;
  privateReplyEnabled: boolean;
  privateReplyText: string;
  enabled: boolean;
}

export interface InstagramAutomation
  extends Omit<AutomationFormData, 'triggers'> {
  id: string;
  createdAt: string;
  updatedAt: string;
  integration: Pick<InstagramAccount, 'id' | 'name' | 'profile' | 'picture'>;
  media: InstagramMedia;
  triggers: Array<{ id: string; phrase: string; normalizedPhrase: string }>;
  metrics: {
    executions: number;
    publicReplies: number;
    privateReplies: number;
    failures: number;
    lastExecutionAt: string | null;
  };
}

export const initialAutomationForm: AutomationFormData = {
  integrationId: '',
  mediaId: '',
  matchType: 'CONTAINS',
  triggers: [''],
  publicReplyEnabled: true,
  publicReplyText: '',
  privateReplyEnabled: true,
  privateReplyText: '',
  enabled: true,
};

export const validateAutomationStep = (
  step: number,
  form: AutomationFormData,
  account?: InstagramAccount
) => {
  if (step === 1 && !form.integrationId) return 'Selecione uma conta.';
  if (step === 2 && !form.mediaId) return 'Selecione um post.';
  if (step === 3 && !form.triggers.some((value) => value.trim()))
    return 'Adicione pelo menos um gatilho.';
  if (
    step === 3 &&
    new Set(form.triggers.map((value) => value.trim().toLocaleLowerCase()))
      .size !== form.triggers.length
  )
    return 'Remova os gatilhos duplicados.';
  if (step === 4 && !form.publicReplyEnabled && !form.privateReplyEnabled)
    return 'Habilite pelo menos uma resposta.';
  if (step === 4 && form.publicReplyEnabled && !form.publicReplyText.trim())
    return 'Informe a resposta pública.';
  if (step === 4 && form.privateReplyEnabled && !form.privateReplyText.trim())
    return 'Informe a mensagem no Direct.';
  if (step >= 4 && !account?.capabilities.commentsWebhook)
    return account?.capabilities.reconnectRequired
      ? 'Reconecte esta conta do Instagram para habilitar automações.'
      : 'Os comentários desta conta estão indisponíveis para automações.';
  if (
    step >= 4 &&
    form.publicReplyEnabled &&
    !account?.capabilities.publicReply
  )
    return 'A resposta pública não está disponível para esta conta.';
  if (
    step >= 4 &&
    form.privateReplyEnabled &&
    !account?.capabilities.privateReply
  )
    return 'O Direct não está disponível para esta conta.';
  return null;
};
