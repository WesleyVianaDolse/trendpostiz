import assert from 'node:assert/strict';
import test from 'node:test';
import { minifyPostsList } from '@gitroom/helpers/utils/posts.list.minify';
import {
  buildScheduledEditPayload,
  canEditScheduledDetail,
  createScheduledActionGuard,
  deleteScheduledPost,
  getScheduledDetail,
  getScheduledPage,
  localScheduleToUtc,
  parseScheduledDetail,
  parseScheduledList,
  reschedulePost,
  ScheduledApiError,
  stateLabel,
} from './scheduled-api';
import { ScheduledPostDetail } from './scheduled.types';

const rootPost = {
  id: 'post-root',
  content: 'Legenda original',
  publishDate: '2099-05-10T15:00:00.000Z',
  state: 'QUEUE' as const,
  group: 'persisted-group',
  delay: 0,
  image: [{ id: 'media-1', path: 'https://cdn.example/image.jpg', url: 'https://preview.example/image.jpg' }],
  tags: [{ tag: { id: 'tag-1', name: 'Campanha' } }],
  integration: {
    id: 'integration-1',
    providerIdentifier: 'linkedin',
    name: 'Empresa',
  },
};

function detail(overrides: Partial<typeof rootPost> = {}): ScheduledPostDetail {
  return {
    group: 'persisted-group',
    integration: 'integration-1',
    settings: {},
    posts: [{ ...rootPost, ...overrides }],
  };
}

function listBody(posts: unknown[]) {
  return minifyPostsList({ posts, total: posts.length, page: 0, limit: 20, hasMore: false });
}

test('interpreta lista vazia e lista paginada com posts', () => {
  assert.deepEqual(parseScheduledList(listBody([])).posts, []);
  const page = parseScheduledList(listBody([rootPost]));
  assert.equal(page.posts.length, 1);
  assert.equal(page.posts[0].id, 'post-root');
  assert.equal(page.posts[0].group, 'persisted-group');
  assert.equal(page.hasMore, false);
});

test('mapeia somente os estados backend conhecidos para labels de UI', () => {
  assert.equal(stateLabel('QUEUE'), 'Agendado');
  assert.equal(stateLabel('PUBLISHED'), 'Publicado');
  assert.equal(stateLabel('ERROR'), 'Erro');
  assert.equal(stateLabel('DRAFT'), 'Rascunho');
});

test('abre detalhe pelo id persistido e preserva group, ids, mídia e settings', async () => {
  const fixture = detail();
  const opened = await getScheduledDetail(
    async (path) => {
      assert.equal(path, '/posts/post-root');
      return new Response(JSON.stringify(fixture), { status: 200 });
    },
    'post-root'
  );
  assert.equal(opened.group, 'persisted-group');
  assert.equal(opened.posts[0].image[0].id, 'media-1');
});

test('libera edição apenas para QUEUE e provider suportado', () => {
  assert.equal(canEditScheduledDetail(detail()), true);
  assert.equal(canEditScheduledDetail(detail({ state: 'PUBLISHED' })), false);
  assert.equal(canEditScheduledDetail(detail({ integration: { ...rootPost.integration, providerIdentifier: 'tiktok' } })), false);
});

test('monta edição schedule por upsert com ids e group persistidos', () => {
  const payload = buildScheduledEditPayload(detail(), { 'post-root': 'Legenda editada' }, { mode: 'company' });
  assert.equal(payload.type, 'schedule');
  assert.equal(payload.posts[0].group, 'persisted-group');
  assert.equal(payload.posts[0].value[0].id, 'post-root');
  assert.equal(payload.posts[0].value[0].content, 'Legenda editada');
  assert.equal(payload.posts[0].value[0].image[0].id, 'media-1');
  assert.equal('url' in payload.posts[0].value[0].image[0], false);
  assert.deepEqual(payload.tags, [{ value: 'tag-1', label: 'Campanha' }]);
});

test('reagenda com id raiz, action schedule e data UTC', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = [];
  const utcDate = localScheduleToUtc('2099-06-01', '11:30');
  await reschedulePost(async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({ id: 'post-root' }), { status: 200 });
  }, 'post-root', utcDate);
  assert.equal(calls[0].path, '/posts/post-root/date');
  assert.equal(calls[0].options?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[0].options?.body)), { date: utcDate, action: 'schedule' });
});

test('exclui somente pelo group persistido', async () => {
  let called = '';
  await deleteScheduledPost(async (path, options) => {
    called = path;
    assert.equal(options?.method, 'DELETE');
    return new Response(JSON.stringify({ error: true }), { status: 200 });
  }, 'persisted-group');
  assert.equal(called, '/posts/persisted-group');
});

test('trata erro HTTP e falha de rede sem executar retry', async () => {
  let httpCalls = 0;
  await assert.rejects(
    getScheduledPage(async () => {
      httpCalls += 1;
      return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 });
    }, 0),
    (error: unknown) => error instanceof ScheduledApiError && error.code === 'permission'
  );
  assert.equal(httpCalls, 1);

  let networkCalls = 0;
  await assert.rejects(
    deleteScheduledPost(async () => {
      networkCalls += 1;
      throw new Error('offline');
    }, 'persisted-group'),
    (error: unknown) => error instanceof ScheduledApiError && error.code === 'network' && error.ambiguous
  );
  assert.equal(networkCalls, 1);
});

test('bloqueia dupla ação destrutiva', async () => {
  const guard = createScheduledActionGuard();
  let release!: () => void;
  let operations = 0;
  const first = guard.run(() => new Promise<void>((resolve) => {
    operations += 1;
    release = resolve;
  }));
  await assert.rejects(
    guard.run(async () => { operations += 1; }),
    (error: unknown) => error instanceof ScheduledApiError && error.code === 'duplicate'
  );
  assert.equal(operations, 1);
  release();
  await first;
  assert.equal(guard.busy, false);
});

test('rejeita detalhe inexistente ou incompleto', () => {
  assert.throws(
    () => parseScheduledDetail({ group: '', posts: [] }),
    (error: unknown) => error instanceof ScheduledApiError && error.code === 'not_found'
  );
});
