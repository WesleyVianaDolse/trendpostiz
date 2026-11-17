import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma/prisma.service';
import { RecoveryHold, recoveryKey } from './recovery-policy';
import {
  classifyRecoveryInventory,
  inventoryHash,
  RecoveryInventory,
} from './recovery-inventory';

@Injectable()
export class RecoveryManifestService {
  constructor(private prisma: PrismaService) {}

  private async prepareOnly(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT id FROM "AutomationRecoveryControl" WHERE id='global' FOR UPDATE`;
    const [control, user] = await Promise.all([
      tx.automationRecoveryControl.findUnique({ where: { id: 'global' } }),
      tx.user.findUnique({ where: { id: userId } }),
    ]);
    if (!control || control.phase === 'OPEN')
      throw new RecoveryHold('INVENTORY_REQUIRES_BLOCKED_CONSUMPTION');
    if (!user?.activated || user.disabledAt || !user.isSuperAdmin)
      throw new RecoveryHold('INVENTORY_OPERATOR_UNAUTHORIZED');
  }

  /** Only inventory tables are written; no authorization or client state changes. */
  async draft(
    userId: string,
    recoveryId: string,
    cutoffAt: Date,
    source: RecoveryInventory,
    batchSize = 200,
    afterBatch?: () => Promise<void>
  ) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
      throw new RecoveryHold('INVALID_MANIFEST_BATCH');
    const items = classifyRecoveryInventory(source, cutoffAt),
      sourceHash = inventoryHash(source),
      scope = [...source.scope].sort();
    const id = recoveryKey(
      'recovery-manifest-v1',
      recoveryId,
      cutoffAt.toISOString(),
      inventoryHash(scope),
      sourceHash
    );
    await this.prisma.$transaction(async (tx) => {
      await this.prepareOnly(tx, userId);
      const existing = await tx.recoveryManifest.findUnique({ where: { id } });
      if (existing) {
        if (
          existing.createdById !== userId ||
          existing.sourceHash !== sourceHash ||
          existing.phase === 'INVALIDATED'
        )
          throw new RecoveryHold('MANIFEST_RESUME_MISMATCH');
        return;
      }
      const run = await tx.automationRecoveryRun.findUnique({
        where: { id: recoveryId },
      });
      if (
        run &&
        (run.authorizedAt ||
          run.phase === 'VERIFIED' ||
          run.phase === 'OPEN' ||
          +run.cutoffAt !== +cutoffAt)
      )
        throw new RecoveryHold('RECOVERY_CUTOFF_IMMUTABLE_CREATE_NEW_RUN');
      if (!run)
        await tx.automationRecoveryRun.create({
          data: { id: recoveryId, cutoffAt, phase: 'INVENTORIED' },
        });
      const version =
        (
          await tx.recoveryManifest.aggregate({
            where: { recoveryId },
            _max: { version: true },
          })
        )._max.version || 0;
      await tx.recoveryManifest.updateMany({
        where: { recoveryId, phase: { not: 'INVALIDATED' } },
        data: {
          phase: 'INVALIDATED',
          invalidReason: 'SUPERSEDED_SOURCE_VERSION',
        },
      });
      await tx.recoveryManifest.create({
        data: {
          id,
          recoveryId,
          version: version + 1,
          cutoffAt,
          scope,
          sourceHash,
          itemCount: items.length,
          createdById: userId,
        },
      });
    });
    for (;;) {
      const finished = await this.prisma.$transaction(async (tx) => {
        await this.prepareOnly(tx, userId);
        const manifest = await tx.recoveryManifest.findUniqueOrThrow({
          where: { id },
        });
        if (manifest.phase === 'COMPLETE' || manifest.phase === 'REVALIDATED')
          return true;
        if (
          manifest.phase !== 'COLLECTING' ||
          manifest.sourceHash !== sourceHash
        )
          throw new RecoveryHold('MANIFEST_VERSION_CHANGED');
        for (
          let ordinal = manifest.cursor;
          ordinal < Math.min(items.length, manifest.cursor + batchSize);
          ordinal++
        ) {
          const item = items[ordinal],
            fingerprint = inventoryHash(item);
          const row = await tx.recoveryManifestItem.upsert({
            where: { manifestId_ordinal: { manifestId: id, ordinal } },
            create: { manifestId: id, ordinal, ...item, fingerprint },
            update: {},
          });
          if (row.fingerprint !== fingerprint)
            throw new RecoveryHold('MANIFEST_ROW_CHANGED');
        }
        const cursor = Math.min(items.length, manifest.cursor + batchSize),
          complete = cursor === items.length;
        await tx.recoveryManifest.update({
          where: { id },
          data: {
            cursor,
            phase: complete ? 'COMPLETE' : 'COLLECTING',
            manifestHash: complete
              ? inventoryHash({ id, cutoffAt, scope, sourceHash, items })
              : null,
          },
        });
        return complete;
      });
      if (afterBatch) await afterBatch();
      if (finished) break;
    }
    return this.export(userId, id);
  }

  async export(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.prepareOnly(tx, userId);
      const m = await tx.recoveryManifest.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: { ordinal: 'asc' } } },
      });
      return {
        ...m,
        preparationOnly: true,
        activationAuthorized: false,
        pendingHandoff: 'REQUIRES_SEPARATE_H_I_AUTHORIZATION',
        holds: m.items.filter((i) =>
          ['RETAIN', 'REVIEW_BINDINGS'].includes(i.decision)
        ).length,
      };
    });
  }

  async revalidate(
    userId: string,
    id: string,
    source: RecoveryInventory,
    authorizedCutoff: Date
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.prepareOnly(tx, userId);
      const m = await tx.recoveryManifest.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: { ordinal: 'asc' } } },
      });
      const items = classifyRecoveryInventory(source, authorizedCutoff);
      const run = await tx.automationRecoveryRun.findUnique({
        where: { id: m.recoveryId },
      });
      const reason =
        !run ||
        run.protocolVersion !== 1 ||
        m.protocolVersion !== 1 ||
        +run.cutoffAt !== +m.cutoffAt ||
        run.authorizedAt ||
        run.phase !== 'INVENTORIED'
          ? 'RECOVERY_RUN_CHANGED'
          : +m.cutoffAt !== +authorizedCutoff
          ? 'CUTOFF_CHANGED_NEW_MANIFEST_REQUIRED'
          : m.sourceHash !== inventoryHash(source)
          ? 'SOURCE_CHANGED'
          : !['COMPLETE', 'REVALIDATED'].includes(m.phase) ||
            m.cursor !== m.itemCount ||
            m.items.length !== m.itemCount ||
            items.length !== m.itemCount ||
            m.items.some(
              (r, i) =>
                r.ordinal !== i ||
                r.fingerprint !== inventoryHash(items[i]) ||
                r.fingerprint !==
                  inventoryHash({
                    subjectKey: r.subjectKey,
                    organizationId: r.organizationId || undefined,
                    postId: r.postId || undefined,
                    decision: r.decision,
                    reason: r.reason,
                    metadata: r.metadata,
                  })
            )
          ? 'MANIFEST_INCOMPLETE_OR_CHANGED'
          : m.manifestHash !==
            inventoryHash({
              id: m.id,
              cutoffAt: m.cutoffAt,
              scope: m.scope,
              sourceHash: m.sourceHash,
              items,
            })
          ? 'MANIFEST_HASH_CHANGED'
          : null;
      await tx.recoveryManifest.update({
        where: { id },
        data: {
          phase: reason ? 'INVALIDATED' : 'REVALIDATED',
          invalidReason: reason,
          checkedAt: new Date(),
          checkedById: userId,
        },
      });
      return {
        matches: !reason,
        reason,
        manifestHash: m.manifestHash,
        activationAuthorized: false,
        containmentVerified: false,
        temporalCompletenessCertified: false,
      };
    });
  }
}
