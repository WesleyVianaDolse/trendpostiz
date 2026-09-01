import { weightedLength } from '@gitroom/helpers/utils/count.length';
import {
  PublisherIntegration,
  PublisherProviderSettings,
  PublisherValidationErrors,
  PublisherValidationInput,
} from './publisher.types';
import { validateProviderMedia } from '../media/media-validation';

export interface ProviderField {
  key: string;
  label: string;
  type: 'text' | 'select';
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

interface ProviderRule {
  supported: boolean;
  maximumCharacters: number;
  unavailableReason?: string;
  fields?: ProviderField[];
}

const noMedia =
  'Este provider exige mídia e ainda não está disponível no Publisher.';
const remoteSelection =
  'Este provider exige uma seleção remota específica ainda não disponível no Publisher.';

export const providerRules: Record<string, ProviderRule> = {
  devto: {
    supported: true,
    maximumCharacters: 100_000,
    fields: [
      {
        key: 'title',
        label: 'Título no Dev.to',
        type: 'text',
        placeholder: 'Mínimo de 2 caracteres',
      },
    ],
  },
  x: {
    supported: true,
    maximumCharacters: 280,
    fields: [
      {
        key: 'who_can_reply_post',
        label: 'Quem pode responder',
        type: 'select',
        options: [
          { value: 'everyone', label: 'Todos' },
          { value: 'following', label: 'Pessoas que você segue' },
          { value: 'mentionedUsers', label: 'Somente mencionados' },
          { value: 'subscribers', label: 'Assinantes' },
          { value: 'verified', label: 'Contas verificadas' },
        ],
      },
    ],
  },
  linkedin: { supported: true, maximumCharacters: 3_000 },
  'linkedin-page': { supported: true, maximumCharacters: 3_000 },
  reddit: {
    supported: false,
    maximumCharacters: 10_000,
    unavailableReason: `${remoteSelection} Requer subreddit, título, tipo e possivelmente flair.`,
  },
  medium: {
    supported: true,
    maximumCharacters: 100_000,
    fields: [
      { key: 'title', label: 'Título no Medium', type: 'text' },
      { key: 'subtitle', label: 'Subtítulo no Medium', type: 'text' },
    ],
  },
  hashnode: {
    supported: false,
    maximumCharacters: 10_000,
    unavailableReason: `${remoteSelection} Requer publicação e ao menos uma tag.`,
  },
  facebook: { supported: true, maximumCharacters: 63_206 },
  instagram: {
    supported: true,
    maximumCharacters: 2_200,
    fields: [
      {
        key: 'post_type',
        label: 'Tipo de publicação',
        type: 'select',
        options: [
          { value: 'post', label: 'Post / Reel' },
          { value: 'story', label: 'Story' },
        ],
      },
    ],
  },
  'instagram-standalone': {
    supported: true,
    maximumCharacters: 2_200,
    fields: [
      {
        key: 'post_type',
        label: 'Tipo de publicação',
        type: 'select',
        options: [
          { value: 'post', label: 'Post / Reel' },
          { value: 'story', label: 'Story' },
        ],
      },
    ],
  },
  youtube: {
    supported: true,
    maximumCharacters: 5_000,
    fields: [
      { key: 'title', label: 'Título no YouTube', type: 'text' },
      {
        key: 'type',
        label: 'Visibilidade',
        type: 'select',
        options: [
          { value: 'public', label: 'Público' },
          { value: 'private', label: 'Privado' },
          { value: 'unlisted', label: 'Não listado' },
        ],
      },
    ],
  },
  tiktok: {
    supported: true,
    maximumCharacters: 2_000,
  },
  pinterest: {
    supported: false,
    maximumCharacters: 500,
    unavailableReason: `${noMedia} Também requer a seleção de um board.`,
  },
  dribbble: {
    supported: false,
    maximumCharacters: 40_000,
    unavailableReason:
      'Exige exatamente uma imagem com 400x300 ou 800x600 px; a validação avançada ainda não está disponível.',
  },
  threads: { supported: true, maximumCharacters: 500 },
  discord: {
    supported: false,
    maximumCharacters: 1_980,
    unavailableReason: `${remoteSelection} Requer um canal.`,
  },
  slack: {
    supported: false,
    maximumCharacters: 400_000,
    unavailableReason: `${remoteSelection} Requer um canal.`,
  },
  kick: { supported: true, maximumCharacters: 500 },
  twitch: { supported: true, maximumCharacters: 500 },
  mastodon: { supported: true, maximumCharacters: 500 },
  bluesky: { supported: true, maximumCharacters: 300 },
  lemmy: {
    supported: false,
    maximumCharacters: 10_000,
    unavailableReason: `${remoteSelection} Requer comunidade e título.`,
  },
  wrapcast: { supported: true, maximumCharacters: 800 },
  telegram: { supported: true, maximumCharacters: 4_096 },
  nostr: { supported: true, maximumCharacters: 100_000 },
  vk: { supported: true, maximumCharacters: 2_048 },
  wordpress: {
    supported: false,
    maximumCharacters: 100_000,
    unavailableReason: `${remoteSelection} Requer o tipo de post do site.`,
  },
  listmonk: {
    supported: false,
    maximumCharacters: 300_000,
    unavailableReason: `${remoteSelection} Requer lista, assunto e preview.`,
  },
  gmb: { supported: true, maximumCharacters: 1_500 },
  moltbook: {
    supported: false,
    maximumCharacters: 300,
    unavailableReason: `${remoteSelection} Requer um submolt.`,
  },
  skool: {
    supported: false,
    maximumCharacters: 50_000,
    unavailableReason: `${remoteSelection} Requer grupo e label.`,
  },
  whop: {
    supported: false,
    maximumCharacters: 50_000,
    unavailableReason: `${remoteSelection} Requer empresa e experiência.`,
  },
  mewe: { supported: true, maximumCharacters: 63_206 },
};

const unknownRule: ProviderRule = {
  supported: false,
  maximumCharacters: 0,
  unavailableReason: 'Provider ainda não mapeado para o Publisher.',
};

export function getProviderRule(identifier: string) {
  return providerRules[identifier] || unknownRule;
}

export function getDefaultProviderSettings(
  identifier: string
): PublisherProviderSettings {
  switch (identifier) {
    case 'devto':
      return { title: '', tags: [] };
    case 'medium':
      return { title: '', subtitle: '', tags: [] };
    case 'instagram':
    case 'instagram-standalone':
      return { post_type: 'post', collaborators: [], is_trial_reel: false };
    case 'youtube':
      return {
        title: '',
        type: 'public',
        selfDeclaredMadeForKids: 'no',
        tags: [],
      };
    case 'tiktok':
      return {
        content_posting_method: 'UPLOAD',
        privacy_level: '',
        comment: false,
        duet: false,
        stitch: false,
        autoAddMusic: 'no',
        disclose: false,
        brand_organic_toggle: false,
        brand_content_toggle: false,
        video_made_with_ai: false,
        direct_post_consent: false,
        creator_info_loaded: false,
      };
    case 'x':
      return { who_can_reply_post: 'everyone' };
    case 'gmb':
      return { topicType: 'STANDARD', callToActionType: 'NONE' };
    case 'mewe':
      return { postType: 'timeline' };
    default:
      return {};
  }
}

export function getMaximumCharacters(integration: PublisherIntegration) {
  if (integration.identifier !== 'x') {
    return getProviderRule(integration.identifier).maximumCharacters;
  }

  try {
    const settings = JSON.parse(
      integration.additionalSettings || '[]'
    ) as Array<{
      title?: string;
      value?: boolean;
    }>;
    return settings.some(
      (setting) => setting.title === 'Verified' && setting.value
    )
      ? 4_000
      : 280;
  } catch {
    return 280;
  }
}

function validateProviderSettings(
  integration: PublisherIntegration,
  settings: PublisherProviderSettings
) {
  switch (integration.identifier) {
    case 'devto':
      return String(settings.title || '').trim().length >= 2;
    case 'medium':
      return (
        String(settings.title || '').trim().length >= 2 &&
        String(settings.subtitle || '').trim().length >= 2
      );
    case 'x':
      return [
        'everyone',
        'following',
        'mentionedUsers',
        'subscribers',
        'verified',
      ].includes(String(settings.who_can_reply_post || ''));
    case 'instagram':
    case 'instagram-standalone':
      return ['post', 'story'].includes(String(settings.post_type || ''));
    case 'youtube':
      return (
        String(settings.title || '').trim().length >= 2 &&
        ['public', 'private', 'unlisted'].includes(String(settings.type || ''))
      );
    case 'tiktok': {
      const method = String(settings.content_posting_method || '');
      const validBase =
        ['DIRECT_POST', 'UPLOAD'].includes(method) &&
        ['yes', 'no'].includes(String(settings.autoAddMusic || '')) &&
        typeof settings.comment === 'boolean' &&
        typeof settings.duet === 'boolean' &&
        typeof settings.stitch === 'boolean' &&
        typeof settings.disclose === 'boolean' &&
        typeof settings.brand_organic_toggle === 'boolean' &&
        typeof settings.brand_content_toggle === 'boolean' &&
        typeof settings.video_made_with_ai === 'boolean';

      if (!validBase) return false;
      if (
        settings.disclose &&
        !settings.brand_organic_toggle &&
        !settings.brand_content_toggle
      ) {
        return false;
      }
      if (method === 'UPLOAD') return true;
      return (
        settings.creator_info_loaded === true &&
        settings.direct_post_consent === true &&
        Boolean(settings.privacy_level)
      );
    }
    case 'gmb':
      return (
        settings.topicType === 'STANDARD' &&
        settings.callToActionType === 'NONE'
      );
    case 'mewe':
      return settings.postType === 'timeline';
    default:
      return true;
  }
}

export function validatePublisherForm(
  input: PublisherValidationInput
): PublisherValidationErrors {
  const errors: PublisherValidationErrors = {};

  if (!input.selectedIntegrations.length) {
    errors.accounts = 'Selecione pelo menos uma conta disponível.';
  } else if (
    input.selectedIntegrations.some(
      (integration) =>
        integration.refreshNeeded ||
        !getProviderRule(integration.identifier).supported
    )
  ) {
    errors.accounts = 'Uma das contas selecionadas não está disponível.';
  }

  if (!input.content.trim() && !input.media.length) {
    errors.content = 'Escreva um conteúdo ou adicione uma mídia.';
  } else {
    const tooLong = input.selectedIntegrations.find((integration) => {
      const length =
        integration.identifier === 'x'
          ? weightedLength(input.content)
          : input.content.length;
      return length > getMaximumCharacters(integration);
    });
    if (tooLong) {
      errors.content = `O conteúdo excede o limite de ${getMaximumCharacters(
        tooLong
      )} caracteres para ${tooLong.name}.`;
    }
  }

  const invalidSettings = input.selectedIntegrations.find(
    (integration) =>
      !validateProviderSettings(
        integration,
        input.settingsByIntegration[integration.id] || {}
      )
  );
  if (invalidSettings) {
    errors.settings = `Complete as configurações obrigatórias de ${invalidSettings.name}.`;
  }

  if (input.uploadInProgress) {
    errors.media = 'Aguarde a conclusão do upload.';
  } else if (input.uploadHasErrors) {
    errors.media = 'Remova ou tente novamente os uploads com erro.';
  } else {
    const invalidMedia = input.selectedIntegrations
      .map((integration) => ({
        integration,
        message: validateProviderMedia(integration.identifier, input.media),
      }))
      .find((result) => result.message);
    if (invalidMedia) {
      errors.media = `${invalidMedia.integration.name}: ${invalidMedia.message}`;
    }
  }

  if (input.mode === 'schedule') {
    if (!input.scheduleDate || !input.scheduleTime) {
      errors.schedule = 'Informe data e horário para o agendamento.';
    } else {
      const schedule = new Date(`${input.scheduleDate}T${input.scheduleTime}`);
      if (
        Number.isNaN(schedule.getTime()) ||
        schedule.getTime() <= Date.now()
      ) {
        errors.schedule = 'Escolha uma data e horário futuros.';
      }
    }
  }

  return errors;
}
