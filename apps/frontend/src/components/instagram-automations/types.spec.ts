import { initialAutomationForm, validateAutomationStep } from './types';

const valid = () => ({
  ...initialAutomationForm,
  integrationId: 'integration-1',
  mediaId: 'media-1',
  triggers: ['EU QUERO'],
  publicReplyText: 'Veja seu Direct',
  privateReplyText: 'Aqui está o link',
});

const subscribedAccount = {
  id: 'integration-1',
  name: 'Conta',
  profile: 'conta',
  picture: null,
  disabled: false,
  refreshNeeded: false,
  capabilities: {
    commentsWebhook: true,
    publicReply: true,
    privateReply: true,
    reconnectRequired: false,
  },
  status: {
    comments: 'ACTIVE' as const,
    publicReply: 'AVAILABLE' as const,
    privateReply: 'AVAILABLE' as const,
  },
};

describe('Instagram automation wizard validation', () => {
  it('requires an account', () =>
    expect(validateAutomationStep(1, initialAutomationForm)).toContain(
      'conta'
    ));

  it('requires a post', () => {
    const form = valid();
    form.mediaId = '';
    expect(validateAutomationStep(2, form)).toContain('post');
  });

  it('accepts a complete creation', () =>
    expect(validateAutomationStep(4, valid(), subscribedAccount)).toBeNull());

  it('accepts CONTAINS', () => {
    const form = valid();
    form.matchType = 'CONTAINS';
    expect(validateAutomationStep(3, form)).toBeNull();
  });

  it('accepts EXACT', () => {
    const form = valid();
    form.matchType = 'EXACT';
    expect(validateAutomationStep(3, form)).toBeNull();
  });

  it('accepts multiple triggers', () => {
    const form = valid();
    form.triggers = ['EU QUERO', 'ME MANDA'];
    expect(validateAutomationStep(3, form)).toBeNull();
  });

  it('rejects an empty trigger list', () => {
    const form = valid();
    form.triggers = ['  '];
    expect(validateAutomationStep(3, form)).toContain('gatilho');
  });

  it('rejects superficially duplicated triggers', () => {
    const form = valid();
    form.triggers = ['EU QUERO', ' eu quero '];
    expect(validateAutomationStep(3, form)).toContain('duplicados');
  });

  it('requires one delivery mode', () => {
    const form = valid();
    form.publicReplyEnabled = false;
    form.privateReplyEnabled = false;
    expect(validateAutomationStep(4, form, subscribedAccount)).toContain(
      'resposta'
    );
  });

  it('requires public reply text', () => {
    const form = valid();
    form.publicReplyText = '';
    expect(validateAutomationStep(4, form, subscribedAccount)).toContain(
      'pública'
    );
  });

  it('requires Direct text', () => {
    const form = valid();
    form.privateReplyText = '';
    expect(validateAutomationStep(4, form, subscribedAccount)).toContain(
      'Direct'
    );
  });

  it('blocks Direct when the provider capability is unavailable', () =>
    expect(
      validateAutomationStep(4, valid(), {
        ...subscribedAccount,
        capabilities: {
          ...subscribedAccount.capabilities,
          privateReply: false,
        },
      })
    ).toContain('Direct'));

  it('does not bypass provider capabilities when saved inactive', () => {
    const form = valid();
    form.enabled = false;
    expect(
      validateAutomationStep(4, form, {
        ...subscribedAccount,
        capabilities: {
          ...subscribedAccount.capabilities,
          privateReply: false,
        },
      })
    ).toContain('Direct');
  });

  it('shows the reconnection requirement for an old Facebook/BM account', () =>
    expect(
      validateAutomationStep(4, valid(), {
        ...subscribedAccount,
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
      })
    ).toContain('Reconecte esta conta do Instagram'));

  it('supports edit data with no account/post revalidation on step three', () =>
    expect(validateAutomationStep(3, valid())).toBeNull());
});
