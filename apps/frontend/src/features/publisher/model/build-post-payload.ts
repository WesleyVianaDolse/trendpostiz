import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { BuildPostPayloadInput, PublisherPostPayload } from './publisher.types';

dayjs.extend(utc);

export function formatPublisherDate(input: BuildPostPayloadInput) {
  const source =
    input.mode === 'schedule'
      ? dayjs(`${input.scheduleDate}T${input.scheduleTime}`)
      : dayjs(input.now || new Date());

  if (!source.isValid()) {
    throw new Error('Data de publicação inválida.');
  }

  // Matches ManageModal.schedule(): local date -> UTC without a trailing Z.
  return source.utc().format('YYYY-MM-DDTHH:mm:ss');
}

export function buildPostPayload(
  input: BuildPostPayloadInput
): PublisherPostPayload {
  if (!input.integrations.length) {
    throw new Error('É necessário selecionar ao menos uma integração.');
  }
  if (!input.content.trim() && !input.media?.length) {
    throw new Error('Adicione um conteúdo ou uma mídia.');
  }

  const group = input.group || makeId(10);

  return {
    type: input.mode,
    tags: [],
    shortLink: false,
    date: formatPublisherDate(input),
    posts: input.integrations.map((integration) => ({
      integration: { id: integration.id },
      group,
      settings: { ...integration.settings },
      value: [
        {
          content: input.content,
          delay: 0,
          image: (input.media || []).map(
            ({ id, path, alt, thumbnail, thumbnailTimestamp }) => ({
              id,
              path,
              ...(alt ? { alt } : {}),
              ...(thumbnail ? { thumbnail } : {}),
              ...(typeof thumbnailTimestamp === 'number'
                ? { thumbnailTimestamp }
                : {}),
            })
          ),
        },
      ],
    })),
  };
}
