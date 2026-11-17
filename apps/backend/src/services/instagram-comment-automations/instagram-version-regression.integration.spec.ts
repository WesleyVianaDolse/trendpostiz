jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));

const mockActivityBridge: Record<string, (...args: any[]) => any> = {};
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () =>
    new Proxy(
      {},
      {
        get:
          (_, key: string) =>
          (...args: any[]) =>
            mockActivityBridge[key](...args),
      }
    ),
}));

import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { InstagramWebhookController } from '@gitroom/backend/api/routes/instagram.webhook.controller';
import { InstagramWebhookEventsService } from '@gitroom/nestjs-libraries/database/prisma/instagram-webhooks/instagram-webhook-events.service';
import { InstagramWebhookEventsRepository } from '@gitroom/nestjs-libraries/database/prisma/instagram-webhooks/instagram-webhook-events.repository';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PlatformService } from '@gitroom/nestjs-libraries/database/prisma/platform/platform.service';
import { AutomationRecoveryService } from '@gitroom/nestjs-libraries/automation-recovery/automation-recovery.service';
import { InstagramCommentAutomationDispatcherService } from '@gitroom/nestjs-libraries/instagram-comment-automation/instagram-comment-automation-dispatcher.service';
import { InstagramStandaloneMessagingService } from '@gitroom/nestjs-libraries/integrations/social/instagram-standalone-messaging.service';
import { instagramCommentAutomationWorkflow } from '@gitroom/orchestrator/workflows/instagram-comment-automation.workflow';

