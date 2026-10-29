import { OrganizationDeletionService } from './organization-deletion.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: {} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { scan: jest.fn(), mget: jest.fn(), del: jest.fn() },
}));

describe('organization external-data erasure', () => {
  beforeEach(() => jest.clearAllMocks());
  it('terminates and deletes every matching execution run, with the correct namespace', async () => {
    const mutations: string[] = [];
    let scanned = false;
    const remove = jest.fn(async () => {
      expect(scanned).toBe(true);
      mutations.push('delete');
    });
    const terminate = jest.fn(async () => {
      mutations.push('terminate');
    });
    const client = {
      options: { namespace: 'client-namespace' },
      workflow: {
        list: jest.fn(async function* () {
          yield { workflowId: 'post_post-1', runId: 'run-1' };
          yield { workflowId: 'post_post-1', runId: 'run-2' };
          yield {
            workflowId: 'post_foreign',
            runId: 'foreign-run',
            searchAttributes: {
              organizationId: ['org-2'],
              postId: ['foreign'],
            },
          };
          scanned = true;
        }),
        getHandle: jest.fn((workflowId: string, runId?: string) => ({
          describe: async () => {
            if (workflowId !== 'post_post-1')
              throw Object.assign(new Error('missing'), {
                name: 'WorkflowNotFoundError',
              });
            return {
              runId,
              status: { name: runId === 'run-1' ? 'RUNNING' : 'COMPLETED' },
            };
          },
          terminate,
        })),
        workflowService: { deleteWorkflowExecution: remove },
      },
    };
    const db = {
      post: { findMany: async () => [{ id: 'post-1' }] },
      instagramWebhookEvent: { findMany: async () => [] },
      autoPost: { findMany: async () => [] },
    };
    const worker = new OrganizationDeletionService(
      db as any,
      {} as any,
      {} as any,
      { client: { getRawClient: () => client } } as any
    );
    await (worker as any).purgeWorkflows('org-1');
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(client.workflow.getHandle).not.toHaveBeenCalledWith(
      'post_foreign',
      'foreign-run'
    );
    expect(remove).toHaveBeenCalledWith({
      namespace: 'client-namespace',
      workflowExecution: { workflowId: 'post_post-1', runId: 'run-2' },
    });
    expect(mutations).toEqual(['terminate', 'delete', 'delete']);
    expect(client.workflow.list).toHaveBeenCalledWith({
      query: "organizationId = 'org-1'",
    });
  });
  it('removes only the target tenant analytics and OAuth-state keys from shared Redis', async () => {
    (ioRedis.scan as jest.Mock)
      .mockResolvedValueOnce(['0', ['integration:org-1:account:day']])
      .mockResolvedValueOnce([
        '0',
        ['organization:mine', 'organization:other'],
      ]);
    (ioRedis.mget as jest.Mock).mockResolvedValue(['org-1', 'org-2']);
    const worker = new OrganizationDeletionService(
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    await (worker as any).purgeCache('org-1');
    expect(ioRedis.del).toHaveBeenCalledWith('integration:org-1:account:day');
    expect(ioRedis.del).toHaveBeenCalledWith(
      'organization:mine',
      'login:mine',
      'refresh:mine',
      'onboarding:mine',
      'redirect:mine',
      'external:mine',
      'webhookUrl:mine'
    );
    expect(JSON.stringify((ioRedis.del as jest.Mock).mock.calls)).not.toContain(
      ':other'
    );
  });
});
