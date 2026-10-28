import { PlatformService } from './platform.service';
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: {
    hashPassword: () => 'hashed-password',
    fixedEncryption: () => 'encrypted-api-key',
  },
}));

describe('platform access and publication policy', () => {
  let db: any;
  let service: PlatformService;
  const settings = {
    id: 'platform',
    ownerUserId: 'owner',
    registrationEnabled: true,
    organizationCreationEnabled: true,
  };
  beforeEach(() => {
    db = {
      platformSettings: {
        findUnique: jest.fn().mockResolvedValue(settings),
        findUniqueOrThrow: jest.fn().mockResolvedValue(settings),
        update: jest.fn().mockResolvedValue(settings),
      },
      organization: {
        count: jest.fn().mockResolvedValue(5),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'org', name: 'Cliente', suspendedAt: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          isPlatformAdmin: true,
          activated: true,
          disabledAt: null,
        }),
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({
            id: 'new-owner',
            activated: true,
            disabledAt: null,
          }),
      },
      post: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn(),
      },
      adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    db.$transaction = jest.fn((fn: (tx: any) => Promise<unknown>) => fn(db));
    service = new PlatformService(db);
  });
  it('creates a new client and responsible user together without granting global access or auditing credentials', async () => {
    db.organization.create = jest
      .fn()
      .mockResolvedValue({ id: 'new-org', name: 'Cliente novo' });
    await service.createOrganization('owner', 'Cliente novo', undefined, {
      name: 'Cliente',
      email: ' CLIENTE@example.test ',
      password: 'private-initial-password',
    });
    const created = db.user.create.mock.calls[0][0].data;
    expect(created.email).toBe('cliente@example.test');
    expect(created.password).toBe('hashed-password');
    expect(created.isPlatformAdmin).toBeUndefined();
    expect(db.organization.create.mock.calls[0][0].data.users.create).toEqual({
      userId: 'new-owner',
      role: 'SUPERADMIN',
    });
    expect(JSON.stringify(db.adminAuditLog.create.mock.calls)).not.toMatch(
      /private-initial-password|hashed-password/
    );
  });
  it('requires exactly one responsible-user selection when creating an organization', async () => {
    expect(() => service.createOrganization('owner', 'Cliente')).toThrow(
      'Selecione um responsável'
    );
    expect(() =>
      service.createOrganization('owner', 'Cliente', 'existing', {
        name: 'Novo',
        email: 'novo@example.test',
        password: 'password-1234',
      })
    ).toThrow('Selecione um responsável');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('uses persisted registration settings even when the environment disagrees', async () => {
    const original = process.env.DISABLE_REGISTRATION;
    process.env.DISABLE_REGISTRATION = 'true';
    try {
      expect(await service.canRegister()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.DISABLE_REGISTRATION;
      else process.env.DISABLE_REGISTRATION = original;
    }
    db.platformSettings.findUnique.mockResolvedValue({
      ...settings,
      registrationEnabled: false,
    });
    expect(await service.canRegister()).toBe(false);
    db.platformSettings.findUnique.mockResolvedValue({
      ...settings,
      organizationCreationEnabled: false,
    });
    expect(await service.canRegister()).toBe(false);
  });
  it('does not reopen an initialized installation just because all organizations were removed', async () => {
    db.organization.count.mockResolvedValue(0);
    db.platformSettings.findUnique.mockResolvedValue({
      ...settings,
      registrationEnabled: false,
    });
    expect(await service.canRegister()).toBe(false);
  });
  it('holds queued and recurring posts in the same transaction as suspension and audit', async () => {
    await service.setSuspended('owner', 'org', true, 'Inadimplência');
    expect(db.post.updateMany.mock.calls[0][0].where.OR).toEqual([
      { state: 'QUEUE' },
      { state: 'PUBLISHED', intervalInDays: { not: null } },
    ]);
    expect(
      db.post.updateMany.mock.calls[0][0].data.adminPausedAt
    ).toBeInstanceOf(Date);
    expect(
      db.organization.update.mock.calls[0][0].data.suspendedAt
    ).toBeInstanceOf(Date);
    expect(db.adminAuditLog.create.mock.calls[0][0].data).toMatchObject({
      actorId: 'owner',
      action: 'organization.suspend',
      targetId: 'org',
      reason: 'Inadimplência',
    });
  });
  it('reactivates future jobs but keeps expired jobs held as drafts for review', async () => {
    const suspendedAt = new Date('2026-10-01');
    db.organization.findUnique.mockResolvedValue({
      id: 'org',
      name: 'Cliente',
      suspendedAt,
    });
    await service.setSuspended('owner', 'org', false);
    const [expired, future] = db.post.updateMany.mock.calls.map(
      ([call]: any[]) => call
    );
    expect(expired.data).toMatchObject({
      state: 'DRAFT',
      adminPausedAt: suspendedAt,
    });
    expect(expired.where.publishDate.lte).toBeInstanceOf(Date);
    expect(future.where.publishDate.gt).toEqual(expired.where.publishDate.lte);
    expect(future.data).toEqual({ adminPausedAt: null });
    expect(db.organization.update.mock.calls[0][0].data).toEqual({
      suspendedAt: null,
      suspensionReason: null,
    });
  });
  it('keeps suspension idempotent and does not overwrite the original timestamp', async () => {
    db.organization.findUnique.mockResolvedValue({
      id: 'org',
      suspendedAt: new Date(),
    });
    await service.setSuspended('owner', 'org', true);
    expect(db.organization.update).not.toHaveBeenCalled();
    expect(db.post.updateMany).not.toHaveBeenCalled();
  });
  it('rechecks administrative access before a write', async () => {
    db.user.findUnique.mockResolvedValue({
      isPlatformAdmin: false,
      activated: true,
    });
    await expect(service.setSuspended('revoked', 'org', true)).rejects.toThrow(
      'Acesso administrativo'
    );
    expect(db.organization.update).not.toHaveBeenCalled();
  });
  it('protects the owner, the acting user and active global administrators from user blocking', async () => {
    await expect(
      service.setUserDisabled('owner', 'owner', true)
    ).rejects.toThrow('Não é possível bloquear');
    await expect(
      service.setUserDisabled('delegate', 'owner', true)
    ).rejects.toThrow('Não é possível bloquear');
    await expect(
      service.setUserDisabled('owner', 'delegate', true)
    ).rejects.toThrow('Não é possível bloquear');
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('does not let a delegate promote another user or remove the owner', async () => {
    await expect(service.setAdmin('delegate', 'other', true)).rejects.toThrow(
      'Somente o titular'
    );
    await expect(service.setAdmin('owner', 'owner', false)).rejects.toThrow(
      'protegida'
    );
  });
  it('does not accept an owner replacement through settings payloads', async () => {
    await service.updateSettings('owner', {
      registrationEnabled: false,
      organizationCreationEnabled: true,
      ownerUserId: 'attacker',
    } as any);
    expect(db.platformSettings.update.mock.calls[0][0].data).toEqual({
      registrationEnabled: false,
      organizationCreationEnabled: true,
    });
  });
  const snapshot = {
    id: 'post',
    group: 'version-1',
    publishDate: new Date('2026-11-01'),
  };
  it('checks the database at execution time instead of trusting a queued payload', async () => {
    db.organization.findUnique.mockResolvedValue({ suspendedAt: new Date() });
    expect(await service.canPublishPosts('org', [snapshot])).toBe(false);
    expect(db.post.findMany).not.toHaveBeenCalled();
  });
  it.each([
    { adminPausedAt: new Date() },
    { deletedAt: new Date() },
    { state: 'DRAFT' },
    { group: 'version-2' },
    { publishDate: new Date('2026-11-02') },
  ])(
    'rejects a held, deleted or rescheduled queued execution: %p',
    async (change) => {
      db.post.findMany.mockResolvedValue([
        {
          ...snapshot,
          state: 'QUEUE',
          adminPausedAt: null,
          deletedAt: null,
          ...change,
        },
      ]);
      expect(await service.canPublishPosts('org', [snapshot])).toBe(false);
    }
  );
  it('permits a current job in an active organization and rejects missing jobs', async () => {
    db.post.findMany.mockResolvedValue([
      { ...snapshot, state: 'QUEUE', adminPausedAt: null, deletedAt: null },
    ]);
    expect(await service.canPublishPosts('org', [snapshot])).toBe(true);
    db.post.findMany.mockResolvedValue([]);
    expect(await service.canPublishPosts('org', [snapshot])).toBe(false);
  });
});
