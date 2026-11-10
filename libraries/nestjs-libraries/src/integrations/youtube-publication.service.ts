import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Integration, Post } from '@prisma/client';
import { TemporalService } from 'nestjs-temporal-core';
import { ApplicationFailure } from '@temporalio/common';
import { PrismaService } from '../database/prisma/prisma.service';
import { IntegrationManager } from './integration.manager';
import { RefreshIntegrationService } from './refresh.integration.service';
import { RefreshToken, BadBody } from './social.abstract';
import { PostDetails } from './social/social.integrations.interface';
import { YoutubeProvider } from './social/youtube.provider';

const MAX_ATTEMPTS = 12;
const RETRYABLE = ['pending', 'retrying'];

function errorDetails(error: any) {
  const status = Number(error?.response?.status || error?.code || 0);
  const reason = error?.response?.data?.error?.errors?.[0]?.reason || '';
  const seconds = Number(error?.response?.headers?.['retry-after']);
  const retryDate = Date.parse(error?.response?.headers?.['retry-after']);
  const retryAfter =
    Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : Number.isFinite(retryDate)
      ? Math.max(0, retryDate - Date.now())
      : 0;
  return { status, reason, retryAfter };
}

@Injectable()
export class YoutubePublicationService {
  constructor(
    private prisma: PrismaService,
    private integrations: IntegrationManager,
    private refresh: RefreshIntegrationService,
    private temporal: TemporalService
  ) {}

  private provider() {
    return this.integrations.getSocialIntegration('youtube') as YoutubeProvider;
  }

