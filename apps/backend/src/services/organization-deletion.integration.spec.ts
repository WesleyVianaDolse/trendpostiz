import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { PlatformService } from '@gitroom/nestjs-libraries/database/prisma/platform/platform.service';
import { OrganizationDeletionService } from './organization-deletion.service';
import { OrganizationFilesService } from '@gitroom/nestjs-libraries/upload/organization-files.service';
import { ResumableUploadService } from '@gitroom/nestjs-libraries/upload/resumable.upload.service';
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    scan: jest.fn().mockResolvedValue(['0', []]),
    mget: jest.fn(),
    del: jest.fn(),
  },
}));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { hashPassword: () => 'hashed', fixedEncryption: () => 'key' },
}));

const testUrl = process.env.ORGANIZATION_DELETION_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
suite(
  'permanent organization erasure with isolated PostgreSQL and real local files',
  () => {
    let db: PrismaClient, platform: PlatformService, directory: string;
    const environment = { ...process.env };
    let ownerId: string;
    beforeAll(async () => {
      const url = new URL(testUrl!);
      if (
        url.hostname !== '127.0.0.1' ||
        url.pathname !== '/deletion_test' ||
        url.username !== 'deletion_test'
      )
        throw new Error('An isolated local deletion_test database is required');
      db = new PrismaClient({ datasources: { db: { url: testUrl } } });
      await db.$connect();
      const owner = await db.user.create({
        data: {
          email: `owner-${randomUUID()}@example.test`,
          providerName: 'LOCAL',
          activated: true,
          isPlatformAdmin: true,
          timezone: 0,
        },
      });
      ownerId = owner.id;
      await db.platformSettings.upsert({
        where: { id: 'platform' },
        create: { id: 'platform', ownerUserId: ownerId },
        update: { ownerUserId: ownerId },
      });
      platform = new PlatformService(db as any);
      directory = await mkdtemp(path.join(tmpdir(), 'trendpostiz-delete-'));
      process.env.UPLOAD_DIRECTORY = directory;
      process.env.FRONTEND_URL = 'https://app.example.test';
      process.env.STORAGE_PROVIDER = 'local';
    });
    afterAll(async () => {
      await db?.$disconnect();
      for (const key of [
        'UPLOAD_DIRECTORY',
        'FRONTEND_URL',
        'STORAGE_PROVIDER',
      ]) {
        if (environment[key] === undefined) delete process.env[key];
        else process.env[key] = environment[key];
      }
      const approvedPrefix = path.resolve(tmpdir(), 'trendpostiz-delete-');
      if (directory && path.resolve(directory).startsWith(approvedPrefix))
        await rm(directory, { recursive: true, force: true });
    });

    function temporalFixture() {
      const deleted = jest.fn().mockResolvedValue({});
      const terminate = jest.fn().mockResolvedValue({});
      const client = {
        options: { namespace: 'isolated-test' },
        workflow: {
          list: jest.fn().mockImplementation(async function* () {
            /* no production workflow is contacted */
          }),
          getHandle: jest.fn().mockImplementation(() => ({
            describe: jest.fn().mockRejectedValue(
              Object.assign(new Error('missing'), {
                name: 'WorkflowNotFoundError',
              })
            ),
            terminate,
          })),
          workflowService: { deleteWorkflowExecution: deleted },
        },
      };
      return {
        temporal: { client: { getRawClient: () => client } } as any,
        client,
        deleted,
        terminate,
      };
    }
    async function baseFixture() {
      const suffix = randomUUID();
      const org = await db.organization.create({
        data: { name: `Cliente ${suffix}` },
      });
      const keep = await db.organization.create({
        data: { name: `Preservada ${suffix}` },
      });
      const exclusive = await db.user.create({
        data: {
          email: `exclusive-${suffix}@example.test`,
          name: 'Dados pessoais exclusivos',
          providerName: 'LOCAL',
          activated: true,
          timezone: 0,
          organizations: { create: { organizationId: org.id } },
        },
      });
      const shared = await db.user.create({
        data: {
          email: `shared-${suffix}@example.test`,
          providerName: 'LOCAL',
          activated: true,
          timezone: 0,
          organizations: {
            create: [{ organizationId: org.id }, { organizationId: keep.id }],
          },
        },
      });
      const integration = await db.integration.create({
        data: {
          internalId: suffix,
          organizationId: org.id,
          providerIdentifier: 'instagram',
          name: 'Conta excluída',
          type: 'social',
          token: 'test-only-token',
        },
      });
      const keepIntegration = await db.integration.create({
        data: {
          internalId: suffix,
          organizationId: keep.id,
          providerIdentifier: 'instagram',
          name: 'Conta preservada',
          type: 'social',
          token: 'test-only-token',
        },
      });
      const filename = `${suffix}.png`;
      const publicPath = `https://app.example.test/uploads/2026/10/${filename}`;
      await mkdir(path.join(directory, '2026/10'), { recursive: true });
      await writeFile(
        path.join(directory, '2026/10', filename),
        'private-media'
      );
      const media = await db.media.create({
        data: { name: filename, path: publicPath, organizationId: org.id },
      });
      const post = await db.post.create({
        data: {
          organizationId: org.id,
          integrationId: integration.id,
          content: 'Conteúdo privado',
          group: suffix,
          publishDate: new Date(),
          image: JSON.stringify([{ id: media.id, path: publicPath }]),
        },
      });
      const keepPost = await db.post.create({
        data: {
          organizationId: keep.id,
          integrationId: keepIntegration.id,
          content: 'Preservar este conteúdo',
          group: suffix,
          publishDate: new Date(),
          submittedForOrganizationId: org.id,
        },
      });
      return {
        org,
        keep,
        exclusive,
        shared,
        integration,
        keepIntegration,
        filename,
        publicPath,
        media,
        post,
        keepPost,
      };
    }

    it('requires the current exact name and the owner before making any irreversible change', async () => {
      const f = await baseFixture();
      await expect(
        platform.requestOrganizationDeletion(ownerId, f.org.id, 'EXCLUIR')
      ).rejects.toThrow('exatamente');
      expect(
        (await db.organization.findUniqueOrThrow({ where: { id: f.org.id } }))
          .deletionRequestedAt
      ).toBeNull();
      expect(
        await readFile(path.join(directory, '2026/10', f.filename), 'utf8')
      ).toBe('private-media');
      const delegate = await db.user.create({
        data: {
          email: `${randomUUID()}@example.test`,
          providerName: 'LOCAL',
          isPlatformAdmin: true,
          timezone: 0,
        },
      });
      await expect(
        platform.requestOrganizationDeletion(delegate.id, f.org.id, f.org.name)
      ).rejects.toThrow('Somente o titular');
    });

    it('erases the relational graph, owned files, temporary uploads and exclusive users while preserving another tenant', async () => {
      const f = await baseFixture();
      const customer = await db.customer.create({
        data: { orgId: f.org.id, name: 'Cliente removido' },
      });
      await db.integration.update({
        where: { id: f.integration.id },
        data: { customerId: customer.id },
      });
      const tag = await db.tags.create({
        data: { orgId: f.org.id, name: 'Privada', color: 'red' },
      });
      await db.tagsPosts.create({ data: { postId: f.post.id, tagId: tag.id } });
      await db.post.create({
        data: {
          organizationId: f.org.id,
          integrationId: f.integration.id,
          parentPostId: f.post.id,
          group: f.post.group,
          content: 'Comentário programado',
          publishDate: new Date(),
        },
      });
      await db.comments.create({
        data: {
          content: 'Comentário interno',
          organizationId: f.org.id,
          postId: f.post.id,
          userId: f.exclusive.id,
        },
      });
      await db.errors.create({
        data: {
          organizationId: f.org.id,
          postId: f.post.id,
          message: 'Erro privado',
          platform: 'instagram',
        },
      });
      const webhook = await db.webhooks.create({
        data: {
          organizationId: f.org.id,
          name: 'Webhook',
          url: 'https://example.test/hook',
        },
      });
      await db.integrationsWebhooks.create({
        data: { integrationId: f.integration.id, webhookId: webhook.id },
      });
      await db.plugs.create({
        data: {
          organizationId: f.org.id,
          integrationId: f.integration.id,
          plugFunction: 'test',
          data: '{}',
        },
      });
      await db.exisingPlugData.create({
        data: {
          integrationId: f.integration.id,
          methodName: 'test',
          value: 'private',
        },
      });
      await db.autoPost.create({
        data: {
          organizationId: f.org.id,
          title: 'Automação',
          onSlot: false,
          syncLast: false,
          url: 'https://example.test/rss',
          lastUrl: '',
          active: true,
          addPicture: false,
          generateContent: false,
          integrations: '[]',
        },
      });
      const event = await db.instagramWebhookEvent.create({
        data: {
          integrationId: f.integration.id,
          instagramAccountId: 'account',
          externalCommentId: randomUUID(),
          status: 'RECEIVED',
          payload: { comment: 'private' },
        },
      });
      const automation = await db.instagramCommentAutomation.create({
        data: {
          integrationId: f.integration.id,
          mediaId: 'media',
          matchType: 'EXACT',
          triggers: { create: { phrase: 'teste', normalizedPhrase: 'teste' } },
        },
      });
      await db.instagramCommentAutomationExecution.create({
        data: {
          automationId: automation.id,
          webhookEventId: event.id,
          authorId: 'private-author',
          externalCommentId: event.externalCommentId!,
        },
      });
      const group = await db.messagesGroup.create({
        data: {
          buyerOrganizationId: f.org.id,
          buyerId: f.exclusive.id,
          sellerId: f.shared.id,
          messages: { create: { from: 'BUYER', content: 'Mensagem privada' } },
        },
      });
      const order = await db.orders.create({
        data: {
          buyerId: f.exclusive.id,
          sellerId: f.shared.id,
          messageGroupId: group.id,
          status: 'PENDING',
          ordersItems: {
            create: { integrationId: f.integration.id, quantity: 1, price: 1 },
          },
        },
      });
      await db.payoutProblems.create({
        data: {
          orderId: order.id,
          userId: f.exclusive.id,
          postId: f.post.id,
          amount: 1,
          status: 'test',
        },
      });
      await db.post.update({
        where: { id: f.keepPost.id },
        data: { submittedForOrderId: order.id },
      });
      const app = await db.oAuthApp.create({
        data: {
          organizationId: f.org.id,
          name: 'App',
          clientId: randomUUID(),
          clientSecret: 'test-only',
          redirectUrl: 'https://example.test',
          pictureId: f.media.id,
        },
      });
      await db.oAuthAuthorization.create({
        data: {
          organizationId: f.keep.id,
          oauthAppId: app.id,
          userId: f.shared.id,
        },
      });
      await db.user.update({
        where: { id: f.shared.id },
        data: { pictureId: f.media.id },
      });
      await db.socialMediaAgency.create({
        data: {
          userId: f.exclusive.id,
          name: 'Agência',
          shortDescription: 'privado',
          description: 'privado',
          niches: { create: { niche: 'teste' } },
        },
      });
      await db.itemUser.create({
        data: { userId: f.exclusive.id, key: 'private-key' },
      });
      await db.subscription.create({
        data: {
          organizationId: f.org.id,
          subscriptionTier: 'PRO',
          period: 'MONTHLY',
          totalChannels: 3,
        },
      });
      await db.signatures.create({
        data: {
          organizationId: f.org.id,
          content: 'Assinatura',
          autoAdd: false,
        },
      });
      await db.sets.create({
        data: {
          organizationId: f.org.id,
          name: 'Conjunto',
          content: 'privado',
        },
      });
      await db.thirdParty.create({
        data: {
          organizationId: f.org.id,
          identifier: 'test',
          internalId: 'test',
          name: 'test',
          apiKey: 'private',
        },
      });
      await db.gitHub.create({
        data: { organizationId: f.org.id, login: 'test', token: 'private' },
      });
      await db.notifications.create({
        data: { organizationId: f.org.id, content: 'Mensagem' },
      });
      await db.credits.create({
        data: { organizationId: f.org.id, credits: 1 },
      });
      await db.usedCodes.create({ data: { orgId: f.org.id, code: 'private' } });
      await db.adminAuditLog.create({
        data: {
          actorId: ownerId,
          action: 'organization.create',
          targetType: 'organization',
          targetId: f.org.id,
          details: { name: f.org.name, email: f.exclusive.email },
        },
      });
      const thread = await db.mastra_threads.create({
        data: {
          id: randomUUID(),
          resourceId: f.org.id,
          title: 'Conversa privada',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await db.mastra_messages.create({
        data: {
          id: randomUUID(),
          thread_id: thread.id,
          content: 'Memória privada',
          role: 'user',
          type: 'text',
          createdAt: new Date(),
        },
      });

      const traceId = randomUUID();
      const otherTraceId = randomUUID();
      await db.mastra_scorers.create({
        data: {
          id: randomUUID(),
          scorerId: 'test',
          runId: randomUUID(),
          traceId,
          scorer: {},
          score: 1,
          input: { content: 'privado' },
          output: {},
          source: 'test',
          resourceId: f.org.id,
          threadId: thread.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await db.mastra_traces.create({
        data: {
          id: randomUUID(),
          name: 'private trace',
          traceId,
          scope: 'test',
          kind: 1,
          startTime: BigInt(1),
          endTime: BigInt(2),
          createdAt: new Date(),
        },
      });
      const unscoredTraceId = randomUUID();
      await db.mastra_traces.create({
        data: {
          id: randomUUID(),
          name: 'unscored private trace',
          traceId: unscoredTraceId,
          scope: 'test',
          kind: 1,
          attributes: { resourceId: f.org.id },
          startTime: BigInt(1),
          endTime: BigInt(2),
          createdAt: new Date(),
        },
      });
      await db.$executeRaw`CREATE TABLE IF NOT EXISTS "mastra_ai_spans" ("traceId" TEXT, "spanId" TEXT, "name" TEXT, "spanType" TEXT, "scope" JSONB, "metadata" JSONB, "attributes" JSONB, "startedAt" TIMESTAMP, "createdAt" TIMESTAMP, "updatedAt" TIMESTAMP, "isEvent" BOOLEAN)`;
      await db.$executeRaw`INSERT INTO "mastra_ai_spans" ("traceId", "spanId", "name", "spanType", "metadata", "startedAt", "createdAt", "updatedAt", "isEvent") VALUES (${traceId}, ${randomUUID()}, 'private span', 'agent', '{}'::jsonb, NOW(), NOW(), NOW(), false), (${otherTraceId}, ${randomUUID()}, 'preserved span', 'agent', ${JSON.stringify(
        { resourceId: f.keep.id }
      )}::jsonb, NOW(), NOW(), NOW(), false)`;

      const uploadId = randomUUID();
      const keepUploadId = randomUUID();
      for (const [key, orgId] of [
        [uploadId, f.org.id],
        [keepUploadId, f.keep.id],
      ]) {
        await mkdir(path.join(directory, '.resumable-uploads', key), {
          recursive: true,
        });
        await writeFile(
          path.join(directory, '.resumable-uploads', key, 'metadata.json'),
          JSON.stringify({
            uploadId: key,
            organizationId: orgId,
            originalName: 'private.png',
            completedPath: orgId === f.org.id ? f.publicPath : undefined,
          })
        );
        await writeFile(
          path.join(directory, '.resumable-uploads', key, '0.part'),
          'private-chunk'
        );
      }
      const preview = await platform.organizationDeletionPreview(
        ownerId,
        f.org.id
      );
      expect(preview).toMatchObject({
        deletedUsers: 1,
        preservedUsers: 1,
        blocker: null,
      });
      await platform.requestOrganizationDeletion(ownerId, f.org.id, f.org.name);
      await expect(
        platform.setSuspended(ownerId, f.org.id, false)
      ).rejects.toThrow('exclusão definitiva');
      const temporal = temporalFixture();
      const worker = new OrganizationDeletionService(
        db as any,
        new OrganizationFilesService(),
        new ResumableUploadService(),
        temporal.temporal
      );
      await worker.process(f.org.id);
      const remaining = await db.organization.findUnique({
        where: { id: f.org.id },
      });
      expect(remaining?.deletionError).toBeUndefined();
      expect(remaining).toBeNull();
      expect(
        await db.user.findUnique({ where: { id: f.exclusive.id } })
      ).toBeNull();
      expect(
        await db.user.findUnique({ where: { id: f.shared.id } })
      ).toMatchObject({ email: f.shared.email, pictureId: null });
      expect(
        await db.userOrganization.findMany({ where: { userId: f.shared.id } })
      ).toMatchObject([{ organizationId: f.keep.id }]);
      expect(
        await db.post.findUnique({ where: { id: f.keepPost.id } })
      ).toMatchObject({
        content: 'Preservar este conteúdo',
        submittedForOrganizationId: null,
        submittedForOrderId: null,
      });
      expect(
        await db.integration.findUnique({ where: { id: f.keepIntegration.id } })
      ).not.toBeNull();
      expect(
        await db.mastra_messages.findMany({ where: { thread_id: thread.id } })
      ).toEqual([]);
      expect(
        await db.mastra_threads.findUnique({ where: { id: thread.id } })
      ).toBeNull();
      expect(
        await db.mastra_scorers.count({ where: { resourceId: f.org.id } })
      ).toBe(0);
      expect(
        await db.mastra_traces.count({
          where: { traceId: { in: [traceId, unscoredTraceId] } },
        })
      ).toBe(0);
      expect(
        await db.$queryRaw`SELECT "traceId" FROM "mastra_ai_spans" WHERE "traceId" = ${traceId}`
      ).toEqual([]);
      expect(
        await db.$queryRaw`SELECT "traceId" FROM "mastra_ai_spans" WHERE "traceId" = ${otherTraceId}`
      ).toHaveLength(1);
      await expect(
        access(path.join(directory, '2026/10', f.filename))
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        access(path.join(directory, '.resumable-uploads', uploadId))
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        access(path.join(directory, '.resumable-uploads', keepUploadId))
      ).resolves.toBeUndefined();
      const audit = await db.adminAuditLog.findMany({
        where: { targetId: f.org.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].action).toBe('organization.delete');
      expect(JSON.stringify(audit)).not.toContain(f.org.name);
      expect(JSON.stringify(audit)).not.toContain(f.exclusive.email);
    });

    it('keeps failure visible and retries physical removal without marking the organization deleted early', async () => {
      const f = await baseFixture();
      await platform.requestOrganizationDeletion(ownerId, f.org.id, f.org.name);
      const files = {
        removeOwnedFile: jest
          .fn()
          .mockRejectedValue(new Error('storage unavailable')),
      };
      const temporal = temporalFixture();
      await new OrganizationDeletionService(
        db as any,
        files as any,
        new ResumableUploadService(),
        temporal.temporal
      ).process(f.org.id);
      expect(
        await db.organization.findUnique({ where: { id: f.org.id } })
      ).toMatchObject({
        deletionError: expect.stringContaining('arquivos'),
        suspendedAt: expect.any(Date),
      });
      expect(
        await db.media.count({ where: { organizationId: f.org.id } })
      ).toBe(1);
      await new OrganizationDeletionService(
        db as any,
        new OrganizationFilesService(),
        new ResumableUploadService(),
        temporal.temporal
      ).process(f.org.id);
      expect(
        await db.organization.findUnique({ where: { id: f.org.id } })
      ).toBeNull();
    });

    it('refuses cross-tenant marketplace cascades before deleting files or disabling the organization', async () => {
      const f = await baseFixture();
      const group = await db.messagesGroup.create({
        data: {
          buyerOrganizationId: f.keep.id,
          buyerId: f.shared.id,
          sellerId: ownerId,
        },
      });
      await db.orders.create({
        data: {
          buyerId: f.shared.id,
          sellerId: ownerId,
          messageGroupId: group.id,
          status: 'PENDING',
          ordersItems: {
            create: { integrationId: f.integration.id, quantity: 1, price: 1 },
          },
        },
      });
      expect(
        (await platform.organizationDeletionPreview(ownerId, f.org.id)).blocker
      ).toContain('outras organizações');
      await expect(
        platform.requestOrganizationDeletion(ownerId, f.org.id, f.org.name)
      ).rejects.toThrow('outras organizações');
      expect(
        (await db.organization.findUniqueOrThrow({ where: { id: f.org.id } }))
          .suspendedAt
      ).toBeNull();
    });
  }
);
