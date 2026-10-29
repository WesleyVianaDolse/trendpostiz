import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  organizationDeletionScope,
  purgeOrganizationRecords,
} from '@gitroom/nestjs-libraries/database/prisma/platform/organization-deletion';
import { OrganizationFilesService } from '@gitroom/nestjs-libraries/upload/organization-files.service';
import { ResumableUploadService } from '@gitroom/nestjs-libraries/upload/resumable.upload.service';
import { TemporalService } from 'nestjs-temporal-core';
import { Client } from '@temporalio/client';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  organizationId as organizationAttribute,
  postId as postAttribute,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';

// No backup, export or retained payload is created. Pending rows remain inaccessible until
// physical media, workflow history and relational data have all been erased successfully.
@Injectable()
export class OrganizationDeletionService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(
    private readonly db: PrismaService,
    private readonly files: OrganizationFilesService,
    private readonly uploads: ResumableUploadService,
    private readonly temporal: TemporalService
  ) {}

  onModuleInit() {
    void this.processPending();
    this.timer = setInterval(() => void this.processPending(), 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async processPending() {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.db.organization.findMany({
        where: { deletionRequestedAt: { not: null } },
        select: { id: true },
        orderBy: { deletionRequestedAt: 'asc' },
      });
      for (const org of pending) await this.process(org.id);
    } catch {
      /* Startup/schema/network failures are retried; never log personal payloads. */
    } finally {
      this.running = false;
    }
  }

  async process(id: string) {
    const claim = await this.db.organization.updateMany({
      where: {
        id,
        deletionRequestedAt: { not: null },
        OR: [
          { deletionProcessingAt: null },
          { deletionProcessingAt: { lt: new Date(Date.now() - 10 * 60000) } },
        ],
      },
      data: { deletionProcessingAt: new Date(), deletionError: null },
    });
    if (!claim.count) return;
    let stage = 'workflow';
    try {
      const settings = await this.db.platformSettings.findUniqueOrThrow({
        where: { id: 'platform' },
      });
      const scope = await organizationDeletionScope(this.db, id, [
        settings.ownerUserId,
      ]);
      if (scope.blocker) throw new Error('cross_tenant');
      await this.purgeWorkflows(id);
      stage = 'cache';
      await this.purgeCache(id);
      stage = 'files';
      const media = await this.db.media.findMany({
        where: { organizationId: id },
        select: { id: true, path: true, thumbnail: true },
      });
      const posts = await this.db.post.findMany({
        where: { organizationId: id },
        select: { id: true, image: true },
      });
      const urls = new Set<string>(
        media.flatMap((item) =>
          [item.path, item.thumbnail].filter(
            (value): value is string => !!value
          )
        )
      );
      const collect = (value: unknown) => {
        if (Array.isArray(value)) {
          value.forEach(collect);
          return;
        }
        if (value && typeof value === 'object')
          for (const [key, entry] of Object.entries(value)) {
            if (
              ['path', 'thumbnail', 'thumbnailUrl'].includes(key) &&
              typeof entry === 'string'
            )
              urls.add(entry);
            else if (typeof entry === 'object') collect(entry);
          }
      };
      for (const post of posts) {
        try {
          collect(JSON.parse(post.image || '[]'));
        } catch {
          throw new Error('invalid_media');
        }
      }
      const remove = async (url: string) => {
        // A file independently referenced by a surviving tenant belongs to that tenant too.
        const shared = await this.db.media.count({
          where: {
            organizationId: { not: id },
            OR: [{ path: url }, { thumbnail: url }],
          },
        });
        if (!shared) await this.files.removeOwnedFile(url);
      };
      for (const url of urls) await remove(url);
      await this.uploads.purgeOrganizationUploads(id, remove);
      stage = 'database';
      await this.db.$transaction(
        async (tx) => {
          // Do not drop file references if an in-flight upload added media after the cleanup scan.
          const currentMedia = await tx.media.findMany({
            where: { organizationId: id },
            select: { id: true, path: true, thumbnail: true },
          });
          const currentPosts = await tx.post.findMany({
            where: { organizationId: id },
            select: { id: true, image: true },
          });
          if (
            JSON.stringify(
              currentMedia.sort((a, b) => a.id.localeCompare(b.id))
            ) !==
              JSON.stringify(media.sort((a, b) => a.id.localeCompare(b.id))) ||
            JSON.stringify(
              currentPosts.sort((a, b) => a.id.localeCompare(b.id))
            ) !== JSON.stringify(posts.sort((a, b) => a.id.localeCompare(b.id)))
          )
            throw new Error('changed_during_cleanup');
          await purgeOrganizationRecords(tx, id);
        },
        { isolationLevel: 'Serializable', timeout: 60000 }
      );
    } catch {
      const message =
        stage === 'workflow'
          ? 'A limpeza dos agendamentos não foi concluída. Tente novamente.'
          : stage === 'cache'
          ? 'A limpeza dos dados temporários não foi concluída. Tente novamente.'
          : stage === 'files'
          ? 'A limpeza dos arquivos não foi concluída. Tente novamente.'
          : 'A exclusão dos registros não foi concluída. Tente novamente.';
      await this.db.organization
        .updateMany({
          where: { id },
          data: { deletionProcessingAt: null, deletionError: message },
        })
        .catch(() => {});
    }
  }

  private async purgeCache(id: string) {
    let cursor = '0';
    const escapedId = id.replace(/([\\*?\[\]])/g, '\\$1');
    do {
      const [next, keys] = await ioRedis.scan(
        cursor,
        'MATCH',
        `integration:${escapedId}:*`,
        'COUNT',
        100
      );
      if (keys.length) await ioRedis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
    do {
      const [next, keys] = await ioRedis.scan(
        cursor,
        'MATCH',
        'organization:*',
        'COUNT',
        100
      );
      if (keys.length) {
        const values = await ioRedis.mget(...keys);
        for (let index = 0; index < keys.length; index++)
          if (values[index] === id) {
            const state = keys[index].slice('organization:'.length);
            await ioRedis.del(
              ...[
                'organization',
                'login',
                'refresh',
                'onboarding',
                'redirect',
                'external',
                'webhookUrl',
              ].map((prefix) => `${prefix}:${state}`)
            );
          }
      }
      cursor = next;
    } while (cursor !== '0');
  }

  private async purgeWorkflows(id: string) {
    const client = this.temporal.client.getRawClient();
    if (!client) throw new Error('Temporal unavailable');
    const [posts, events, autoposts] = await Promise.all([
      this.db.post.findMany({
        where: { organizationId: id },
        select: { id: true },
      }),
      this.db.instagramWebhookEvent.findMany({
        where: { integration: { organizationId: id } },
        select: { id: true },
      }),
      this.db.autoPost.findMany({
        where: { organizationId: id },
        select: { id: true },
      }),
    ]);
    const escape = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const queries = [`organizationId = ${escape(id)}`];
    const ownPostIds = new Set(posts.map((post) => post.id));
    const deterministic = [
      ...posts.map((post) => `post_${post.id}`),
      ...events.map((event) => `instagram-comment-${event.id}`),
      ...autoposts.map((autopost) => `autopost-${autopost.id}`),
      `digest_email_workflow_${id}`,
      `streak_${id}`,
    ];
    const deterministicIds = new Set(deterministic);
    for (let index = 0; index < posts.length; index += 50)
      queries.push(
        posts
          .slice(index, index + 50)
          .map((post) => `postId = ${escape(post.id)}`)
          .join(' OR ')
      );
    const executionIds = new Set<string>();
    const executions = new Map<string, { workflowId: string; runId: string }>();
    for (const query of queries)
      for await (const execution of client.workflow.list({ query })) {
        const orgValue =
          execution.typedSearchAttributes?.get(organizationAttribute) ??
          execution.searchAttributes?.organizationId?.[0];
        const postValue =
          execution.typedSearchAttributes?.get(postAttribute) ??
          execution.searchAttributes?.postId?.[0];
        const namedForOwnedPost =
          execution.workflowId.startsWith('post_') &&
          posts.some((post) =>
            execution.workflowId.startsWith(`post_${post.id}_`)
          );
        // Text search is only discovery; verify exact ownership before deleting an execution.
        if (
          orgValue !== id &&
          !(typeof postValue === 'string' && ownPostIds.has(postValue)) &&
          !deterministicIds.has(execution.workflowId) &&
          !namedForOwnedPost
        )
          continue;
        executions.set(`${execution.workflowId}:${execution.runId}`, {
          workflowId: execution.workflowId,
          runId: execution.runId,
        });
      }
    for (const execution of executions.values()) {
      await this.deleteExecution(client, execution.workflowId, execution.runId);
      executionIds.add(execution.workflowId);
    }
    for (const workflowId of deterministic)
      if (!executionIds.has(workflowId)) {
        // Deterministic IDs cover recent executions not yet visible in Temporal's search index.
        try {
          const execution = await client.workflow
            .getHandle(workflowId)
            .describe();
          await this.deleteExecution(client, workflowId, execution.runId);
        } catch (error) {
          if (
            (error as { name?: string }).name !== 'WorkflowNotFoundError' &&
            (error as { code?: number }).code !== 5
          )
            throw error;
        }
      }
  }

  private async deleteExecution(
    client: Client,
    workflowId: string,
    runId: string
  ) {
    try {
      const handle = client.workflow.getHandle(workflowId, runId);
      const state = await handle.describe();
      if (state.status.name === 'RUNNING')
        await handle.terminate('Organization permanently deleted');
      await client.workflow.workflowService.deleteWorkflowExecution({
        namespace: client.options.namespace || 'default',
        workflowExecution: { workflowId, runId },
      });
    } catch (error) {
      if (
        (error as { name?: string }).name !== 'WorkflowNotFoundError' &&
        (error as { code?: number }).code !== 5
      )
        throw error;
    }
  }
}
