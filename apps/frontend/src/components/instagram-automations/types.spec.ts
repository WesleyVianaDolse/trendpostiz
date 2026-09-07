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
  webhookCommentsSubscribed: true,
  webhookMessagesSubscribed: true,
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

  it('blocks an active Direct automation without messages subscription', () =>
    expect(
      validateAutomationStep(4, valid(), {
        ...subscribedAccount,
        webhookMessagesSubscribed: false,
      })
    ).toContain('Reconecte'));

  it('allows saving that Direct automation as inactive', () => {
    const form = valid();
    form.enabled = false;
    expect(
      validateAutomationStep(4, form, {
        ...subscribedAccount,
        webhookMessagesSubscribed: false,
      })
    ).toBeNull();
  });

  it('supports edit data with no account/post revalidation on step three', () =>
    expect(validateAutomationStep(3, valid())).toBeNull());
});
