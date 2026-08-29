import { expandPostsList } from '@gitroom/helpers/utils/posts.list.minify';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { getProviderRule } from '../model/provider-rules';
import {
  PublisherIntegration,
  PublisherPostPayload,
  PublisherProviderSettings,
} from '../model/publisher.types';
import { PublisherFetch } from '../submission/publisher-submission';
import {
  PublisherPostState,
  ScheduledListPage,
  ScheduledPostDetail,
} from './scheduled.types';

dayjs.extend(utc);

export type ScheduledErrorCode =
  | 'session'
  | 'permission'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'network'
  | 'server'
  | 'unexpected'
  | 'duplicate';

export class ScheduledApiError extends Error {
  constructor(
    message: string,
    public readonly code: ScheduledErrorCode,
    public readonly ambiguous = false,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'ScheduledApiError';
  }
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function bodyMessage(body: unknown) {
  if (!body || typeof body !== 'object') return '';
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.filter((item) => typeof item === 'string').join(' ');
  return typeof message === 'string' ? message : '';
}

function httpError(status: number, body: unknown, mutation: boolean) {
  const detail = bodyMessage(body);
  if (status === 401) return new ScheduledApiError('Sua sessão expirou. Entre novamente para continuar.', 'session', false, status);
  if (status === 403) return new ScheduledApiError('Seu usuário não tem permissão para esta ação.', 'permission', false, status);
  if (status === 404) return new ScheduledApiError('Esta publicação não existe mais.', 'not_found', false, status);
  if (status === 409) return new ScheduledApiError('A publicação mudou enquanto esta tela estava aberta. Os dados foram atualizados.', 'conflict', false, status);
  if (status === 400 || status === 422) {
    return new ScheduledApiError(detail ? `O backend rejeitou a alteração: ${detail}` : 'O backend rejeitou os dados enviados.', 'validation', false, status);
  }
  if (status >= 500) {
    return new ScheduledApiError(
      mutation
        ? 'O servidor falhou durante a alteração. Confira o estado atual antes de tentar novamente.'
        : 'O servidor não conseguiu carregar esta publicação.',
      'server',
      mutation,
      status
    );
  }
  return new ScheduledApiError(detail || `Resposta inesperada do servidor (HTTP ${status}).`, 'unexpected', mutation, status);
}

async function requestJson(fetcher: PublisherFetch, path: string, options?: RequestInit, mutation = false) {
  let response: Response;
  try {
    response = await fetcher(path, options);
  } catch {
    throw new ScheduledApiError(
      mutation
        ? 'A conexão foi interrompida e o resultado da alteração é incerto. Atualize os dados antes de tentar novamente.'
        : 'Não foi possível carregar os dados. Verifique sua conexão.',
      'network',
      mutation
    );
  }
  const body = await safeJson(response);
  if (!response.ok) throw httpError(response.status, body, mutation);
  return body;
}

export function parseScheduledList(body: unknown): ScheduledListPage {
  const expanded = expandPostsList(body) as Partial<ScheduledListPage>;
  if (!Array.isArray(expanded.posts)) throw new ScheduledApiError('A agenda retornou um formato inesperado.', 'unexpected');
  return {
    posts: expanded.posts,
    total: Number(expanded.total || 0),
    page: Number(expanded.page || 0),
    limit: Number(expanded.limit || 20),
    hasMore: Boolean(expanded.hasMore),
  };
}

export async function getScheduledPage(fetcher: PublisherFetch, page: number, limit = 20) {
  const body = await requestJson(fetcher, `/posts/list?state=scheduled&page=${page}&limit=${limit}`);
  return parseScheduledList(body);
}

export function parseScheduledDetail(body: unknown): ScheduledPostDetail {
  if (!body || typeof body !== 'object') throw new ScheduledApiError('O detalhe retornou um formato inesperado.', 'unexpected');
  const detail = body as Partial<ScheduledPostDetail>;
  if (!detail.group || !detail.integration || !Array.isArray(detail.posts) || !detail.posts.length) {
    throw new ScheduledApiError('Esta publicação não existe mais ou retornou dados incompletos.', 'not_found');
  }
  return {
    group: detail.group,
    integration: detail.integration,
    integrationPicture: detail.integrationPicture,
    settings: detail.settings || {},
    posts: detail.posts,
  };
}

export async function getScheduledDetail(fetcher: PublisherFetch, id: string) {
  return parseScheduledDetail(await requestJson(fetcher, `/posts/${encodeURIComponent(id)}`));
}

export function getDetailIntegration(detail: ScheduledPostDetail): PublisherIntegration {
  const root = detail.posts[0];
  return {
    id: detail.integration,
    name: root.integration?.name || 'Conta social',
    display: root.integration?.providerIdentifier || 'Provider',
    identifier: root.integration?.providerIdentifier || '',
    picture: detail.integrationPicture || root.integration?.picture,
  };
}

export function canEditScheduledDetail(detail: ScheduledPostDetail) {
  const integration = getDetailIntegration(detail);
  return detail.posts[0]?.state === 'QUEUE' && getProviderRule(integration.identifier).supported;
}

export function stateLabel(state: PublisherPostState) {
  return ({ QUEUE: 'Agendado', PUBLISHED: 'Publicado', ERROR: 'Erro', DRAFT: 'Rascunho' })[state] || state;
}

export function buildScheduledEditPayload(
  detail: ScheduledPostDetail,
  contents: Record<string, string>,
  settings: PublisherProviderSettings
): PublisherPostPayload {
  const root = detail.posts[0];
  return {
    type: 'schedule',
    shortLink: false,
    date: dayjs(root.publishDate).utc().format('YYYY-MM-DDTHH:mm:ss'),
    tags: (root.tags || []).map(({ tag }) => ({ value: tag.id || tag.name, label: tag.name })),
    posts: [
      {
        integration: { id: detail.integration },
        group: detail.group,
        settings: { ...settings },
        value: detail.posts.map((post) => ({
          id: post.id,
          content: contents[post.id] ?? post.content,
          delay: post.delay || 0,
          image: (post.image || []).map(({ id, path, alt, thumbnail, thumbnailTimestamp }) => ({
            id,
            path,
            ...(alt ? { alt } : {}),
            ...(thumbnail ? { thumbnail } : {}),
            ...(typeof thumbnailTimestamp === 'number' ? { thumbnailTimestamp } : {}),
          })),
        })),
      },
    ],
  };
}

export function localScheduleParts(value: string) {
  const date = dayjs(value);
  return date.isValid() ? { date: date.format('YYYY-MM-DD'), time: date.format('HH:mm') } : { date: '', time: '' };
}

export function localScheduleToUtc(date: string, time: string) {
  const value = dayjs(`${date}T${time}`);
  if (!value.isValid() || value.valueOf() <= Date.now()) throw new ScheduledApiError('Escolha uma data e horário futuros.', 'validation');
  return value.utc().format('YYYY-MM-DDTHH:mm:ss');
}

export async function ensureMutableScheduledPost(fetcher: PublisherFetch, id: string, expectedGroup: string) {
  const current = await getScheduledDetail(fetcher, id);
  if (current.group !== expectedGroup || current.posts[0]?.state !== 'QUEUE') {
    throw new ScheduledApiError('A publicação mudou de estado enquanto esta tela estava aberta. Os dados foram atualizados.', 'conflict');
  }
  return current;
}

export async function reschedulePost(fetcher: PublisherFetch, id: string, utcDate: string) {
  return requestJson(fetcher, `/posts/${encodeURIComponent(id)}/date`, {
    method: 'PUT',
    body: JSON.stringify({ date: utcDate, action: 'schedule' }),
  }, true);
}

export async function deleteScheduledPost(fetcher: PublisherFetch, group: string) {
  return requestJson(fetcher, `/posts/${encodeURIComponent(group)}`, { method: 'DELETE' }, true);
}

export function createScheduledActionGuard() {
  let active = false;
  return {
    get busy() { return active; },
    async run<T>(operation: () => Promise<T>) {
      if (active) throw new ScheduledApiError('Uma alteração já está em andamento.', 'duplicate');
      active = true;
      try { return await operation(); } finally { active = false; }
    },
  };
}
