import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function organizationDeletionScope(
  tx: Prisma.TransactionClient,
  id: string,
  protectedIds: string[]
) {
  const organization = await tx.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      paymentId: true,
      deletionRequestedAt: true,
      deletionRequestedById: true,
      _count: {
        select: { users: true, post: true, Integration: true, media: true },
      },
    },
  });
  if (!organization) throw new NotFoundException('Organização não encontrada.');
  const exclusiveUsers = await tx.user.findMany({
    where: {
      id: { notIn: protectedIds },
      isPlatformAdmin: false,
      isSuperAdmin: false,
      organizations: {
        some: { organizationId: id },
        every: { organizationId: id },
      },
    },
    select: { id: true },
  });
  const userIds = exclusiveUsers.map((user) => user.id);
  // Marketplace orders can belong to another tenant. Never cascade into that tenant's records.
  const [externalItems, externalConversations, externalPayouts] =
    await Promise.all([
      tx.orderItems.count({
        where: {
          integration: { organizationId: id },
          order: { messageGroup: { buyerOrganizationId: { not: id } } },
        },
      }),
      tx.messagesGroup.count({
        where: {
          buyerOrganizationId: { not: id },
          OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }],
        },
      }),
      tx.payoutProblems.count({
        where: {
          userId: { in: userIds },
          order: { messageGroup: { buyerOrganizationId: { not: id } } },
        },
      }),
    ]);
  const blocker =
    externalItems || externalConversations || externalPayouts
      ? 'Existem pedidos ou conversas vinculados a outras organizações. Esses vínculos precisam ser resolvidos antes da exclusão, para preservar os dados dos outros clientes.'
      : null;
  return { organization, userIds, blocker };
}

export function deletionSummary(
  scope: Awaited<ReturnType<typeof organizationDeletionScope>>
) {
  const { organization, userIds, blocker } = scope;
  return {
    id: organization.id,
    name: organization.name,
    posts: organization._count.post,
    socialAccounts: organization._count.Integration,
    media: organization._count.media,
    deletedUsers: userIds.length,
    preservedUsers: organization._count.users - userIds.length,
    hasExternalBilling: !!organization.paymentId,
    blocker,
  };
}

async function purgeOrganizationMemory(
  tx: Prisma.TransactionClient,
  id: string
) {
  // Some installations have never enabled AI. Do not require absent optional Mastra tables.
  const rows = await tx.$queryRaw<
    { name: string }[]
  >`SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = current_schema() AND tablename LIKE 'mastra_%'`;
  const tables = new Set(rows.map((row) => row.name));
  const threads = tables.has('mastra_threads')
    ? await tx.mastra_threads.findMany({
        where: { resourceId: id },
        select: { id: true },
      })
    : [];
  const threadIds = threads.map((thread) => thread.id);
  const scores = tables.has('mastra_scorers')
    ? await tx.mastra_scorers.findMany({
        where: { OR: [{ resourceId: id }, { threadId: { in: threadIds } }] },
        select: { traceId: true },
      })
    : [];
  const traceIds = scores.flatMap((score) =>
    score.traceId ? [score.traceId] : []
  );
  if (tables.has('mastra_traces')) {
    const linked = await tx.mastra_traces.findMany({
      where: {
        OR: [
          { attributes: { path: ['resourceId'], equals: id } },
          { attributes: { path: ['organizationId'], equals: id } },
        ],
      },
      select: { traceId: true },
    });
    traceIds.push(...linked.map((trace) => trace.traceId));
  }
  if (tables.has('mastra_messages'))
    await tx.mastra_messages.deleteMany({
      where: { OR: [{ resourceId: id }, { thread_id: { in: threadIds } }] },
    });
  if (tables.has('mastra_scorers'))
    await tx.mastra_scorers.deleteMany({
      where: { OR: [{ resourceId: id }, { threadId: { in: threadIds } }] },
    });
  if (tables.has('mastra_workflow_snapshot'))
    await tx.mastra_workflow_snapshot.deleteMany({ where: { resourceId: id } });
  if (tables.has('mastra_traces'))
    await tx.mastra_traces.deleteMany({ where: { traceId: { in: traceIds } } });
  if (tables.has('mastra_ai_spans'))
    await tx.$executeRaw`DELETE FROM "mastra_ai_spans" WHERE "traceId" = ANY(${traceIds}::text[]) OR "metadata"->>'resourceId' = ${id} OR "attributes"->>'resourceId' = ${id} OR "scope"->>'resourceId' = ${id}`;
  if (tables.has('mastra_threads'))
    await tx.mastra_threads.deleteMany({ where: { resourceId: id } });
  if (tables.has('mastra_resources'))
    await tx.mastra_resources.deleteMany({ where: { id } });
}

