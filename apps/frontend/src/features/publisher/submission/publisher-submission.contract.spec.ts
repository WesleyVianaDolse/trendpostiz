import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPostPayload } from '../model/build-post-payload';
import { validatePublisherForm } from '../model/provider-rules';
import { PublisherIntegration } from '../model/publisher.types';
import {
  createPublisherSubmissionGuard,
  isPublisherSubmissionBusy,
  postPublisherPayload,
  PublisherSubmissionError,
  submitPublisherPost,
} from './publisher-submission';

const integration: PublisherIntegration = {
  id: 'integration-1',
  name: 'Conta de teste',
  display: 'LinkedIn',
  identifier: 'linkedin',
};

function makePayload(mode: 'now' | 'schedule' = 'now') {
  return buildPostPayload({
    mode,
    content: 'Conteúdo com https://example.com',
    integrations: [{ id: integration.id, settings: {} }],
    group: 'publisher-test-group',
    now: new Date('2030-01-02T12:30:00.000Z'),
    scheduleDate: '2030-02-03',
    scheduleTime: '14:45',
  });
}

test('monta contratos now e schedule sem alterar timezone reproduzido', () => {
  const now = makePayload('now');
  const schedule = makePayload('schedule');

  assert.equal(now.type, 'now');
  assert.equal(now.date, '2030-01-02T12:30:00');
  assert.equal(schedule.type, 'schedule');
  assert.match(schedule.date, /^2030-02-03T\d{2}:45:00$/);
  assert.equal(schedule.posts[0].group, 'publisher-test-group');
});

test('aceita HTTP 201 apenas com a lista de postId/integration esperada', async () => {
  const payload = makePayload();
  const result = await postPublisherPayload(
    async () =>
      new Response(
        JSON.stringify([{ postId: 'post-1', integration: integration.id }]),
        { status: 201, headers: { 'content-type': 'application/json' } }
      ),
    payload
  );

  assert.equal(result.httpStatus, 201);
  assert.deepEqual(result.posts, [{ postId: 'post-1', integration: integration.id }]);
});

test('reproduz shortlink YES e envia o payload final uma única vez', async () => {
  const payload = makePayload();
  const calls: Array<{ path: string; body?: string }> = [];
  const result = await submitPublisherPost({
    fetcher: async (path, options) => {
      calls.push({ path, body: options?.body as string | undefined });
      if (path === '/posts/should-shortlink') {
        return new Response(JSON.stringify({ ask: true }), { status: 201 });
      }
      return new Response(
        JSON.stringify([{ postId: 'post-1', integration: integration.id }]),
        { status: 201 }
      );
    },
    payload,
    integrations: [integration],
    shortlinkPreference: 'YES',
    confirmShortlink: () => false,
  });

  assert.equal(calls.filter((call) => call.path === '/posts').length, 1);
  assert.equal(JSON.parse(calls[1].body || '{}').shortLink, true);
  assert.equal(result.payload.shortLink, true);
  assert.equal(payload.shortLink, false, 'o draft original deve permanecer intacto');
});

test('bloqueia um segundo envio enquanto o primeiro está em andamento', async () => {
  const guard = createPublisherSubmissionGuard();
  let release!: () => void;
  let operations = 0;
  const first = guard.run(
    () =>
      new Promise<void>((resolve) => {
        operations += 1;
        release = resolve;
      })
  );

  assert.equal(guard.active, true);
  await assert.rejects(
    guard.run(async () => {
      operations += 1;
    }),
    (error: unknown) =>
      error instanceof PublisherSubmissionError && error.code === 'duplicate'
  );
  assert.equal(operations, 1);
  release();
  await first;
  assert.equal(guard.active, false);
});

test('trata erro HTTP e preserva o payload para correção manual', async () => {
  const payload = makePayload();
  const original = structuredClone(payload);

  await assert.rejects(
    postPublisherPayload(
      async () =>
        new Response(JSON.stringify({ message: 'Integration with id invalid not found' }), {
          status: 400,
        }),
      payload
    ),
    (error: unknown) =>
      error instanceof PublisherSubmissionError && error.code === 'integration'
  );
  assert.deepEqual(payload, original);
});

test('marca erro de rede do POST como ambíguo e não altera o draft', async () => {
  const payload = makePayload();
  const original = structuredClone(payload);

  await assert.rejects(
    postPublisherPayload(async () => Promise.reject(new Error('offline')), payload),
    (error: unknown) =>
      error instanceof PublisherSubmissionError &&
      error.code === 'network' &&
      error.ambiguous
  );
  assert.deepEqual(payload, original);
});

test('estado submitting bloqueia o botão e validações impedem envio inváido', () => {
  assert.equal(isPublisherSubmissionBusy('submitting'), true);
  assert.equal(isPublisherSubmissionBusy('validating'), true);
  assert.equal(isPublisherSubmissionBusy('idle'), false);

  const common = {
    mode: 'now' as const,
    content: 'Teste',
    settingsByIntegration: {},
    scheduleDate: '',
    scheduleTime: '',
    media: [],
  };
  assert.ok(
    validatePublisherForm({
      ...common,
      selectedIntegrations: [integration],
      uploadInProgress: true,
    }).media
  );
  assert.ok(
    validatePublisherForm({
      ...common,
      selectedIntegrations: [{ ...integration, refreshNeeded: true }],
    }).accounts
  );
  assert.ok(
    validatePublisherForm({
      ...common,
      selectedIntegrations: [{ ...integration, identifier: 'tiktok' }],
    }).accounts
  );
});
