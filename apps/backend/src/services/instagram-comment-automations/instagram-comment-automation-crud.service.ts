import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Integration } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { normalizeInstagramCommentPhrase } from '@gitroom/nestjs-libraries/instagram-comment-automation/instagram-comment-matching';
import {
  CreateInstagramCommentAutomationDto,
  InstagramCommentExecutionsQueryDto,
  UpdateInstagramCommentAutomationDto,
} from './instagram-comment-automation.dto';
import { InstagramMediaService } from './instagram-media.service';

@Injectable()
export class InstagramCommentAutomationCrudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: InstagramMediaService
  ) {}

  listAccounts(organizationId: string) {
    return this.prisma.integration.findMany({
      where: {
        organizationId,
        providerIdentifier: 'instagram-standalone',
        deletedAt: null,
        disabled: false,
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        profile: true,
        picture: true,
        disabled: true,
        refreshNeeded: true,
        webhookCommentsSubscribed: true,
        webhookMessagesSubscribed: true,
      },
    });
  }

  async listMedia(
    organizationId: string,
    integrationId: string,
    after?: string
  ) {
    const integration = await this.getInstagramIntegration(
      organizationId,
      integrationId
    );
    const result = await this.media.list(integration, after);
    const mediaIds = result.items.map((item: { id: string }) => item.id);
    const existing = mediaIds.length
      ? await this.prisma.instagramCommentAutomation.findMany({
          where: { integrationId, mediaId: { in: mediaIds } },
          select: { id: true, mediaId: true },
        })
      : [];
    const byMedia = new Map(existing.map((item) => [item.mediaId, item.id]));
    return {
      ...result,
      items: result.items.map((item: { id: string }) => ({
        ...item,
        automationId: byMedia.get(item.id) || null,
      })),
    };
  }

  async list(organizationId: string) {
    const automations = await this.prisma.instagramCommentAutomation.findMany({
      where: { integration: { organizationId, deletedAt: null } },
      orderBy: { updatedAt: 'desc' },
      include: {
        triggers: { orderBy: { createdAt: 'asc' } },
        integration: {
          select: { id: true, name: true, profile: true, picture: true },
        },
      },
    });
    return Promise.all(
      automations.map(async (automation) => ({
        ...automation,
        media: await this.safeMedia(
          organizationId,
          automation.integrationId,
          automation.mediaId
        ),
        metrics: await this.metrics(automation.id),
      }))
    );
  }

  async get(organizationId: string, id: string) {
    const automation = await this.findOwned(organizationId, id);
    return {
      ...automation,
      media: await this.safeMedia(
        organizationId,
        automation.integrationId,
        automation.mediaId
      ),
      metrics: await this.metrics(id),
    };
  }

  async create(
    organizationId: string,
    dto: CreateInstagramCommentAutomationDto
  ) {
    const integration = await this.getInstagramIntegration(
      organizationId,
      dto.integrationId
    );
    const data = this.validateConfiguration(dto, integration);
    await this.media.get(integration, dto.mediaId);
    try {
      const created = await this.prisma.$transaction((transaction) =>
        transaction.instagramCommentAutomation.create({
          data: {
            integrationId: dto.integrationId,
            mediaId: dto.mediaId,
            ...data.configuration,
            triggers: { create: data.triggers },
          },
          include: { triggers: true },
        })
      );
      return this.get(organizationId, created.id);
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateInstagramCommentAutomationDto
  ) {
    const automation = await this.findOwned(organizationId, id);
    const integration = await this.getInstagramIntegration(
      organizationId,
      automation.integrationId
    );
    const data = this.validateConfiguration(dto, integration);
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.instagramCommentAutomationTrigger.deleteMany({
          where: { automationId: id },
        });
        await transaction.instagramCommentAutomation.update({
          where: { id },
          data: {
            ...data.configuration,
            triggers: { create: data.triggers },
          },
        });
      });
      return this.get(organizationId, id);
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async setStatus(organizationId: string, id: string, enabled: boolean) {
    const automation = await this.findOwned(organizationId, id);
    if (
      enabled &&
      automation.privateReplyEnabled &&
      !automation.integration.webhookMessagesSubscribed
    ) {
      throw new BadRequestException(
        'Reconecte esta conta para habilitar automações com Direct.'
      );
    }
    return this.prisma.instagramCommentAutomation.update({
      where: { id },
      data: { enabled },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.findOwned(organizationId, id);
    await this.prisma.instagramCommentAutomation.update({
      where: { id },
      data: { enabled: false },
    });
    return { success: true, historyPreserved: true, enabled: false };
  }

  async executions(
    organizationId: string,
    id: string,
    query: InstagramCommentExecutionsQueryDto
  ) {
    await this.findOwned(organizationId, id);
    const where = { automationId: id };
    const [total, items] = await Promise.all([
      this.prisma.instagramCommentAutomationExecution.count({ where }),
      this.prisma.instagramCommentAutomationExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          authorId: true,
          externalCommentId: true,
          publicReplyStatus: true,
          privateReplyStatus: true,
          publicReplyError: true,
          privateReplyError: true,
          createdAt: true,
          processedAt: true,
          webhookEvent: {
            select: { authorUsername: true, commentText: true },
          },
        },
      }),
    ]);
    return {
      items,
      total,
      page: query.page,
      pages: Math.ceil(total / query.limit),
    };
  }

  private async findOwned(organizationId: string, id: string) {
    const automation = await this.prisma.instagramCommentAutomation.findFirst({
      where: { id, integration: { organizationId, deletedAt: null } },
      include: {
        triggers: true,
        integration: {
          select: {
            id: true,
            name: true,
            profile: true,
            picture: true,
            providerIdentifier: true,
            webhookMessagesSubscribed: true,
          },
        },
      },
    });
    if (!automation) throw new NotFoundException('Automação não encontrada.');
    return automation;
  }

  private async getInstagramIntegration(organizationId: string, id: string) {
    const integration = await this.prisma.integration.findFirst({
      where: { id, organizationId, deletedAt: null, disabled: false },
    });
    if (!integration) throw new NotFoundException('Conta não encontrada.');
    if (integration.providerIdentifier !== 'instagram-standalone') {
      throw new BadRequestException('A conta selecionada não é do Instagram.');
    }
    return integration;
  }

  private validateConfiguration(
    dto: UpdateInstagramCommentAutomationDto,
    integration: Pick<Integration, 'webhookMessagesSubscribed'>
  ) {
    if (!dto.publicReplyEnabled && !dto.privateReplyEnabled) {
      throw new BadRequestException('Habilite pelo menos uma resposta.');
    }
    if (dto.publicReplyEnabled && !dto.publicReplyText?.trim()) {
      throw new BadRequestException('Informe a resposta pública.');
    }
    if (dto.privateReplyEnabled && !dto.privateReplyText?.trim()) {
      throw new BadRequestException('Informe a mensagem no Direct.');
    }
    if (
      dto.enabled &&
      dto.privateReplyEnabled &&
      !integration.webhookMessagesSubscribed
    ) {
      throw new BadRequestException(
        'Reconecte esta conta para habilitar automações com Direct.'
      );
    }
    const triggers = dto.triggers.map((phrase) => ({
      phrase: phrase.trim(),
      normalizedPhrase: normalizeInstagramCommentPhrase(phrase),
    }));
    if (triggers.some((trigger) => !trigger.normalizedPhrase)) {
      throw new BadRequestException('Gatilhos vazios não são permitidos.');
    }
    if (
      new Set(triggers.map((trigger) => trigger.normalizedPhrase)).size !==
      triggers.length
    ) {
      throw new BadRequestException('Existem gatilhos duplicados.');
    }
    return {
      triggers,
      configuration: {
        matchType: dto.matchType,
        publicReplyEnabled: dto.publicReplyEnabled,
        publicReplyText: dto.publicReplyEnabled
          ? dto.publicReplyText!.trim()
          : null,
        privateReplyEnabled: dto.privateReplyEnabled,
        privateReplyText: dto.privateReplyEnabled
          ? dto.privateReplyText!.trim()
          : null,
        enabled: dto.enabled,
      },
    };
  }

  private async metrics(automationId: string) {
    const [executions, publicReplies, privateReplies, failures, last] =
      await Promise.all([
        this.prisma.instagramCommentAutomationExecution.count({
          where: { automationId },
        }),
        this.prisma.instagramCommentAutomationExecution.count({
          where: { automationId, publicReplyStatus: 'SUCCESS' },
        }),
        this.prisma.instagramCommentAutomationExecution.count({
          where: { automationId, privateReplyStatus: 'SUCCESS' },
        }),
        this.prisma.instagramCommentAutomationExecution.count({
          where: {
            automationId,
            OR: [
              { publicReplyStatus: 'FAILED' },
              { privateReplyStatus: 'FAILED' },
            ],
          },
        }),
        this.prisma.instagramCommentAutomationExecution.findFirst({
          where: { automationId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, processedAt: true },
        }),
      ]);
    return {
      executions,
      publicReplies,
      privateReplies,
      failures,
      lastExecutionAt: last?.processedAt || last?.createdAt || null,
    };
  }

  private async safeMedia(
    organizationId: string,
    integrationId: string,
    mediaId: string
  ) {
    try {
      const integration = await this.getInstagramIntegration(
        organizationId,
        integrationId
      );
      return await this.media.get(integration, mediaId);
    } catch {
      return {
        id: mediaId,
        caption: '',
        mediaType: '',
        thumbnailUrl: null,
        permalink: null,
        timestamp: null,
      };
    }
  }

  private rethrowConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Este post já possui uma automação.');
    }
    throw error;
  }
}