// Called only after storage and workflow cleanup has succeeded. The last transaction re-checks
// current membership so a shared account cannot be deleted by a stale preview.
export async function purgeOrganizationRecords(
  tx: Prisma.TransactionClient,
  id: string
) {
  const org = await tx.organization.findUnique({
    where: { id },
    select: { deletionRequestedAt: true, deletionRequestedById: true },
  });
  if (!org) return;
  if (!org.deletionRequestedAt)
    throw new BadRequestException('A exclusão não foi confirmada.');
  const settings = await tx.platformSettings.findUniqueOrThrow({
    where: { id: 'platform' },
  });
  const scope = await organizationDeletionScope(tx, id, [
    settings.ownerUserId,
    org.deletionRequestedById!,
  ]);
  if (scope.blocker) throw new BadRequestException(scope.blocker);
  const userIds = scope.userIds;
  const ownPost = { organizationId: id };
  const ownIntegration = { organizationId: id };
  const ownOrder = { messageGroup: { buyerOrganizationId: id } };
  await purgeOrganizationMemory(tx, id);

  await tx.oAuthAuthorization.deleteMany({
    where: {
      OR: [
        { organizationId: id },
        { oauthApp: { organizationId: id } },
        { userId: { in: userIds } },
      ],
    },
  });
  await tx.oAuthApp.deleteMany({ where: { organizationId: id } });
  await tx.instagramCommentAutomationExecution.deleteMany({
    where: { automation: { integration: ownIntegration } },
  });
  await tx.instagramCommentAutomationTrigger.deleteMany({
    where: { automation: { integration: ownIntegration } },
  });
  await tx.instagramCommentAutomation.deleteMany({
    where: { integration: ownIntegration },
  });
  await tx.instagramWebhookEvent.deleteMany({
    where: { integration: ownIntegration },
  });
  await tx.integrationsWebhooks.deleteMany({
    where: {
      OR: [
        { integration: ownIntegration },
        { webhook: { organizationId: id } },
      ],
    },
  });
  await tx.webhooks.deleteMany({ where: { organizationId: id } });
  await tx.exisingPlugData.deleteMany({
    where: { integration: ownIntegration },
  });
  await tx.plugs.deleteMany({
    where: { OR: [{ organizationId: id }, { integration: ownIntegration }] },
  });
  await tx.autoPost.deleteMany({ where: { organizationId: id } });
  await tx.comments.deleteMany({
    where: {
      OR: [
        { organizationId: id },
        { post: ownPost },
        { userId: { in: userIds } },
      ],
    },
  });
  await tx.errors.deleteMany({
    where: { OR: [{ organizationId: id }, { post: ownPost }] },
  });
  await tx.tagsPosts.deleteMany({
    where: { OR: [{ post: ownPost }, { tag: { orgId: id } }] },
  });
  await tx.payoutProblems.deleteMany({ where: { order: ownOrder } });
  await tx.payoutProblems.updateMany({
    where: { post: ownPost },
    data: { postId: null },
  });
  // Detach optional references on posts owned by other organizations.
  await tx.post.updateMany({
    where: { submittedForOrganizationId: id },
    data: { submittedForOrganizationId: null },
  });
  await tx.post.updateMany({
    where: { submittedForOrder: ownOrder },
    data: { submittedForOrderId: null },
  });
  await tx.post.updateMany({
    where: { lastMessage: { group: { buyerOrganizationId: id } } },
    data: { lastMessageId: null },
  });
  await tx.post.updateMany({
    where: { parentPost: ownPost },
    data: { parentPostId: null },
  });
  await tx.post.deleteMany({ where: ownPost });
  await tx.orderItems.deleteMany({ where: { order: ownOrder } });
  await tx.orders.deleteMany({ where: ownOrder });
  await tx.messages.deleteMany({
    where: { group: { buyerOrganizationId: id } },
  });
  await tx.messagesGroup.deleteMany({ where: { buyerOrganizationId: id } });
  await tx.integration.deleteMany({ where: ownIntegration });
  await tx.customer.deleteMany({ where: { orgId: id } });
  await tx.tags.deleteMany({ where: { orgId: id } });
  await tx.signatures.deleteMany({ where: { organizationId: id } });
  await tx.sets.deleteMany({ where: { organizationId: id } });
  await tx.thirdParty.deleteMany({ where: { organizationId: id } });
  await tx.gitHub.deleteMany({ where: { organizationId: id } });
  await tx.notifications.deleteMany({ where: { organizationId: id } });
  await tx.credits.deleteMany({ where: { organizationId: id } });
  await tx.usedCodes.deleteMany({ where: { orgId: id } });
  await tx.subscription.deleteMany({ where: { organizationId: id } });

  // Images owned by the deleted tenant cannot remain as profile/app references elsewhere.
  await tx.user.updateMany({
    where: { picture: { organizationId: id } },
    data: { pictureId: null },
  });
  await tx.socialMediaAgency.updateMany({
    where: { logo: { organizationId: id } },
    data: { logoId: null },
  });
  await tx.oAuthApp.updateMany({
    where: { picture: { organizationId: id } },
    data: { pictureId: null },
  });
  await tx.media.deleteMany({ where: { organizationId: id } });
  await tx.socialMediaAgencyNiche.deleteMany({
    where: { agency: { userId: { in: userIds } } },
  });
  await tx.socialMediaAgency.deleteMany({ where: { userId: { in: userIds } } });
  await tx.itemUser.deleteMany({ where: { userId: { in: userIds } } });
  await tx.userOrganization.deleteMany({ where: { organizationId: id } });
  await tx.user.deleteMany({
    where: {
      id: { in: userIds },
      organizations: { none: {} },
      isPlatformAdmin: false,
      isSuperAdmin: false,
    },
  });

  // Purge identifiable historical administrative entries as part of the same erasure.
  await tx.adminAuditLog.deleteMany({
    where: {
      OR: [
        { targetType: 'organization', targetId: id },
        { targetType: 'user', targetId: { in: userIds } },
        { actorId: { in: userIds } },
        { details: { path: ['organizationId'], equals: id } },
        ...userIds.map((userId) => ({
          details: { path: ['ownerUserId'], equals: userId },
        })),
      ],
    },
  });
  await tx.organization.delete({ where: { id } });
  // The remaining entry contains counts and an opaque deleted ID, never the client's name or email.
  await tx.adminAuditLog.create({
    data: {
      actorId: org.deletionRequestedById!,
      action: 'organization.delete',
      targetType: 'organization',
      targetId: id,
      details: {
        deletedUsers: userIds.length,
        preservedUsers: scope.organization._count.users - userIds.length,
      },
    },
  });
}
