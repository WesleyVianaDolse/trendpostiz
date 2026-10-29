import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { deletionSummary, organizationDeletionScope } from './organization-deletion';

const userFields = {
  id: true,
  email: true,
  name: true,
  providerName: true,
  activated: true,
  isPlatformAdmin: true,
  disabledAt: true,
  disabledReason: true,
  createdAt: true,
  lastOnline: true,
} as const;

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async settings() {
    const row = await this.prisma.platformSettings.findUnique({
      where: { id: 'platform' },
    });
    return (
      row || {
        id: 'platform',
        ownerUserId: null,
        updatedAt: null,
        registrationEnabled: process.env.DISABLE_REGISTRATION !== 'true',
        organizationCreationEnabled: true,
      }
    );
  }

  async canRegister() {
    const settings = await this.settings();
    // Preserve first-user setup only before platform administration is initialized.
    if (!settings.ownerUserId && (await this.prisma.organization.count()) === 0)
      return true;
    return settings.registrationEnabled && settings.organizationCreationEnabled;
  }

  async isOrganizationActive(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: { suspendedAt: true },
    });
    return !!org && !org.suspendedAt;
  }

  async assertOrganizationActive(id: string) {
    if (!(await this.isOrganizationActive(id))) {
      throw new ForbiddenException(
        'Esta organização está suspensa. Entre em contato com o administrador.'
      );
    }
  }

  async canPublishPosts(
    orgId: string,
    snapshots: { id: string; group: string; publishDate: Date }[]
  ) {
    if (!snapshots.length || !(await this.isOrganizationActive(orgId)))
      return false;
    const current = await this.prisma.post.findMany({
      where: { organizationId: orgId, id: { in: snapshots.map((p) => p.id) } },
      select: {
        id: true,
        group: true,
        publishDate: true,
        adminPausedAt: true,
        deletedAt: true,
        state: true,
      },
    });
    return (
      current.length === snapshots.length &&
      current.every((post) => {
        const snapshot = snapshots.find((p) => p.id === post.id)!;
        return (
          !post.adminPausedAt &&
          !post.deletedAt &&
          post.state !== 'DRAFT' &&
          snapshot.group === post.group &&
          new Date(snapshot.publishDate).getTime() ===
            post.publishDate.getTime()
        );
      })
    );
  }

  async overview() {
    const [
      users,
      disabledUsers,
      organizations,
      suspendedOrganizations,
      socialAccounts,
      queuedPosts,
      heldPosts,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { disabledAt: { not: null } } }),
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { suspendedAt: { not: null } } }),
      this.prisma.integration.count({ where: { deletedAt: null } }),
      this.prisma.post.count({
        where: {
          state: 'QUEUE',
          deletedAt: null,
          parentPostId: null,
          adminPausedAt: null,
        },
      }),
      this.prisma.post.count({
        where: {
          adminPausedAt: { not: null },
          deletedAt: null,
          parentPostId: null,
        },
      }),
    ]);
    return {
      users,
      disabledUsers,
      organizations,
      suspendedOrganizations,
      socialAccounts,
      queuedPosts,
      heldPosts,
    };
  }

  async organizations(search = '', page = 0) {
    const where: Prisma.OrganizationWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { id: search },
            {
              users: {
                some: {
                  user: { email: { contains: search, mode: 'insensitive' } },
                },
              },
            },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        skip: page * 20,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          createdAt: true,
          suspendedAt: true,
          suspensionReason: true,
          deletionRequestedAt: true,
          deletionError: true,
          _count: {
            select: {
              users: true,
              Integration: { where: { deletedAt: null } },
            },
          },
        },
      }),
      this.prisma.organization.count({ where }),
    ]);
    return { items, total, page, hasMore: (page + 1) * 20 < total };
  }

  async organization(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        createdAt: true,
        suspendedAt: true,
        suspensionReason: true,
        deletionRequestedAt: true,
        deletionError: true,
        users: {
          select: {
            id: true,
            role: true,
            disabled: true,
            user: { select: userFields },
          },
        },
        Integration: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            disabled: true,
            refreshNeeded: true,
          },
        },
      },
    });
    if (!org) throw new NotFoundException('Organização não encontrada.');
    const heldPosts = await this.prisma.post.count({
      where: {
        organizationId: id,
        adminPausedAt: { not: null },
        deletedAt: null,
        parentPostId: null,
      },
    });
    return { ...org, heldPosts };
  }

  async users(search = '', page = 0) {
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
            { id: search },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: page * 20,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          ...userFields,
          organizations: {
            select: {
              role: true,
              disabled: true,
              organization: {
                select: { id: true, name: true, suspendedAt: true },
              },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, hasMore: (page + 1) * 20 < total };
  }

  async audit(page = 0) {
    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        skip: page * 20,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.adminAuditLog.count(),
    ]);
    const actors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.actorId))] } },
      select: { id: true, email: true },
    });
    return {
      items: items.map((item) => ({
        ...item,
        actorEmail:
          actors.find((u) => u.id === item.actorId)?.email || item.actorId,
      })),
      total,
      page,
      hasMore: (page + 1) * 20 < total,
    };
  }

  // Re-check the actor inside serializable writes so revocation cannot race an administrative action.
  private async write<T>(
    actorId: string,
    run: (tx: Prisma.TransactionClient, ownerId: string) => Promise<T>
  ) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const actor = await tx.user.findUnique({
              where: { id: actorId },
              select: {
                isPlatformAdmin: true,
                disabledAt: true,
                activated: true,
              },
            });
            const settings = await tx.platformSettings.findUnique({
              where: { id: 'platform' },
            });
            if (
              !actor?.isPlatformAdmin ||
              actor.disabledAt ||
              !actor.activated ||
              !settings
            )
              throw new ForbiddenException(
                'Acesso administrativo não autorizado.'
              );
            return run(tx, settings.ownerUserId);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
      } catch (error) {
        if (
          attempt < 2 &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        )
          continue;
        throw error;
      }
    }
  }

  updateSettings(
    actorId: string,
    body: { registrationEnabled: boolean; organizationCreationEnabled: boolean }
  ) {
    body = {
      registrationEnabled: body.registrationEnabled,
      organizationCreationEnabled: body.organizationCreationEnabled,
    };
    return this.write(actorId, async (tx) => {
      const before = await tx.platformSettings.findUniqueOrThrow({
        where: { id: 'platform' },
      });
      const settings = await tx.platformSettings.update({
        where: { id: 'platform' },
        data: body,
      });
      await tx.adminAuditLog.create({
        data: {
          actorId,
          action: 'settings.update',
          targetType: 'platform',
          targetId: 'platform',
          details: {
            before: {
              registrationEnabled: before.registrationEnabled,
              organizationCreationEnabled: before.organizationCreationEnabled,
            },
            after: body,
          },
        },
      });
      return settings;
    });
  }

  setSuspended(
    actorId: string,
    id: string,
    suspended: boolean,
    reason?: string
  ) {
    return this.write(actorId, async (tx) => {
      const org = await tx.organization.findUnique({ where: { id } });
      if (!org) throw new NotFoundException('Organização não encontrada.');
      if (org.deletionRequestedAt) throw new BadRequestException('A exclusão definitiva já foi iniciada. Não é possível reativar esta organização.');
      if (!!org.suspendedAt === suspended)
        return { id, suspended, heldPosts: 0 };
      const now = new Date();
      let heldPosts = 0;
      if (suspended) {
        const held = await tx.post.updateMany({
          where: {
            organizationId: id,
            deletedAt: null,
            OR: [
              { state: 'QUEUE' },
              { state: 'PUBLISHED', intervalInDays: { not: null } },
            ],
          },
          data: { adminPausedAt: now },
        });
        heldPosts = held.count;
      } else {
        // Expired jobs stay held even if an older Temporal execution wakes after reactivation.
        await tx.post.updateMany({
          where: {
            organizationId: id,
            deletedAt: null,
            state: 'QUEUE',
            publishDate: { lte: now },
          },
          data: {
            state: 'DRAFT',
            adminPausedAt: org.suspendedAt,
            error:
              'Publicação pausada por suspensão da organização. Revise e reagende.',
          },
        });
        await tx.post.updateMany({
          where: {
            organizationId: id,
            deletedAt: null,
            state: 'QUEUE',
            publishDate: { gt: now },
          },
          data: { adminPausedAt: null },
        });
      }
      await tx.organization.update({
        where: { id },
        data: {
          suspendedAt: suspended ? now : null,
          suspensionReason: suspended
            ? reason?.trim() || 'Suspensão administrativa'
            : null,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          actorId,
          action: suspended
            ? 'organization.suspend'
            : 'organization.reactivate',
          targetType: 'organization',
          targetId: id,
          reason: reason?.trim(),
          details: { name: org.name, heldPosts },
        },
      });
      return { id, suspended, heldPosts };
    });
  }

  async organizationDeletionPreview(actorId: string, id: string) {
    const settings = await this.settings();
    if (actorId !== settings.ownerUserId) throw new ForbiddenException('Somente o titular pode excluir organizações permanentemente.');
    return deletionSummary(await organizationDeletionScope(this.prisma, id, [actorId, settings.ownerUserId]));
  }

  requestOrganizationDeletion(actorId: string, id: string, confirmation: string) {
    return this.write(actorId, async (tx, ownerId) => {
      if (actorId !== ownerId) throw new ForbiddenException('Somente o titular pode excluir organizações permanentemente.');
      const scope = await organizationDeletionScope(tx, id, [actorId, ownerId]);
      if (confirmation !== scope.organization.name) throw new BadRequestException('Digite exatamente o nome da organização para confirmar a exclusão.');
      if (scope.blocker) throw new BadRequestException(scope.blocker);
      if (!scope.organization.deletionRequestedAt) {
        const now = new Date();
        await tx.organization.update({ where: { id }, data: { deletionRequestedAt: now, deletionRequestedById: actorId, suspendedAt: now, suspensionReason: 'Exclusão definitiva em andamento', deletionError: null } });
        await tx.post.updateMany({ where: { organizationId: id, deletedAt: null }, data: { adminPausedAt: now } });
        await tx.autoPost.updateMany({ where: { organizationId: id }, data: { active: false } });
      }
      return { id, status: 'deleting' as const };
    });
  }

  setUserDisabled(
    actorId: string,
    id: string,
    disabled: boolean,
    reason?: string
  ) {
    return this.write(actorId, async (tx, ownerId) => {
      const user = await tx.user.findUnique({
        where: { id },
        select: userFields,
      });
      if (!user) throw new NotFoundException('Usuário não encontrado.');
      if (
        disabled &&
        (id === actorId || id === ownerId || user.isPlatformAdmin)
      )
        throw new BadRequestException(
          'Não é possível bloquear a própria conta, o titular ou um administrador global. Revogue primeiro a permissão administrativa.'
        );
      const updated = await tx.user.update({
        where: { id },
        data: {
          disabledAt: disabled ? new Date() : null,
          disabledReason: disabled
            ? reason?.trim() || 'Bloqueio administrativo'
            : null,
        },
        select: userFields,
      });
      await tx.adminAuditLog.create({
        data: {
          actorId,
          action: disabled ? 'user.disable' : 'user.enable',
          targetType: 'user',
          targetId: id,
          reason: reason?.trim(),
        },
      });
      return updated;
    });
  }

  setAdmin(actorId: string, id: string, enabled: boolean) {
    return this.write(actorId, async (tx, ownerId) => {
      if (actorId !== ownerId)
        throw new ForbiddenException(
          'Somente o titular pode autorizar administradores globais.'
        );
      if (id === ownerId)
        throw new BadRequestException('A permissão do titular está protegida.');
      const target = await tx.user.findUnique({
        where: { id },
        select: userFields,
      });
      if (!target || target.disabledAt || !target.activated)
        throw new BadRequestException(
          'Escolha um usuário ativo e com e-mail ativado.'
        );
      const user = await tx.user.update({
        where: { id },
        data: { isPlatformAdmin: enabled },
        select: userFields,
      });
      await tx.adminAuditLog.create({
        data: {
          actorId,
          action: enabled ? 'admin.grant' : 'admin.revoke',
          targetType: 'user',
          targetId: id,
        },
      });
      return user;
    });
  }

  createOrganization(
    actorId: string,
    name: string,
    ownerUserId?: string,
    newOwner?: { name: string; email: string; password: string }
  ) {
    if (
      !!ownerUserId === !!newOwner ||
      (newOwner &&
        (!newOwner.name?.trim() || !newOwner.email || !newOwner.password))
    ) {
      throw new BadRequestException(
        'Selecione um responsável existente ou preencha os dados do novo responsável.'
      );
    }
    const ownerPassword = newOwner
      ? AuthService.hashPassword(newOwner.password)
      : undefined;
    return this.write(actorId, async (tx) => {
      let owner;
      if (newOwner) {
        const email = newOwner.email.trim().toLowerCase();
        if (
          await tx.user.findFirst({ where: { email, providerName: 'LOCAL' } })
        )
          throw new BadRequestException(
            'Já existe um usuário com esse e-mail. Selecione-o como responsável existente.'
          );
        owner = await tx.user.create({
          data: {
            email,
            name: newOwner.name.trim(),
            password: ownerPassword,
            providerName: 'LOCAL',
            activated: true,
            timezone: 0,
          },
          select: { id: true, activated: true, disabledAt: true },
        });
      } else {
        owner = await tx.user.findUnique({
          where: { id: ownerUserId },
          select: { id: true, activated: true, disabledAt: true },
        });
      }
      if (!owner?.activated || owner.disabledAt)
        throw new BadRequestException(
          'O responsável precisa ter uma conta ativa.'
        );
      const org = await tx.organization.create({
        data: {
          name: name.trim(),
          apiKey: AuthService.fixedEncryption(makeId(20)),
          users: { create: { userId: owner.id, role: Role.SUPERADMIN } },
        },
        select: { id: true, name: true },
      });
      await tx.adminAuditLog.create({
        data: {
          actorId,
          action: 'organization.create',
          targetType: 'organization',
          targetId: org.id,
          details: { name: org.name, ownerUserId: owner.id },
        },
      });
      return org;
    });
  }

  createUser(
    actorId: string,
    body: {
      email: string;
      name: string;
      password: string;
      organizationId: string;
      role: 'USER' | 'ADMIN';
    }
  ) {
    const password = AuthService.hashPassword(body.password);
    return this.write(actorId, async (tx) => {
      const email = body.email.trim().toLowerCase();
      if (await tx.user.findFirst({ where: { email, providerName: 'LOCAL' } }))
        throw new BadRequestException(
          'Já existe um usuário local com esse e-mail.'
        );
      const org = await tx.organization.findUnique({
        where: { id: body.organizationId },
        select: { suspendedAt: true },
      });
      if (!org || org.suspendedAt)
        throw new BadRequestException('Escolha uma organização ativa.');
      const user = await tx.user.create({
        data: {
          email,
          name: body.name.trim(),
          password,
          providerName: 'LOCAL',
          activated: true,
          timezone: 0,
          organizations: {
            create: { organizationId: body.organizationId, role: body.role },
          },
        },
        select: userFields,
      });
      await tx.adminAuditLog.create({
        data: {
          actorId,
          action: 'user.create',
          targetType: 'user',
          targetId: user.id,
          details: { organizationId: body.organizationId, role: body.role },
        },
      });
      return user;
    });
  }
}