const root = path.resolve(__dirname, '../../../../..');
const revisions = [
  '35ac133fc37d0b85c8b002a22fbd0134d23e3312',
  '36f4cd9971d5f304b0ab94f373160ea632341ac4',
];
const sources = {
  repository:
    'libraries/nestjs-libraries/src/database/prisma/instagram-comment-automations/instagram-comment-automation.repository.ts',
  service:
    'libraries/nestjs-libraries/src/instagram-comment-automation/instagram-comment-automation.service.ts',
  messaging:
    'libraries/nestjs-libraries/src/integrations/social/instagram-comment-messaging.service.ts',
};
const sourceAt = (revision: string, file: string) =>
  execFileSync('git', ['show', `${revision}:${file}`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
function loadAt(revision: string, file: string) {
  const javascript = ts.transpileModule(sourceAt(revision, file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = { exports: {} as any };
  const relativeRequire = (id: string) =>
    require(id.startsWith('.')
      ? path.resolve(root, path.dirname(file), id)
      : id);
  new Function('require', 'module', 'exports', javascript)(
    relativeRequire,
    loaded,
    loaded.exports
  );
  return loaded.exports;
}

const databaseUrl = process.env.INSTAGRAM_REGRESSION_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite(
  'v1.7.3 versus v1.7.4: signed HTTP ingress and real isolated PostgreSQL',
  () => {
    let db: PrismaClient;
    const originalFetch = global.fetch;
    const originalSecret = process.env.FACEBOOK_APP_SECRET;
    let app: any;
    let controllerUrl: string;
    let service: any;
    let executions: any;
    let queue: Array<{ webhookEventId: string }>;
    let deliveries: Array<{ channel: string; url: string }>;
    let orgId: string;
    let integration: any;
    let automation: any;
    let directMode: 'denied' | 'throw' = 'denied';

    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        url.hostname !== '127.0.0.1' ||
        url.username !== 'ig_regression' ||
        url.pathname !== '/ig_regression' ||
        !url.port
      ) {
        throw new Error(
          'Only the explicitly selected disposable loopback ig_regression database is allowed'
        );
      }
      db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      await db.$connect();
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      if (app) {
        await app.close();
        app = undefined;
      }
    });
    afterAll(async () => {
      if (db) await db.$disconnect();
      if (originalSecret === undefined) delete process.env.FACEBOOK_APP_SECRET;
      else process.env.FACEBOOK_APP_SECRET = originalSecret;
    });

    async function setup(revision: string, provider = 'instagram') {
      queue = [];
      deliveries = [];
      directMode = 'denied';
      const id = randomUUID();
      orgId = (
        await db.organization.create({ data: { name: `Regression ${id}` } })
      ).id;
      integration = await db.integration.create({
        data: {
          organizationId: orgId,
          name: 'Test account',
          providerIdentifier: provider,
          type: 'social',
          internalId: `ig-${id}`,
          facebookPageId: provider === 'instagram' ? `page-${id}` : null,
          token: 'fixture-only-token',
          webhookCommentsSubscribed: true,
          webhookMessagesSubscribed: provider !== 'instagram',
        },
      });
      automation = await db.instagramCommentAutomation.create({
        data: {
          integrationId: integration.id,
          mediaId: `media-${id}`,
          enabled: true,
          matchType: 'CONTAINS',
          publicReplyEnabled: true,
          publicReplyText: 'Public response',
          privateReplyEnabled: true,
          privateReplyText: 'Private response',
          triggers: {
            create: { phrase: 'Eu quero', normalizedPhrase: 'eu quero' },
          },
        },
      });
      const repositoryModule = loadAt(revision, sources.repository);
      const messagingModule = loadAt(revision, sources.messaging);
      const serviceModule = loadAt(revision, sources.service);
      executions = new repositoryModule.InstagramCommentAutomationRepository(
        db
      );
      const messaging = new messagingModule.InstagramCommentMessagingService(
        new InstagramStandaloneMessagingService(),
        new messagingModule.InstagramFacebookCommentMessagingStrategy()
      );
      service = new serviceModule.InstagramCommentAutomationService(
        executions,
        messaging,
        new PlatformService(db as any)
      );
      for (const method of [
        'prepare',
        'deliverPublicReply',
        'deliverPrivateReply',
        'markDeliveryFailedAfterRetries',
        'finalize',
      ]) {
        mockActivityBridge[method] = (...args: any[]) =>
          service[method](...args);
      }
      const integrations = new IntegrationRepository(
        { model: db } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      const integrationService = new IntegrationService(
        integrations,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      const events = new InstagramWebhookEventsService(
        new InstagramWebhookEventsRepository({ model: db } as any),
        integrationService
      );
      const dispatcher = new InstagramCommentAutomationDispatcherService(
        {
          client: {
            getRawClient: () => ({
              workflow: {
                start: async (_name: string, options: any) => {
                  queue.push(options.args[0]);
                },
              },
            }),
          },
        } as any,
        executions,
        new AutomationRecoveryService(db as any)
      );
      jest.spyOn(dispatcher, 'onModuleInit').mockImplementation(() => {});
      // Do not bootstrap the app or worker. An HTTP test module has only the real
      // webhook controller, persistence services and dispatcher; Temporal is bridged.
      const testing = await Test.createTestingModule({
        controllers: [InstagramWebhookController],
        providers: [
          { provide: InstagramWebhookEventsService, useValue: events },
          {
            provide: InstagramCommentAutomationDispatcherService,
            useValue: dispatcher,
          },
        ],
      }).compile();
      app = testing.createNestApplication({ rawBody: true, logger: false });
      await app.listen(0, '127.0.0.1');
      controllerUrl = `${await app.getUrl()}/public/webhooks/instagram`;
      // Suppress lifecycle reconciliation in this harness: queued work is drained
      // explicitly below, never by a real Temporal server or a production queue.
      queue = [];
      process.env.FACEBOOK_APP_SECRET = 'fixture-facebook-secret';
      jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (
          !['graph.facebook.com', 'graph.instagram.com'].includes(url.hostname)
        )
          throw new Error('Unexpected outbound request in isolated test');
        const channel = url.pathname.endsWith('/replies')
          ? 'public'
          : 'private';
        deliveries.push({ channel, url: `${url.origin}${url.pathname}` });
        if (channel === 'public')
          return new Response(JSON.stringify({ id: `reply-${randomUUID()}` }));
        if (directMode === 'throw')
          throw new Error('Simulated transport failure');
        return new Response(
          JSON.stringify({
            error: { code: 10, message: 'Private permission denied' },
          }),
          { status: 400 }
        );
      });
    }
    async function receive(
      commentId = randomUUID(),
      authorId = randomUUID(),
      text = 'Eu quero',
      signatureValid = true
    ) {
      const body = {
        object: 'instagram',
        entry: [
          {
            id: integration.internalId,
            time: Math.floor(Date.now() / 1000),
            changes: [
              {
                field: 'comments',
                value: {
                  id: commentId,
                  from: { id: authorId },
                  text,
                  media: { id: automation.mediaId },
                },
              },
            ],
          },
        ],
      };
      const raw = JSON.stringify(body);
      const signature = `sha256=${createHmac(
        'sha256',
        signatureValid ? 'fixture-facebook-secret' : 'wrong-secret'
      )
        .update(raw)
        .digest('hex')}`;
      const response = await originalFetch(controllerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature,
        },
        body: raw,
      });
      expect(response.status).toBe(signatureValid ? 201 : 403);
      return { commentId, authorId };
    }
    async function drain() {
      // Controller dispatch is intentionally async. Yield once for workflow.start.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const pending = queue.splice(0);
      for (const args of pending)
        await instagramCommentAutomationWorkflow(args);
    }

    it('identifies immutable ingress, matching and workflow sources between the exact commits', () => {
      for (const file of [
        'apps/backend/src/api/routes/instagram.webhook.controller.ts',
        'libraries/nestjs-libraries/src/database/prisma/instagram-webhooks/instagram-webhook-events.service.ts',
        'libraries/nestjs-libraries/src/database/prisma/instagram-webhooks/instagram-webhook-events.repository.ts',
        'libraries/nestjs-libraries/src/instagram-comment-automation/instagram-comment-matching.ts',
        'libraries/nestjs-libraries/src/instagram-comment-automation/instagram-comment-automation-dispatcher.service.ts',
        'apps/orchestrator/src/workflows/instagram-comment-automation.workflow.ts',
        'apps/orchestrator/src/activities/instagram-comment-automation.activity.ts',
        'libraries/nestjs-libraries/src/database/prisma/schema.prisma',
      ])
        expect(sourceAt(revisions[0], file)).toBe(sourceAt(revisions[1], file));
      expect(
        loadAt(
          revisions[0],
          sources.service
        ).InstagramCommentAutomationService.prototype.prepare.toString()
      ).toBe(
        loadAt(
          revisions[1],
          sources.service
        ).InstagramCommentAutomationService.prototype.prepare.toString()
      );
    });

    it.each(revisions)(
      '%s creates an execution and public success despite a real persisted Direct failure',
      async (revision) => {
        await setup(revision);
        const { commentId } = await receive();
        const persisted = await db.instagramWebhookEvent.findUniqueOrThrow({
          where: { externalCommentId: commentId },
        });
        expect(persisted.status).toBe('RECEIVED');
        expect(
          await db.instagramCommentAutomationExecution.count({
            where: { automationId: automation.id },
          })
        ).toBe(0);
        await drain();
        const execution =
          await db.instagramCommentAutomationExecution.findFirstOrThrow({
            where: { automationId: automation.id },
          });
        expect(execution).toMatchObject({
          publicReplyStatus: 'SUCCESS',
          privateReplyStatus: 'FAILED',
          publicReplyId: expect.any(String),
          processedAt: expect.any(Date),
        });
        expect(deliveries.map((delivery) => delivery.channel)).toEqual([
          'public',
          'private',
        ]);
        expect(deliveries[1].url).toContain(
          revision === revisions[1]
            ? integration.facebookPageId
            : integration.internalId
        );
        expect(
          await db.instagramCommentAutomationExecution.count({
            where: { automationId: automation.id },
          })
        ).toBe(1);
        expect(
          (
            await db.instagramWebhookEvent.findUniqueOrThrow({
              where: { externalCommentId: commentId },
            })
          ).status
        ).toBe(revision === revisions[1] ? 'FAILED' : 'PROCESSED');
      }
    );

    it('v1.7.4 never reserves Direct before public delivery or execution creation, even when reservation errors', async () => {
      await setup(revisions[1]);
      const claim = jest
        .spyOn(executions, 'claimFacebookPrivateReplyAttempt')
        .mockRejectedValue(new Error('Isolated Direct reservation failure'));
      const { commentId } = await receive();
      await drain();
      const execution =
        await db.instagramCommentAutomationExecution.findFirstOrThrow({
          where: { externalCommentId: commentId },
        });
      expect(claim).toHaveBeenCalled();
      expect(execution.publicReplyStatus).toBe('SUCCESS');
      expect(execution.privateReplyStatus).toBe('FAILED');
      expect(deliveries.map((delivery) => delivery.channel)).toEqual([
        'public',
      ]);
    });

    it('v1.7.4 deduplicates redelivery and a second comment by the same author', async () => {
      await setup(revisions[1]);
      const first = await receive();
      await drain();
      await receive(first.commentId, first.authorId);
      await drain();
      await receive(randomUUID(), first.authorId);
      await drain();
      expect(
        await db.instagramCommentAutomationExecution.count({
          where: { automationId: automation.id },
        })
      ).toBe(1);
      expect(
        deliveries.filter((delivery) => delivery.channel === 'public')
      ).toHaveLength(1);
      expect(
        deliveries.filter((delivery) => delivery.channel === 'private')
      ).toHaveLength(1);
    });

    it('distinguishes a received/persisted comment from work not yet consumed by a worker', async () => {
      await setup(revisions[1]);
      const first = await receive();
      const row = await db.instagramWebhookEvent.findUniqueOrThrow({
        where: { externalCommentId: first.commentId },
      });
      expect(row.status).toBe('RECEIVED');
      expect(
        await db.instagramCommentAutomationExecution.count({
          where: { automationId: automation.id },
        })
      ).toBe(0);
      expect(deliveries).toHaveLength(0);
      expect(queue).toHaveLength(1);
      await drain();
      expect(
        await db.instagramCommentAutomationExecution.count({
          where: { automationId: automation.id },
        })
      ).toBe(1);
    });

    it('rejects invalid signatures and records a non-matching trigger without an execution', async () => {
      await setup(revisions[1]);
      const rejected = await receive(
        randomUUID(),
        randomUUID(),
        'Eu quero',
        false
      );
      expect(
        await db.instagramWebhookEvent.count({
          where: { externalCommentId: rejected.commentId },
        })
      ).toBe(0);
      const ignored = await receive(randomUUID(), randomUUID(), 'Outro texto');
      await drain();
      expect(
        (
          await db.instagramWebhookEvent.findUniqueOrThrow({
            where: { externalCommentId: ignored.commentId },
          })
        ).status
      ).toBe('SKIPPED');
      expect(
        await db.instagramCommentAutomationExecution.count({
          where: { automationId: automation.id },
        })
      ).toBe(0);
    });

    it('keeps Standalone public delivery independent of Direct', async () => {
      await setup(revisions[1], 'instagram-standalone');
      // A shared fixture secret is intentional; real signature-family filtering is used.
      const saved = process.env.INSTAGRAM_APP_SECRET;
      process.env.INSTAGRAM_APP_SECRET = 'fixture-facebook-secret';
      try {
        await receive();
        await drain();
        const execution =
          await db.instagramCommentAutomationExecution.findFirstOrThrow({
            where: { automationId: automation.id },
          });
        expect(execution).toMatchObject({
          publicReplyStatus: 'SUCCESS',
          privateReplyStatus: 'FAILED',
        });
        expect(
          deliveries.every((delivery) =>
            delivery.url.startsWith('https://graph.instagram.com/')
          )
        ).toBe(true);
      } finally {
        if (saved === undefined) delete process.env.INSTAGRAM_APP_SECRET;
        else process.env.INSTAGRAM_APP_SECRET = saved;
      }
    });
  }
);
