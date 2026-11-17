// Executed only by test-delivery-guards.mjs with a synthetic loopback database.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const root = process.argv[2], url = new URL(process.argv[3]), output = process.argv[4];
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.username, 'guard_test'); assert.equal(url.pathname, '/guard_test');
require(path.join(root, 'node_modules/reflect-metadata'));
require(path.join(root, 'node_modules/ts-node')).register({ project: path.join(root, 'tsconfig.base.json'), transpileOnly: true,
  compilerOptions: { module: 'commonjs', target: 'es2020', incremental: false } });
const { PrismaClient } = require(path.join(root, 'node_modules/@prisma/client'));
const { AutomationRecoveryService } = require(path.join(root, 'libraries/nestjs-libraries/src/automation-recovery/automation-recovery.service.ts'));
const { recoveryKey, publicationRequestHash } = require(path.join(root, 'libraries/nestjs-libraries/src/automation-recovery/recovery-policy.ts'));
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
const service = new AutomationRecoveryService(db), results = [], calls = [];
const T0 = new Date(Date.now() - 60_000);
let server, n = 0;
const test = async (name, fn) => { await fn(); results.push({ name, result: 'PASS' }); console.log('PASS', name); };
const rejected = (work, reason) => assert.rejects(work, e => e.reason === reason);
let endpoint;
async function send(fixture, mode = 'ok') {
  const response = await fetch(endpoint + '/' + mode, { method: 'POST', body: JSON.stringify({ id: fixture.post.id, key: fixture.context.actionKey }) });
  return response.json();
}
async function postFixture(at = new Date(+T0 + 1), options = {}) {
  const id = 'post-' + ++n;
  const post = await db.post.create({ data: { id, organizationId: 'org-a', integrationId: 'ig-a', content: 'Synthetic', group: id,
    publishDate: at, state: 'QUEUE', ...options.post } });
  const context = { organizationId: 'org-a', integrationId: 'ig-a', workflowId: 'workflow-' + id, runId: randomUUID(),
    protocolVersion: 1, actionKey: 'publication:' + id, snapshots: [post], plannedAt: at };
  const occurrence = await db.publicationOccurrence.create({ data: { id: 'occ-' + id, organizationId: 'org-a', postId: post.id,
    groupSnapshot: post.group, scheduleRevision: post.scheduleRevision, scheduledAt: at } });
  if (!options.unbound) await db.automationWorkflowBinding.create({ data: { organizationId: 'org-a', workflowId: context.workflowId,
    runId: context.runId, actionKey: context.actionKey, occurrenceId: occurrence.id, expectedRequestHash: publicationRequestHash(context) } });
  return { post, context, occurrence };
}
async function eventFixture(options = {}) {
  const id = 'event-' + ++n;
  return db.instagramWebhookEvent.create({ data: { id, integrationId: options.integrationId || 'ig-a', instagramAccountId: 'synthetic-account',
    externalCommentId: 'comment-' + id, mediaId: 'media-' + id, authorId: 'author-' + id, commentText: 'Eu quero',
    payload: {}, status: 'RECEIVED', receivedAt: new Date(+T0 + 2000), occurredAt: new Date(+T0 + 1000),
    occurredAtSource: 'META_COMMENT_CREATED_TIME', ...options } });
}
async function executionFixture(event, statuses = {}) {
  const automation = await db.instagramCommentAutomation.create({ data: { integrationId: event.integrationId, mediaId: event.mediaId,
    enabled: true, matchType: 'EXACT', publicReplyText: 'Synthetic', privateReplyText: 'Synthetic' } });
  return db.instagramCommentAutomationExecution.create({ data: { automationId: automation.id, webhookEventId: event.id,
    externalCommentId: event.externalCommentId, authorId: event.authorId, ...statuses } });
}
(async () => {
  try {
    await db.$connect();
    server = http.createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); calls.push({ path: req.url, id: body.id, key: body.key });
      if (req.url === '/uncertain') { req.socket.destroy(); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([{ id: body.id, postId: 'remote-' + body.id + '-' + body.key, releaseURL: 'https://example.test/' + body.id, status: 'published' }]));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); endpoint = 'http://127.0.0.1:' + server.address().port;
    const actualFetch = global.fetch;
    global.fetch = (target, options) => {
      const destination = new URL(target);
      assert.equal(destination.origin, endpoint, 'External API access is forbidden in recovery fixtures');
      return actualFetch(target, options);
    };
    await db.organization.createMany({ data: [{ id: 'org-a', name: 'Synthetic A' }, { id: 'org-b', name: 'Synthetic B' }] });
    await db.integration.createMany({ data: [{ id: 'ig-a', organizationId: 'org-a', internalId: 'synthetic-a', name: 'Synthetic',
      type: 'social', providerIdentifier: 'instagram', token: 'synthetic-only', facebookPageId: 'synthetic-page' },
    { id: 'ig-b', organizationId: 'org-b', internalId: 'synthetic-b', name: 'Synthetic', type: 'social', providerIdentifier: 'instagram-standalone', token: 'synthetic-only' }] });
    await test('C01 absent authorization/closed control prevents all HTTP', async () => {
      const f = await postFixture(); await rejected(service.executePublication(f.context, () => send(f)), 'RECOVERY_CLOSED'); assert.equal(calls.length, 0);
    });
    // Synthetic fixture only: no application code exposes activation in H/I.
    await db.automationRecoveryRun.create({ data: { id: 'synthetic-run', cutoffAt: T0, phase: 'VERIFIED', protocolVersion: 1,
      authorizedById: 'synthetic-operator', authorizedAt: new Date(+T0 - 1), manifestHash: 'synthetic-reviewed-manifest' } });
    await db.automationRecoveryControl.update({ where: { id: 'global' }, data: { phase: 'OPEN', runId: 'synthetic-run', generation: 1 } });
    await require('./signed-policy-fixture.cjs')(db,url.href);
    await test('C02 T0-minus-one expires atomically with ERROR, immutable decision and zero HTTP', async () => {
      const before = calls.length, f = await postFixture(new Date(+T0 - 1));
      await rejected(service.executePublication(f.context, () => send(f)), 'BEFORE_RECOVERY_CUTOFF');
      assert.equal((await db.post.findUnique({ where: { id: f.post.id } })).state, 'ERROR');
      assert.equal((await db.publicationOccurrence.findUnique({ where: { id: f.occurrence.id } })).outcome, 'EXPIRED');
      assert.equal(await db.automationRecoveryDecision.count({ where: { subjectKey: 'occurrence:' + f.occurrence.id, action: 'EXPIRE' } }), 1);
      await db.post.update({ where: { id: f.post.id }, data: { state: 'QUEUE' } });
      await rejected(service.executePublication(f.context, () => send(f)), 'OCCURRENCE_TERMINALLY_HELD'); assert.equal(calls.length, before);
    });
    await test('C03 T0 equality and ordinary latency are eligible; duplicate attempts reuse a real receipt', async () => {
      for (const delta of [0, 1]) {
        const before = calls.length, f = await postFixture(new Date(+T0 + delta));
        const first = await service.executePublication(f.context, () => send(f));
        const second = await service.executePublication(f.context, () => send(f));
        assert.deepEqual(first, second); assert.equal(calls.length, before + 1);
      }
    });
    await test('C04 concurrent reservations produce exactly one HTTP request', async () => {
      const f = await postFixture(), before = calls.length;
      const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => service.executePublication(f.context, () => send(f))));
      assert(attempts.some(r => r.status === 'fulfilled')); assert.equal(calls.length, before + 1);
      assert.equal(await db.automationEffectAttempt.count({ where: { occurrenceId: f.occurrence.id } }), 1);
    });
    await test('C05 lost response after server acceptance stays uncertain across service restart and is not resent', async () => {
      const f = await postFixture(), before = calls.length;
      await assert.rejects(service.executePublication(f.context, () => send(f, 'uncertain')));
      const another = new AutomationRecoveryService(db);
      await rejected(another.executePublication(f.context, () => send(f)), 'REMOTE_EFFECT_UNCONFIRMED');
      assert.equal(calls.length, before + 1);
      assert.equal((await db.automationEffectAttempt.findFirst({ where: { occurrenceId: f.occurrence.id } })).phase, 'UNCERTAIN');
    });
    await test('C06 confirmed old results and future wall-clock slots are preserved without HTTP', async () => {
      const before = calls.length, confirmed = await postFixture(new Date(+T0 - 1), { post: { state: 'PUBLISHED', releaseId: 'synthetic-confirmed' } });
      await rejected(service.executePublication(confirmed.context, () => send(confirmed)), 'PUBLICATION_ALREADY_CONFIRMED');
      assert.equal((await db.post.findUnique({ where: { id: confirmed.post.id } })).releaseId, 'synthetic-confirmed');
      const future = await postFixture(new Date(Date.now() + 60_000));
      await rejected(service.executePublication(future.context, () => send(future)), 'OCCURRENCE_NOT_DUE');
      assert.equal((await db.post.findUnique({ where: { id: future.post.id } })).state, 'QUEUE'); assert.equal(calls.length, before);
    });
    await test('C07 rescheduling during a remote call cannot be overwritten by its late receipt/error', async () => {
      const f = await postFixture();
      const receipt = await service.executePublication(f.context, async () => {
        const result = await send(f);
        await db.post.update({ where: { id: f.post.id }, data: { scheduleRevision: { increment: 1 }, publishDate: new Date(Date.now() + 3_600_000) } });
        return result;
      });
      await service.projectPublication(f.context, receipt[0].postId, receipt[0].releaseURL);
      await service.recordWorkflowFailure(f.context, f.post.id);
      const current = await db.post.findUnique({ where: { id: f.post.id } });
      assert.equal(current.scheduleRevision, 1); assert.equal(current.state, 'QUEUE'); assert.equal(current.releaseId, null);
      assert.equal(await db.publicationEvidence.count({ where: { occurrenceId: f.occurrence.id } }), 1);
    });
    await test('C08 tenant, protocol, unavailable integration and suspension checks fail closed', async () => {
      const before = calls.length, f = await postFixture();
      await rejected(service.executePublication({ ...f.context, organizationId: 'org-b' }, () => send(f)), 'LEGACY_BINDING_REQUIRED');
      await rejected(service.executePublication({ ...f.context, protocolVersion: 0 }, () => send(f)), 'RECOVERY_PROTOCOL_MISMATCH');
      await db.post.update({ where: { id: f.post.id }, data: { adminPausedAt: new Date() } });
      await rejected(service.executePublication(f.context, () => send(f)), 'PUBLICATION_UNAVAILABLE');
      await db.post.update({ where: { id: f.post.id }, data: { adminPausedAt: null } });
      await db.organization.update({ where: { id: 'org-a' }, data: { suspendedAt: new Date() } });
      await rejected(service.executePublication(f.context, () => send(f)), 'ORGANIZATION_UNAVAILABLE');
      await db.organization.update({ where: { id: 'org-a' }, data: { suspendedAt: null } });
      await db.integration.update({ where: { id: 'ig-a' }, data: { disabled: true } });
      await rejected(service.executePublication(f.context, () => send(f)), 'PUBLICATION_UNAVAILABLE');
      await db.integration.update({ where: { id: 'ig-a' }, data: { disabled: false } }); assert.equal(calls.length, before);
    });
    await test('C09 an unbound legacy run is retained without inventing occurrence time', async () => {
      const before = calls.length, f = await postFixture(undefined, { unbound: true });
      await rejected(service.executePublication(f.context, () => send(f)), 'LEGACY_BINDING_REQUIRED'); assert.equal(calls.length, before);
      assert.equal((await db.post.findUnique({ where: { id: f.post.id } })).state, 'QUEUE');
    });
    await test('C10 an old comment without execution is skipped with no artificial execution or HTTP', async () => {
      const before = calls.length, event = await eventFixture({ receivedAt: new Date(+T0 - 1), occurredAt: null, occurredAtSource: null });
      await rejected(service.guardCommentEvent(event.id, 'org-a'), 'COMMENT_BEFORE_T0');
      assert.equal((await db.instagramWebhookEvent.findUnique({ where: { id: event.id } })).status, 'SKIPPED');
      assert.equal(await db.instagramCommentAutomationExecution.count({ where: { webhookEventId: event.id } }), 0); assert.equal(calls.length, before);
    });
    await test('C11 late arrival of an old comment is skipped; unknown creation time is held', async () => {
      const event = await eventFixture({ occurredAt: new Date(+T0 - 1) });
      await rejected(service.guardCommentEvent(event.id, 'org-a'), 'COMMENT_BEFORE_T0');
      const unknown = await eventFixture({ occurredAt: null, occurredAtSource: null, payload: { entryTime: Date.now() } });
      await rejected(service.guardCommentEvent(unknown.id, 'org-a'), 'COMMENT_CREATION_TIME_UNVERIFIED');
      assert.equal((await db.instagramWebhookEvent.findUnique({ where: { id: unknown.id } })).status, 'RECEIVED');
    });
    await test('C12 partial public success is preserved and only the unattempted old Direct is suppressed', async () => {
      const event = await eventFixture({ receivedAt: new Date(+T0 - 1), occurredAt: new Date(+T0 - 2) });
      const execution = await executionFixture(event, { publicReplyStatus: 'SUCCESS', publicReplyId: 'confirmed-public-' + event.id, privateReplyStatus: 'PENDING' });
      await rejected(service.guardCommentEvent(event.id, 'org-a'), 'COMMENT_BEFORE_T0');
      const result = await db.instagramCommentAutomationExecution.findUnique({ where: { id: execution.id } });
      assert.equal(result.publicReplyStatus, 'SUCCESS'); assert.equal(result.publicReplyId, execution.publicReplyId); assert.equal(result.privateReplyStatus, 'SKIPPED');
    });
    await test('C13 failed/reserved Direct remains failed after duplicate expiry checks', async () => {
      const event = await eventFixture({ receivedAt: new Date(+T0 - 1), occurredAt: new Date(+T0 - 2) });
      const execution = await executionFixture(event, { publicReplyStatus: 'SUCCESS', privateReplyStatus: 'FAILED', privateReplyError: 'unconfirmed' });
      for (let i = 0; i < 2; i++) await rejected(service.guardCommentEvent(event.id, 'org-a'), 'COMMENT_BEFORE_T0');
      const result = await db.instagramCommentAutomationExecution.findUnique({ where: { id: execution.id } });
      assert.equal(result.privateReplyStatus, 'FAILED'); assert.equal(result.privateReplyError, 'unconfirmed');
      assert.equal(await db.automationRecoveryDecision.count({ where: { subjectKey: 'comment:' + event.id } }), 1);
    });
    await test('C14 both Instagram credential families use separate public/private durable claims', async () => {
      for (const [integrationId, org] of [['ig-a', 'org-a'], ['ig-b', 'org-b']]) {
        const event = await eventFixture({ integrationId });
        await service.guardCommentEvent(event.id, org);
        const f = { post: { id: event.id }, context: { actionKey: 'public:' + event.id } };
        const before = calls.length;
        await service.executeComment(event.id, org, 'public', async () => (await send(f))[0].postId);
        await assert.rejects(service.executeComment(event.id, org, 'private', async () => { await send(f, 'uncertain'); return 'never-confirmed'; }));
        assert.equal((await db.automationEffectAttempt.findUnique({ where: { id: recoveryKey(org, 'comment:' + event.id, 'instagram:public') } })).phase, 'CONFIRMED');
        await rejected(service.executeComment(event.id, org, 'private', async () => (await send(f))[0].postId), 'REMOTE_EFFECT_UNCONFIRMED');
        assert.equal(calls.length, before + 2);
      }
    });
    await test('C15 a later recovery generation does not clear uncertain reservations', async () => {
      const f = await postFixture();
      await assert.rejects(service.executePublication(f.context, () => send(f, 'uncertain')));
      const before = calls.length;
      await db.automationRecoveryControl.update({ where: { id: 'global' }, data: { generation: { increment: 1 } } });
      await rejected(service.executePublication(f.context, () => send(f)), 'RECOVERY_GENERATION_ROLLBACK');
      await require('./signed-policy-fixture.cjs')(db,url.href);
      await rejected(service.executePublication(f.context, () => send(f)), 'REMOTE_EFFECT_UNCONFIRMED'); assert.equal(calls.length, before);
    });
    await test('C16 a simple schedule revision change rejects an old activity without changing the new post', async () => {
      const f = await postFixture(), before = calls.length;
      await db.post.update({ where: { id: f.post.id }, data: { scheduleRevision: { increment: 1 } } });
      await rejected(service.executePublication(f.context, () => send(f)), 'SCHEDULE_REVISION_CHANGED'); assert.equal(calls.length, before);
    });
    await test('C17 known upload checkpoints survive late projection failure without permitting another upload', async () => {
      const f = await postFixture(), before = calls.length;
      await assert.rejects(service.executePublication(f.context, async () => {
        const receipt = await send(f);
        await service.checkpointPublication(f.context, receipt[0].postId, receipt[0].releaseURL);
        await db.post.update({ where: { id: f.post.id }, data: { scheduleRevision: { increment: 1 }, publishDate: new Date(Date.now() + 3_600_000) } });
        throw new Error('Synthetic projection failure after positive remote proof');
      }));
      assert.equal(await db.publicationEvidence.count({ where: { occurrenceId: f.occurrence.id, origin: 'automatic-checkpoint' } }), 1);
      const attempt = await db.automationEffectAttempt.findFirst({ where: { occurrenceId: f.occurrence.id } });
      assert.equal(attempt.phase, 'UNCERTAIN'); assert(attempt.remoteId);
      await rejected(service.executePublication(f.context, () => send(f)), 'REMOTE_EFFECT_UNCONFIRMED'); assert.equal(calls.length, before + 1);
    });
    await test('C18 derived effects require parent proof and keep independent action claims on the same slot', async () => {
      const f = await postFixture();
      const rootReceipt = await service.executePublication(f.context, () => send(f));
      await service.projectPublication(f.context, rootReceipt[0].postId, rootReceipt[0].releaseURL);
      const actionKey = 'internal:synthetic:ig-a';
      const derived = { ...f.context, actionKey, derived: true, targetIntegrationId: 'ig-a', parentRemoteId: rootReceipt[0].postId };
      await db.automationWorkflowBinding.create({ data: { organizationId: 'org-a', workflowId: f.context.workflowId, runId: f.context.runId,
        actionKey, occurrenceId: f.occurrence.id, expectedRequestHash: publicationRequestHash(derived) } });
      const before = calls.length;
      await service.executePublication(derived, () => send({ ...f, context: derived }));
      await service.executePublication(derived, () => send({ ...f, context: derived }));
      assert.equal(calls.length, before + 1);
      await rejected(service.executePublication({ ...derived, targetIntegrationId: 'ig-b' }, () => send(f)), 'EFFECT_REQUEST_CHANGED');
      await rejected(service.executePublication({ ...derived, parentRemoteId: 'unverified-parent' }, () => send(f)), 'EFFECT_REQUEST_CHANGED');
    });
    await test('C19 a binding without an approved payload or with changed config cannot authorize its first send', async () => {
      const f = await postFixture(), before = calls.length;
      await db.automationWorkflowBinding.updateMany({ where: { workflowId: f.context.workflowId, runId: f.context.runId }, data: { expectedRequestHash: null } });
      await rejected(service.executePublication(f.context, () => send(f)), 'BINDING_PAYLOAD_UNVERIFIED');
      await db.automationWorkflowBinding.updateMany({ where: { workflowId: f.context.workflowId, runId: f.context.runId }, data: { expectedRequestHash: publicationRequestHash(f.context) } });
      await rejected(service.executePublication({ ...f.context, dependencyHash: 'changed-config' }, () => send(f)), 'EFFECT_REQUEST_CHANGED');
      assert.equal(calls.length, before);
    });
    await test('C20 changing a stored occurrence date cannot revive an old legacy payload', async () => {
      const f = await postFixture(new Date(+T0 - 1)), before = calls.length;
      await db.publicationOccurrence.update({ where: { id: f.occurrence.id }, data: { scheduledAt: new Date(+T0 + 1) } });
      await rejected(service.executePublication({ ...f.context, plannedAt: undefined }, () => send(f)), 'EFFECT_REQUEST_CHANGED');
      assert.equal(calls.length, before);
    });
    await test('C21 untrusted old entry timestamps are retained rather than promoted to creation proof', async () => {
      const event = await eventFixture({ occurredAt: new Date(+T0 - 1), occurredAtSource: 'WEBHOOK_ENTRY_TIME' });
      await rejected(service.guardCommentEvent(event.id, 'org-a'), 'COMMENT_CREATION_TIME_UNVERIFIED');
      assert.equal((await db.instagramWebhookEvent.findUnique({ where: { id: event.id } })).status, 'RECEIVED');
    });
    await test('C22 unavailable PostgreSQL cannot fall back to sending an external request', async () => {
      const f = await postFixture(), before = calls.length;
      const unavailable = new URL(url.href); unavailable.port = '1'; unavailable.searchParams.set('connect_timeout', '1');
      const disconnected = new PrismaClient({ datasources: { db: { url: unavailable.href } } });
      try { await assert.rejects(new AutomationRecoveryService(disconnected).executePublication(f.context, () => send(f))); }
      finally { await disconnected.$disconnect(); }
      assert.equal(calls.length, before);
    });
    await test('C23 human confirmation of a valid pending slot suppresses a new automatic send', async () => {
      const f = await postFixture(), before = calls.length;
      await db.publicationEvidence.create({ data: { organizationId: f.post.organizationId, occurrenceId: f.occurrence.id,
        origin: 'manual', confirmedById: 'synthetic-human', remoteId: 'human-reference', remoteUrl: 'https://example.test/human' } });
      await rejected(service.executePublication(f.context, () => send(f)), 'PUBLICATION_MANUALLY_CONFIRMED');
      assert.equal(calls.length, before);
      assert.equal((await db.publicationOccurrence.findUnique({ where: { id: f.occurrence.id } })).outcome, 'PENDING');
    });
    fs.writeFileSync(output, JSON.stringify({ status: 'PHASE_C_SERVICE_GUARDS_TESTED', postgres: '17.11', temporal: 'NOT_TESTED_BY_THIS_SUITE',
      recoveryMatrixR01R31: 'NOT_A_SUBSTITUTE_FOR_PHASE_F', tests: results, httpRequests: calls.length, production: 'UNCHANGED' }, null, 2) + '\n');
    console.log(JSON.stringify({ tests: results.length, httpRequests: calls.length }));
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.$disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
