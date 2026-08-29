import {
  PublisherAcceptedSubmission,
  PublisherIntegration,
  PublisherPostPayload,
  PublisherPostResult,
  PublisherSubmissionState,
} from '../model/publisher.types';

export type PublisherFetch = (
  path: string,
  options?: RequestInit
) => Promise<Response>;

export type ShortlinkPreference = 'ASK' | 'YES' | 'NO';

export type PublisherSubmissionErrorCode =
  | 'duplicate'
  | 'session'
  | 'permission'
  | 'limit'
  | 'integration'
  | 'validation'
  | 'network'
  | 'server'
  | 'unexpected';

export class PublisherSubmissionError extends Error {
  constructor(
    message: string,
    public readonly code: PublisherSubmissionErrorCode,
    public readonly ambiguous = false,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'PublisherSubmissionError';
  }
}

export function isPublisherSubmissionBusy(state: PublisherSubmissionState) {
  return state === 'validating' || state === 'submitting';
}

interface SubmitPublisherPostInput {
  fetcher: PublisherFetch;
  payload: PublisherPostPayload;
  integrations: PublisherIntegration[];
  shortlinkPreference: ShortlinkPreference;
  confirmShortlink: () => boolean | Promise<boolean>;
  onPostStarted?: () => void;
}

function responseMessage(body: unknown) {
  if (!body || typeof body !== 'object') return '';
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.filter((item) => typeof item === 'string').join(' ');
  return typeof message === 'string' ? message : '';
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    // The global useFetch handler may already have consumed an error body (notably 402).
    return undefined;
  }
}

function isPostResult(value: unknown): value is PublisherPostResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<PublisherPostResult>;
  return typeof result.postId === 'string' && typeof result.integration === 'string';
}

export function getShortlinkMessages(
  payload: PublisherPostPayload,
  integrations: PublisherIntegration[]
) {
  const integrationsThatStripLinks = new Set(
    integrations.filter((integration) => integration.stripLinks).map((integration) => integration.id)
  );

  return payload.posts
    .filter((post) => !integrationsThatStripLinks.has(post.integration.id))
    .flatMap((post) => post.value.map((value) => value.content));
}

export async function resolvePublisherShortlink({
  fetcher,
  payload,
  integrations,
  shortlinkPreference,
  confirmShortlink,
}: Omit<SubmitPublisherPostInput, 'onPostStarted'>) {
  if (shortlinkPreference === 'NO') return false;

  const response = await fetcher('/posts/should-shortlink', {
    method: 'POST',
    body: JSON.stringify({ messages: getShortlinkMessages(payload, integrations) }),
  });

  if (!response.ok) {
    throw new PublisherSubmissionError(
      'Não foi possível verificar os links desta publicação. O post não foi enviado.',
      response.status === 401 ? 'session' : 'validation',
      false,
      response.status
    );
  }

  const body = (await safeJson(response)) as { ask?: unknown } | undefined;
  if (typeof body?.ask !== 'boolean') {
    throw new PublisherSubmissionError(
      'O servidor retornou uma resposta inesperada ao verificar os links. O post não foi enviado.',
      'unexpected'
    );
  }

  if (!body.ask) return false;
  if (shortlinkPreference === 'YES') return true;
  return Boolean(await confirmShortlink());
}

function classifyHttpError(status: number, body: unknown) {
  const detail = responseMessage(body);
  const normalized = detail.toLowerCase();

  if (status === 401) {
    return new PublisherSubmissionError(
      'Sua sessão expirou. Entre novamente antes de tentar publicar.',
      'session',
      false,
      status
    );
  }
  if (status === 402) {
    return new PublisherSubmissionError(
      'O limite mensal de publicações do plano foi atingido. Revise seu plano antes de tentar novamente.',
      'limit',
      false,
      status
    );
  }
  if (status === 403) {
    return new PublisherSubmissionError(
      'Seu usuário não tem permissão para criar esta publicação.',
      'permission',
      false,
      status
    );
  }
  if (status >= 500) {
    return new PublisherSubmissionError(
      'O servidor não conseguiu concluir a solicitação. Como parte do envio pode ter sido aceita, confira a agenda antes de tentar novamente.',
      'server',
      true,
      status
    );
  }
  if (normalized.includes('integration')) {
    return new PublisherSubmissionError(
      'Uma conta selecionada é inválida, pertence a outra organização ou precisa ser reconectada. Volte e revise as contas.',
      'integration',
      false,
      status
    );
  }
  if (status === 400 || status === 404 || status === 422) {
    return new PublisherSubmissionError(
      detail
        ? `O backend rejeitou o payload ou as configurações do provider: ${detail}`
        : 'O backend rejeitou o payload ou as configurações do provider. Volte e revise os campos.',
      'validation',
      false,
      status
    );
  }

  return new PublisherSubmissionError(
    detail || `Não foi possível enviar a publicação (HTTP ${status}).`,
    'unexpected',
    false,
    status
  );
}

export async function postPublisherPayload(
  fetcher: PublisherFetch,
  payload: PublisherPostPayload
): Promise<PublisherAcceptedSubmission> {
  let response: Response;
  try {
    response = await fetcher('/posts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch {
    throw new PublisherSubmissionError(
      'A conexão foi interrompida e não foi possível confirmar se o servidor recebeu a publicação. Não envie novamente sem antes conferir a agenda.',
      'network',
      true
    );
  }

  const body = await safeJson(response);
  if (!response.ok) throw classifyHttpError(response.status, body);

  if (!Array.isArray(body) || body.length === 0 || !body.every(isPostResult)) {
    throw new PublisherSubmissionError(
      'O servidor aceitou a requisição, mas retornou uma resposta inesperada. Confira a agenda antes de tentar novamente.',
      'unexpected',
      true,
      response.status
    );
  }

  return { httpStatus: response.status, posts: body, payload };
}

export async function submitPublisherPost(
  input: SubmitPublisherPostInput
): Promise<PublisherAcceptedSubmission> {
  let shortLink: boolean;
  try {
    shortLink = await resolvePublisherShortlink(input);
  } catch (error) {
    if (error instanceof PublisherSubmissionError) throw error;
    throw new PublisherSubmissionError(
      'Não foi possível verificar os links desta publicação. O post não foi enviado.',
      'network'
    );
  }

  const finalPayload = { ...input.payload, shortLink };
  input.onPostStarted?.();
  return postPublisherPayload(input.fetcher, finalPayload);
}

export function createPublisherSubmissionGuard() {
  let inFlight = false;

  return {
    get active() {
      return inFlight;
    },
    async run<T>(operation: () => Promise<T>) {
      if (inFlight) {
        throw new PublisherSubmissionError(
          'Esta publicação já está sendo enviada.',
          'duplicate'
        );
      }

      inFlight = true;
      try {
        return await operation();
      } finally {
        inFlight = false;
      }
    },
  };
}