  private async post(orgId: string, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: {
        id: postId,
        organizationId: orgId,
        deletedAt: null,
        integration: { providerIdentifier: 'youtube' },
      },
      include: {
        integration: true,
        organization: { select: { suspendedAt: true } },
      },
    });
    if (!post)
      throw new NotFoundException('Publicação do YouTube não encontrada.');
    return post;
  }

  // A workflow ID is stable across activity retries, but changes for intentional
  // repeat posts. User-supplied settings cannot set or reset this checkpoint.
  async publish(
    integration: Integration,
    details: PostDetails[],
    uploadKey: string
  ) {
    let post = await this.post(integration.organizationId, details[0].id);
    if (
      post.youtubeUploadKey !== uploadKey ||
      post.youtubeUploadState === 'ready'
    ) {
      if (post.youtubeUploadState === 'uploading') {
        throw ApplicationFailure.nonRetryable(
          'Resultado do upload incerto. Confira o canal e reconcilie o vídeo antes de reenviar.',
          'youtube_upload_uncertain'
        );
      }
      const claimed = await this.prisma.post.updateMany({
        where: {
          id: post.id,
          youtubeUploadKey: post.youtubeUploadKey,
          youtubeUploadState: post.youtubeUploadState,
        },
        data: {
          youtubeUploadKey: uploadKey,
          youtubeUploadState: 'uploading',
          youtubeVideoId: null,
          youtubeThumbnailStatus: null,
          youtubeThumbnailPath: null,
          youtubeThumbnailError: null,
          youtubeThumbnailAttempts: 0,
          youtubeThumbnailNextAt: null,
        },
      });
      if (!claimed.count) throw new ConflictException('Upload já iniciado.');
      post = {
        ...post,
        youtubeUploadKey: uploadKey,
        youtubeUploadState: 'uploading',
        youtubeVideoId: null,
      };
    } else if (
      post.youtubeUploadState === 'uploading' ||
      !post.youtubeVideoId
    ) {
      throw ApplicationFailure.nonRetryable(
        'Resultado do upload incerto. Confira o canal e reconcilie o vídeo antes de reenviar.',
        'youtube_upload_uncertain'
      );
    }

    const thumbnailPath =
      details[0].settings?.thumbnail?.path || details[0].media?.[0]?.thumbnail;
    let checkpointSaved = !!post.youtubeVideoId;
    let uploadReturned = false;
    let result;
    try {
      result = await this.provider().post(
        integration.internalId,
        integration.token,
        [
          {
            ...details[0],
            youtubeUpload: {
              videoId: post.youtubeVideoId || undefined,
              onUploaded: async (videoId) => {
                uploadReturned = true;
                await this.prisma.post.update({
                  where: { id: post.id, youtubeUploadKey: uploadKey },
                  data: {
                    youtubeVideoId: videoId,
                    youtubeUploadState: 'uploaded',
                    releaseId: videoId,
                    releaseURL: `https://www.youtube.com/watch?v=${videoId}`,
                    youtubeThumbnailPath: thumbnailPath || null,
                    youtubeThumbnailStatus: thumbnailPath ? 'pending' : null,
                  },
                });
                checkpointSaved = true;
              },
            },
          },
        ]
      );
    } catch (error) {
      const { status } = errorDetails(error);
      // Only a definitive API rejection permits another upload. Connection loss,
      // worker death or a failed DB checkpoint must never issue videos.insert again.
      if (
        !checkpointSaved &&
        !uploadReturned &&
        status >= 400 &&
        status < 500 &&
        status !== 408
      ) {
        await this.prisma.post.updateMany({
          where: { id: post.id, youtubeUploadKey: uploadKey },
          data: { youtubeUploadState: 'ready' },
        });
        if (status === 401)
          throw new RefreshToken(
            'youtube',
            '{}',
            '{}',
            'Reconecte sua conta do YouTube.'
          );
        throw new BadBody(
          'youtube',
          '{}',
          '{}',
          'O YouTube rejeitou o upload do vídeo. Confira os dados e as permissões.'
        );
      }
      throw error;
    }
    // Thumbnail scheduling is independent of the successful video publication.
    // A scheduler outage remains visible and can be resumed through retry().
    try {
      await this.start(integration.organizationId, post.id, result[0].postId);
    } catch {
      await this.prisma.post.updateMany({
        where: {
          id: post.id,
          youtubeVideoId: result[0].postId,
          youtubeThumbnailStatus: { in: RETRYABLE },
        },
        data: {
          youtubeThumbnailStatus: 'waiting',
          youtubeThumbnailError:
            'O vídeo foi enviado, mas não foi possível agendar a capa. Tente enviar somente a capa novamente.',
        },
      });
    }
    return result;
  }

  private async start(orgId: string, postId: string, videoId: string) {
    const post = await this.post(orgId, postId);
    if (!post.youtubeThumbnailPath || post.youtubeThumbnailStatus === 'applied')
      return;
    await this.temporal.client
      .getRawClient()
      .workflow.signalWithStart('youtubeThumbnailWorkflow', {
        workflowId: `youtube_thumbnail_${postId}_${videoId}`,
        taskQueue: 'youtube',
        workflowIdConflictPolicy: 'USE_EXISTING',
        signal: 'wake',
        signalArgs: [],
        args: [{ organizationId: orgId, postId, videoId }],
      });
  }

  async status(orgId: string, postId: string) {
    const post = await this.post(orgId, postId);
    return {
      videoId: post.youtubeVideoId,
      status: post.youtubeThumbnailStatus,
      attempts: post.youtubeThumbnailAttempts,
      error: post.youtubeThumbnailError,
      nextAttemptAt: post.youtubeThumbnailNextAt,
      canRetry:
        ['failed', 'waiting', 'uncertain'].includes(
          post.youtubeThumbnailStatus || ''
        ) ||
        (post.youtubeThumbnailStatus === 'pending' &&
          post.youtubeThumbnailAttempts === 0),
    };
  }

  async retry(orgId: string, postId: string) {
    const post = await this.post(orgId, postId);
    if (!post.youtubeVideoId || !post.youtubeThumbnailPath)
      throw new BadRequestException('Não há capa para reenviar.');
    if (post.organization.suspendedAt || post.adminPausedAt) {
      throw new BadRequestException('O envio desta publicação está pausado.');
    }
    if (RETRYABLE.includes(post.youtubeThumbnailStatus || '')) {
      await this.start(orgId, postId, post.youtubeVideoId);
      return this.status(orgId, postId);
    }
    if (
      !['failed', 'waiting', 'uncertain'].includes(
        post.youtubeThumbnailStatus || ''
      )
    ) {
      throw new ConflictException(
        'A capa já está aplicada ou tem uma tentativa em andamento.'
      );
    }
    if (post.integration.disabled || post.integration.refreshNeeded) {
      throw new BadRequestException(
        'Reconecte e habilite a conta do YouTube antes de tentar novamente.'
      );
    }
    if (
      post.youtubeThumbnailNextAt &&
      post.youtubeThumbnailNextAt > new Date()
    ) {
      throw new BadRequestException(
        'Aguarde o prazo indicado pelo YouTube antes de tentar novamente.'
      );
    }
    await this.prisma.post.updateMany({
      where: {
        id: postId,
        youtubeVideoId: post.youtubeVideoId,
        youtubeThumbnailStatus: post.youtubeThumbnailStatus,
      },
      data: {
        youtubeThumbnailStatus: 'pending',
        youtubeThumbnailAttempts: 0,
        youtubeThumbnailError: null,
        youtubeThumbnailNextAt: null,
      },
    });
    await this.start(orgId, postId, post.youtubeVideoId);
    return this.status(orgId, postId);
  }

  private async save(
    post: Post,
    status: string,
    error: string | null = null,
    delay = 0
  ) {
    await this.prisma.post.updateMany({
      where: { id: post.id, youtubeVideoId: post.youtubeVideoId },
      data: {
        youtubeThumbnailStatus: status,
        youtubeThumbnailError: error,
        youtubeThumbnailNextAt: delay ? new Date(Date.now() + delay) : null,
      },
    });
    return { done: !RETRYABLE.includes(status), delay };
  }

  async attempt(orgId: string, postId: string, videoId: string) {
    const post = await this.post(orgId, postId);
    if (
      post.youtubeVideoId !== videoId ||
      !post.youtubeThumbnailPath ||
      ['applied', 'failed', 'waiting', 'uncertain'].includes(
        post.youtubeThumbnailStatus || ''
      )
    )
      return { done: true, delay: 0 };
    if (post.youtubeThumbnailStatus === 'applying') {
      return this.save(
        post,
        'uncertain',
        'A resposta do envio da capa não foi confirmada. Confira no YouTube antes de tentar novamente.'
      );
    }
    if (
      post.youtubeThumbnailNextAt &&
      post.youtubeThumbnailNextAt > new Date()
    ) {
      return {
        done: false,
        delay: post.youtubeThumbnailNextAt.getTime() - Date.now(),
      };
    }
    if (post.youtubeThumbnailAttempts >= MAX_ATTEMPTS) {
      return this.save(
        post,
        'waiting',
        'A capa continua pendente após o limite de tentativas. O vídeo foi preservado; tente enviar somente a capa novamente.'
      );
    }
    if (post.organization.suspendedAt || post.adminPausedAt) {
      return this.save(
        post,
        'waiting',
        'O envio da capa está pausado pelo administrador.'
      );
    }
    if (post.integration.disabled || post.integration.refreshNeeded) {
      return this.save(
        post,
        'failed',
        'Reconecte e habilite a conta do YouTube para enviar a capa.'
      );
    }
    const attempt = post.youtubeThumbnailAttempts + 1;
    const counted = await this.prisma.post.updateMany({
      where: {
        id: post.id,
        youtubeVideoId: videoId,
        youtubeThumbnailAttempts: post.youtubeThumbnailAttempts,
        youtubeThumbnailStatus: { in: RETRYABLE },
      },
      data: { youtubeThumbnailAttempts: attempt },
    });
    if (!counted.count) return { done: false, delay: 30000 };
    let token = post.integration.token;
    const withRefresh = async <T>(fn: (token: string) => Promise<T>) => {
      try {
        return await fn(token);
      } catch (error) {
        if (errorDetails(error).status !== 401) throw error;
        const refreshed = await this.refresh.refresh(post.integration);
        if (!refreshed || !refreshed.accessToken) throw error;
        token = refreshed.accessToken;
        return fn(token);
      }
    };
    let thumbnailAccepted = false;
    try {
      // Layout is an editorial choice, not a Shorts classification signal.
      // Gate every thumbnail: YouTube can classify an upload as a Short itself.
      const processing = await withRefresh((token) =>
        this.provider().processingStatus(token, videoId)
      );
      if (['failed', 'terminated'].includes(processing || '')) {
        return this.save(
          post,
          'failed',
          'O processamento do vídeo falhou no YouTube; a capa não foi aplicada.'
        );
      }
      if (processing !== 'succeeded') {
        return this.save(
          post,
          'pending',
          'Aguardando o processamento do vídeo no YouTube.',
          Math.min(30 * 1000 * 2 ** (attempt - 1), 15 * 60 * 1000)
        );
      }
      const claimed = await this.prisma.post.updateMany({
        where: {
          id: post.id,
          youtubeVideoId: videoId,
          youtubeThumbnailStatus: { in: RETRYABLE },
        },
        data: {
          youtubeThumbnailStatus: 'applying',
          youtubeThumbnailError: null,
        },
      });
      if (!claimed.count) return { done: true, delay: 0 };
      await withRefresh((token) =>
        this.provider().setThumbnail(token, videoId, post.youtubeThumbnailPath!)
      );
      thumbnailAccepted = true;
      return this.save(post, 'applied');
    } catch (error) {
      // If recording success fails, keep the applying marker for reconciliation;
      // do not issue another quota-consuming set call automatically.
      if (thumbnailAccepted) throw error;
      const { status, reason, retryAfter } = errorDetails(error);
      if (
        status === 401 ||
        (error as any)?.message?.includes('invalid_grant')
      ) {
        return this.save(
          post,
          'failed',
          'A autorização expirou. Reconecte a conta e tente enviar somente a capa novamente.'
        );
      }
      const transient =
        !status ||
        status === 408 ||
        status === 429 ||
        status >= 500 ||
        (status === 403 &&
          [
            'rateLimitExceeded',
            'userRateLimitExceeded',
            'quotaExceeded',
            'dailyLimitExceeded',
          ].includes(reason));
      if (transient) {
        const delay = Math.max(
          retryAfter,
          reason === 'quotaExceeded' || reason === 'dailyLimitExceeded'
            ? 24 * 60 * 60 * 1000
            : Math.min(60 * 1000 * 2 ** (attempt - 1), 30 * 60 * 1000)
        );
        if (
          reason === 'quotaExceeded' ||
          reason === 'dailyLimitExceeded' ||
          retryAfter > 24 * 60 * 60 * 1000
        ) {
          return this.save(
            post,
            'waiting',
            'O YouTube limitou a quota de envio de capas. Aguarde o prazo indicado e tente enviar somente a capa novamente.',
            delay
          );
        }
        return this.save(
          post,
          'retrying',
          'Falha temporária ao enviar a capa. O vídeo está preservado; nova tentativa agendada.',
          delay
        );
      }
      return this.save(
        post,
        'failed',
        status === 403
          ? 'O YouTube negou o envio da capa (403). Verifique a permissão de thumbnails personalizadas e a verificação do canal antes de tentar novamente.'
          : `O YouTube rejeitou a capa (${status}). Use JPEG/PNG de até 50 MB e confira se o vídeo ainda existe.`
      );
    }
  }

  async stop(orgId: string, postId: string, videoId: string) {
    const post = await this.post(orgId, postId);
    if (
      post.youtubeVideoId !== videoId ||
      post.youtubeThumbnailStatus === 'applied'
    )
      return;
    return this.save(
      post,
      post.youtubeThumbnailStatus === 'applying' ? 'uncertain' : 'waiting',
      'O envio da capa foi interrompido após o limite de tentativas. O vídeo está preservado. Confira no YouTube e tente enviar somente a capa novamente.'
    );
  }
}
