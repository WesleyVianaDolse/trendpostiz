import { AuthMiddleware } from './auth.middleware';
import { PlatformAdminMiddleware } from './platform-admin.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { verifyJWT: jest.fn() },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/users/users.service',
  () => ({ UsersService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/services/exception.filter', () => ({
  HttpForbiddenException: class extends Error {},
}));

describe('live account and platform authorization', () => {
  let users: any, organizations: any, req: any, res: any, next: jest.Mock;
  beforeEach(() => {
    users = {
      getUserById: jest
        .fn()
        .mockResolvedValue({
          id: 'user',
          activated: true,
          isSuperAdmin: false,
          isPlatformAdmin: false,
          disabledAt: null,
        }),
    };
    organizations = {
      getOrgsByUserId: jest
        .fn()
        .mockResolvedValue([
          {
            id: 'org',
            apiKey: 'key',
            suspendedAt: null,
            users: [{ disabled: false }],
          },
        ]),
    };
    req = { headers: {}, cookies: { auth: 'token' } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
    (AuthService.verifyJWT as jest.Mock).mockReturnValue({
      id: 'user',
      activated: true,
      isSuperAdmin: true,
      isPlatformAdmin: true,
    });
  });
  it('blocks an already logged-in user using the database state, not old JWT permissions', async () => {
    users.getUserById.mockResolvedValue({
      id: 'user',
      activated: true,
      disabledAt: new Date(),
    });
    await new AuthMiddleware(organizations, users).use(req, res, next);
    expect(res.status).toHaveBeenCalledWith(423);
    expect(next).not.toHaveBeenCalled();
  });
  it('rejects a forged or stale global admin flag in an otherwise valid JWT', async () => {
    await expect(
      new PlatformAdminMiddleware(users).use(req, res, next)
    ).rejects.toThrow('Acesso exclusivo');
    expect(next).not.toHaveBeenCalled();
  });
  it('allows a real global administrator independently of any organization', async () => {
    users.getUserById.mockResolvedValue({
      id: 'owner',
      activated: true,
      isPlatformAdmin: true,
    });
    await new PlatformAdminMiddleware(users).use(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe('owner');
  });
  it('uses the real administrator identity even while a tenant is impersonated elsewhere', async () => {
    users.getUserById.mockResolvedValue({
      id: 'owner',
      activated: true,
      isPlatformAdmin: true,
    });
    req.cookies.impersonate = 'member';
    await new PlatformAdminMiddleware(users).use(req, res, next);
    expect(req.user.id).toBe('owner');
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('blocks suspended organizations but preserves access to another active membership', async () => {
    const suspended = {
      id: 'suspended',
      suspendedAt: new Date(),
      users: [{ disabled: false }],
    };
    organizations.getOrgsByUserId.mockResolvedValue([suspended]);
    await new AuthMiddleware(organizations, users).use(req, res, next);
    expect(res.status).toHaveBeenCalledWith(423);
    expect(next).not.toHaveBeenCalled();
    organizations.getOrgsByUserId.mockResolvedValue([
      suspended,
      {
        id: 'active',
        apiKey: 'key',
        suspendedAt: null,
        users: [{ disabled: false }],
      },
    ]);
    req.cookies.showorg = 'suspended';
    await new AuthMiddleware(organizations, users).use(req, res, next);
    expect(req.org.id).toBe('active');
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('does not preserve legacy superadmin privilege after revocation', async () => {
    await new AuthMiddleware(organizations, users).use(req, res, next);
    expect(req.user.isSuperAdmin).toBe(false);
    expect(req.user.isPlatformAdmin).toBe(false);
  });
});
