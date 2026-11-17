import { Injectable } from '@nestjs/common';
import { Integration, Post, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma/prisma.service';
import { IntegrationManager } from '../integrations/integration.manager';
import { AutomationRecoveryService } from './automation-recovery.service';
import {
  recoveryKey,
  RecoveryHold,
  RecoveryWorkflowContext,
} from './recovery-policy';
import {
  captureDerivedEffect,
  DerivedOutcome,
  DerivedReceipt,
} from './derived-effect-result';

type Tx = Prisma.TransactionClient;
type Check = { index: number; scheduledAt: string };
const supported: Record<string, string[]> = {
  threads: ['autoPlugPost'],
  'linkedin-page': [
    'autoRepostPost',
    'autoPlugPost',
    'addComment',
    'repostPostUsers',
  ],
  linkedin: ['addComment', 'repostPostUsers'],
  bluesky: ['autoRepostPost', 'autoPlugPost'],
  x: ['autoRepostPost', 'autoPlugPost', 'repostPostUsers'],
};
export const canonicalDerivedHash = (value: unknown): string => {
  const stable = (v: any): any =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])])
        )
      : v;
  return recoveryKey('derived-configuration-v1', JSON.stringify(stable(value)));
};

@Injectable()
export class DerivedPublicationService {
  constructor(
    private prisma: PrismaService,
    private recovery: AutomationRecoveryService,
    private manager: IntegrationManager
  ) {}

  private internalSettings(settings: string) {
    const result: Record<string, any> = Object.create(null);
    for (const [key, value] of Object.entries(JSON.parse(settings || '{}'))) {
      const match = /^plug--(.+)--([^-]+)$/.exec(key);
      if (match) {
        if (
          [match[1], match[2]].some((k) =>
            ['__proto__', 'prototype', 'constructor'].includes(k)
          )
        )
          throw new RecoveryHold('DERIVED_CONFIGURATION_INVALID');
        result[match[1]] ||= { name: match[1] };
        result[match[1]][match[2]] = value;
      }
    }
    return result;
  }

  private schedule(slot: Date, delay: number, total = 1): Check[] {
    if (
      !Number.isSafeInteger(delay) ||
      delay < 0 ||
      !Number.isSafeInteger(total) ||
      total < 1 ||
      total > 1000
    )
      throw new RecoveryHold('DERIVED_SCHEDULE_UNRESOLVED');
    return Array.from({ length: total }, (_, index) => {
      const at = +slot + delay * (index + 1);
      if (!Number.isSafeInteger(at) || !Number.isFinite(+new Date(at)))
        throw new RecoveryHold('DERIVED_SCHEDULE_UNRESOLVED');
      return { index, scheduledAt: new Date(at).toISOString() };
    });
  }

  async stage(
    tx: Tx,
    root: Post & { integration: { providerIdentifier: string } },
    slot: Date,
    rootOccurrenceId: string
  ) {
    const definitions: {
      actionKey: string;
      kind: string;
      identifier: string;
      method: string;
      targetIntegrationId: string;
      configurationHash: string;
      configurationSnapshot: Prisma.InputJsonValue;
      schedule: Check[];
      contractAvailable: boolean;
    }[] = [];
    const globals = await tx.plugs.findMany({
      where: {
        organizationId: root.organizationId,
        integrationId: root.integrationId,
        activated: true,
      },
      orderBy: { id: 'asc' },
    });
    for (const plug of globals) {
      const meta = this.manager
        .getAllPlugs()
        .find((p) => p.identifier === root.integration.providerIdentifier)
        ?.plugs?.find((p: any) => p.methodName === plug.plugFunction);
      const provider = this.manager.getSocialIntegration(
        root.integration.providerIdentifier
      );
      const schedulingMeta =
        meta ||
        (provider &&
          (
            Reflect.getMetadata(
              'custom:plug',
              provider.constructor.prototype
            ) || []
          ).find((p: any) => p.methodName === plug.plugFunction));
      definitions.push({
        actionKey: `plug:${plug.id}`,
        kind: 'global',
        identifier: plug.id,
        method: plug.plugFunction,
        targetIntegrationId: root.integrationId,
        configurationHash: canonicalDerivedHash({
          method: plug.plugFunction,
          data: plug.data,
        }),
        configurationSnapshot: { method: plug.plugFunction, data: plug.data },
        contractAvailable: !!meta,
        // Missing/disabled metadata is retained, rather than dropping the config.
        schedule: schedulingMeta
          ? this.schedule(
              slot,
              Number(schedulingMeta.runEveryMilliseconds),
              Number(schedulingMeta.totalRuns)
            )
          : this.schedule(slot, 0),
      });
    }
    for (const [name, information] of Object.entries(
      this.internalSettings(root.settings)
    )) {
      if (information.active === false) continue;
      for (const target of information.integrations || []) {
        if (typeof target?.id !== 'string')
          throw new RecoveryHold('DERIVED_TARGET_UNRESOLVED');
        const integration = await tx.integration.findFirst({
          where: { id: target.id, organizationId: root.organizationId },
        });
        let meta: any = null;
        try {
          meta = integration
            ? this.manager
                .getInternalPlugs(integration.providerIdentifier)
                .internalPlugs.find((p: any) => p.identifier === name)
            : null;
        } catch {
          /* preserve an unavailable integration's action for review */
        }
        definitions.push({
          actionKey: `internal:${name}:${target.id}`,
          kind: 'internal',
          identifier: name,
          method: meta?.methodName || '__unavailable__',
          targetIntegrationId: target.id,
          configurationHash: canonicalDerivedHash({
            source: root.integrationId,
            name,
            information,
          }),
          configurationSnapshot: {
            source: root.integrationId,
            name,
            information,
          },
          contractAvailable: !!meta,
          schedule: this.schedule(
            slot,
            Math.max(0, Number(information.delay || 0))
          ),
        });
      }
    }
    for (const { contractAvailable, ...def } of definitions) {
      const id = recoveryKey(
        'derived-action-v1',
        root.organizationId,
        rootOccurrenceId,
        def.actionKey
      );
      const target = await tx.integration.findFirst({
        where: {
          id: def.targetIntegrationId,
          organizationId: root.organizationId,
        },
      });
      const unavailable =
        !contractAvailable ||
        !target ||
        !supported[target.providerIdentifier]?.includes(def.method);
      const action = await tx.publicationDerivedAction.upsert({
        where: { id },
        create: {
          ...def,
          id,
          organizationId: root.organizationId,
          rootOccurrenceId,
          postId: root.id,
          sourceIntegrationId: root.integrationId,
          phase: unavailable ? 'RETAINED' : 'PENDING',
          reason: unavailable ? 'RECEIPT_CONTRACT_UNAVAILABLE' : null,
        },
        update: {},
      });
      if (
        action.configurationHash !== def.configurationHash ||
        canonicalDerivedHash(action.schedule) !==
          canonicalDerivedHash(def.schedule)
      ) {
        // Do not overwrite the frozen action or fail the independent primary
        // publication when a previously staged recurrence/configuration changed.
        await tx.publicationDerivedAction.updateMany({
          where: { id, phase: { in: ['PENDING', 'RETAINED'] } },
          data: { phase: 'RETAINED', reason: 'DERIVED_CONFIGURATION_CHANGED' },
        });
      }
    }
    return definitions.length;
  }

  private async resolve(tx: Tx, actionId: string, index: number) {
    const action = await tx.publicationDerivedAction.findUniqueOrThrow({
      where: { id: actionId },
    });
    const root = await tx.publicationOccurrence.findFirst({
      where: {
        id: action.rootOccurrenceId,
        organizationId: action.organizationId,
        postId: action.postId,
      },
    });
    if (!root) throw new RecoveryHold('DERIVED_PARENT_UNRESOLVED');
    await tx.$queryRaw`SELECT id FROM "Post" WHERE id=${root.postId} AND "organizationId"=${action.organizationId} FOR UPDATE`;
    const post = await tx.post.findFirst({
      where: { id: root.postId, organizationId: action.organizationId },
      include: { integration: true, organization: true },
    });
    const target = await tx.integration.findFirst({
      where: {
        id: action.targetIntegrationId,
        organizationId: action.organizationId,
      },
    });
    const available = (i: Integration) =>
      i && !i.deletedAt && !i.disabled && !i.refreshNeeded && !i.inBetweenSteps;
    if (
      !post ||
      !available(post.integration) ||
      !available(target) ||
      post.adminPausedAt ||
      post.deletedAt ||
      post.organization.suspendedAt ||
      post.organization.deletionRequestedAt ||
      post.integrationId !== action.sourceIntegrationId ||
      post.scheduleRevision !== root.scheduleRevision ||
      post.group !== root.groupSnapshot
    )
      throw new RecoveryHold('DERIVED_SCOPE_OR_REVISION_UNAVAILABLE');
    const intent = await tx.publicationScheduleIntent.findUnique({
      where: { occurrenceId: root.id },
    });
    const member = (intent?.snapshot as any)?.members?.find(
      (m: any) => m.id === post.id
    );
    if (
      !member ||
      +post.publishDate !== +new Date(member.publishDate) ||
      member.scheduleRevision !== post.scheduleRevision ||
      member.group !== post.group
    )
      throw new RecoveryHold('DERIVED_TEMPLATE_UNVERIFIED');
    const checks = action.schedule as unknown as Check[],
      check = checks[index];
    if (
      canonicalDerivedHash(action.configurationSnapshot) !==
      action.configurationHash
    )
      throw new RecoveryHold('DERIVED_CONFIGURATION_UNVERIFIED');
    if (
      !Number.isSafeInteger(index) ||
      !check ||
      check.index !== index ||
      !Number.isFinite(+new Date(check.scheduledAt))
    )
      throw new RecoveryHold('DERIVED_CHECK_UNRESOLVED');
    let configuration: any;
    if (action.kind === 'global') {
      const plug = await tx.plugs.findFirst({
        where: {
          id: action.identifier,
          organizationId: action.organizationId,
          integrationId: action.sourceIntegrationId,
          activated: true,
        },
      });
      if (
        !plug ||
        plug.plugFunction !== action.method ||
        canonicalDerivedHash({ method: plug.plugFunction, data: plug.data }) !==
          action.configurationHash
      )
        throw new RecoveryHold('DERIVED_CONFIGURATION_CHANGED');
      configuration = JSON.parse(plug.data).reduce(
        (all: any, field: any) => ({ ...all, [field.name]: field.value }),
        {}
      );
    } else {
      configuration = this.internalSettings(post.settings)[action.identifier];
      if (
        !configuration ||
        configuration.active === false ||
        canonicalDerivedHash({
          source: action.sourceIntegrationId,
          name: action.identifier,
          information: configuration,
        }) !== action.configurationHash ||
        !configuration.integrations?.some(
          (i: any) => i.id === action.targetIntegrationId
        )
      )
        throw new RecoveryHold('DERIVED_CONFIGURATION_CHANGED');
    }
    const parent = await tx.automationEffectAttempt.findFirst({
      where: {
        organizationId: action.organizationId,
        occurrenceId: root.id,
        actionKey: `publication:${post.id}`,
        phase: 'CONFIRMED',
        remoteId: { not: null },
      },
    });
    const manual = await tx.publicationEvidence.findFirst({
      where: {
        organizationId: action.organizationId,
        occurrenceId: root.id,
        origin: 'manual',
        confirmedById: { not: null },
        remoteId: { not: null },
      },
      orderBy: { confirmedAt: 'asc' },
    });
    const parentRemoteId = parent?.remoteId || manual?.remoteId;
    if (post.state === 'DRAFT')
      throw new RecoveryHold('DERIVED_PARENT_STATE_UNAVAILABLE');
    let availableMethod = false;
    try {
      availableMethod =
        action.kind === 'global'
          ? !!this.manager
              .getAllPlugs()
              .find((p) => p.identifier === target.providerIdentifier)
              ?.plugs?.some((p: any) => p.methodName === action.method)
          : !!this.manager
              .getInternalPlugs(target.providerIdentifier)
              .internalPlugs.some(
                (p: any) =>
                  p.methodName === action.method &&
                  p.identifier === action.identifier
              );
    } catch {
      /* Unknown provider metadata must retain the configured action. */
    }
    if (!availableMethod)
      throw new RecoveryHold('RECEIPT_CONTRACT_UNAVAILABLE');
    const requestHash = canonicalDerivedHash({
      actionId,
      index,
      configurationHash: action.configurationHash,
      parentRemoteId,
      schedule: check,
      revision: root.scheduleRevision,
      group: root.groupSnapshot,
    });
    return {
      action,
      root,
      post,
      target,
      configuration,
      parentRemoteId,
      checks,
      check,
      requestHash,
    };
  }

  async bind(
    context: RecoveryWorkflowContext,
    actionId: string,
    index: number
  ) {
    return this.recovery.withOpenPolicy(async (tx, policy) => {
      const resolved = await this.resolve(tx, actionId, index);
      const intent = await tx.publicationScheduleIntent.findUnique({
        where: { occurrenceId: resolved.root.id },
      });
      if (
        context.protocolVersion !== 1 ||
        !intent ||
        intent.generation !== policy.generation ||
        ![intent.workflowId, `derived-${resolved.root.id}`].includes(
          context.workflowId
        )
      )
        throw new RecoveryHold('DERIVED_WORKFLOW_UNAUTHORIZED');
      if (
        !resolved.parentRemoteId &&
        +new Date(resolved.check.scheduledAt) >= +policy.cutoffAt
      )
        throw new RecoveryHold('PARENT_CONFIRMATION_REQUIRED');
      const actionKey = `${resolved.action.actionKey}:check:${index}`;
      const binding = await tx.automationWorkflowBinding.upsert({
        where: {
          workflowId_runId_actionKey: {
            workflowId: context.workflowId,
            runId: context.runId,
            actionKey,
          },
        },
        create: {
          organizationId: resolved.action.organizationId,
          workflowId: context.workflowId,
          runId: context.runId,
          actionKey,
          occurrenceId: resolved.root.id,
          derivedActionId: actionId,
          derivedCheckIndex: index,
          expectedRequestHash: resolved.requestHash,
        },
        update: {},
      });
      if (
        binding.expectedRequestHash !== resolved.requestHash ||
        binding.derivedActionId !== actionId ||
        binding.derivedCheckIndex !== index
      )
        throw new RecoveryHold('DERIVED_BINDING_CHANGED');
      return actionKey;
    });
  }

  async plan(organizationId: string, rootOccurrenceId: string) {
    return this.prisma.publicationDerivedAction.findMany({
      where: { organizationId, rootOccurrenceId },
      select: { id: true, schedule: true },
      orderBy: { id: 'asc' },
    });
  }

  async executeLegacy(
    context: RecoveryWorkflowContext,
    actionKey: string,
    supplied?: any
  ): Promise<DerivedOutcome> {
    // Legacy arguments are never upgraded from mutable Post data. Only an
    // explicit reviewed binding can associate them to a derived action/check.
    const binding = await this.prisma.automationWorkflowBinding.findUnique({
      where: {
        workflowId_runId_actionKey: {
          workflowId: context.workflowId,
          runId: context.runId,
          actionKey,
        },
      },
    });
    if (
      !binding?.derivedActionId ||
      binding.derivedCheckIndex === null ||
      !binding.expectedRequestHash
    )
      throw new RecoveryHold('LEGACY_DERIVED_BINDING_REQUIRED');
    return this.executeBound(
      context,
      actionKey,
      binding.derivedActionId,
      binding.derivedCheckIndex,
      supplied
    );
  }

  async executeScheduled(
    context: RecoveryWorkflowContext,
    organizationId: string,
    rootOccurrenceId: string,
    actionId: string,
    index: number
  ) {
    const action = await this.prisma.publicationDerivedAction.findFirst({
      where: { id: actionId, organizationId, rootOccurrenceId },
    });
    if (!action) throw new RecoveryHold('DERIVED_SCOPE_UNAVAILABLE');
    try {
      return await this.executeBound(
        context,
        await this.bind(context, actionId, index),
        actionId,
        index
      );
    } catch (error) {
      if (
        error instanceof RecoveryHold &&
        [
          'PARENT_CONFIRMATION_REQUIRED',
          'RECEIPT_CONTRACT_UNAVAILABLE',
          'DERIVED_CONFIGURATION_CHANGED',
          'DERIVED_SCOPE_OR_REVISION_UNAVAILABLE',
          'DERIVED_TEMPLATE_UNVERIFIED',
        ].includes(error.reason)
      ) {
        await this.prisma.publicationDerivedAction.updateMany({
          where: { id: actionId, phase: { in: ['PENDING', 'RETAINED'] } },
          data: { phase: 'RETAINED', reason: error.reason },
        });
      }
      throw error;
    }
  }

  private async executeBound(
    context: RecoveryWorkflowContext,
    actionKey: string,
    actionId: string,
    index: number,
    supplied?: any
  ): Promise<DerivedOutcome> {
    const reservation = await this.recovery.withOpenPolicy(
      async (tx, policy) => {
        if (context.protocolVersion !== 1)
          throw new RecoveryHold('RECOVERY_PROTOCOL_MISMATCH');
        const r = await this.resolve(tx, actionId, index);
        const intent = await tx.publicationScheduleIntent.findUnique({
          where: { occurrenceId: r.root.id },
        });
        if (!intent || intent.generation !== policy.generation)
          throw new RecoveryHold('DERIVED_ADMISSION_CHANGED');
        const binding = await tx.automationWorkflowBinding.findUnique({
          where: {
            workflowId_runId_actionKey: {
              workflowId: context.workflowId,
              runId: context.runId,
              actionKey,
            },
          },
        });
        if (
          !binding ||
          binding.organizationId !== r.action.organizationId ||
          binding.derivedActionId !== actionId ||
          binding.derivedCheckIndex !== index ||
          binding.expectedRequestHash !== r.requestHash
        )
          throw new RecoveryHold('DERIVED_BINDING_CHANGED');
        if (supplied) {
          const delay = +new Date(r.check.scheduledAt) - +r.root.scheduledAt;
          if (
            r.action.kind === 'internal'
              ? supplied.orgId !== r.action.organizationId ||
                supplied.originalIntegration !== r.action.sourceIntegrationId ||
                supplied.integration !== r.action.targetIntegrationId ||
                supplied.plugName !== r.action.identifier ||
                supplied.post !== r.parentRemoteId ||
                Number(supplied.delay) !== delay ||
                canonicalDerivedHash(supplied.information) !==
                  canonicalDerivedHash(r.configuration)
              : supplied.plugId !== r.action.identifier ||
                supplied.postId !== r.parentRemoteId ||
                Number(supplied.delay) !== delay ||
                Number(supplied.totalRuns) !== r.checks.length ||
                (supplied.currentRun !== undefined &&
                  Number(supplied.currentRun) !== index + 1)
          )
            throw new RecoveryHold('LEGACY_DERIVED_ARGUMENTS_CHANGED');
        }
        const subjectKey = `derived:${actionId}`;
        const attempts = await tx.automationEffectAttempt.findMany({
          where: { organizationId: r.action.organizationId, subjectKey },
        });
        const confirmed = attempts.find((a) => a.phase === 'CONFIRMED');
        if (confirmed)
          return { cached: confirmed.receipt as unknown as DerivedOutcome };
        if (attempts.some((a) => ['CLAIMED', 'UNCERTAIN'].includes(a.phase))) {
          await tx.publicationDerivedAction.update({
            where: { id: actionId },
            data: { phase: 'UNCERTAIN', reason: 'REMOTE_OUTCOME_UNCONFIRMED' },
          });
          return {
            cached: {
              kind: 'UNCERTAIN',
              reason: 'REMOTE_OUTCOME_UNCONFIRMED',
            } as DerivedOutcome,
          };
        }
        const previous = attempts.find((a) => a.actionKey === `check:${index}`);
        if (previous)
          return { cached: previous.receipt as unknown as DerivedOutcome };
        if (
          +new Date(r.check.scheduledAt) < +policy.cutoffAt ||
          r.action.phase === 'EXPIRED' ||
          (await tx.automationRecoveryDecision.findUnique({
            where: {
              subjectKey_action: {
                subjectKey,
                action: `EXPIRE_CHECK:${index}`,
              },
            },
          }))
        ) {
          await tx.automationRecoveryDecision.upsert({
            where: {
              subjectKey_action: {
                subjectKey,
                action: `EXPIRE_CHECK:${index}`,
              },
            },
            create: {
              recoveryId: policy.runId,
              organizationId: r.action.organizationId,
              subjectKey,
              action: `EXPIRE_CHECK:${index}`,
              reason: 'DERIVED_BEFORE_T0',
            },
            update: {},
          });
          if (
            r.checks.every((c) => +new Date(c.scheduledAt) < +policy.cutoffAt)
          )
            await tx.publicationDerivedAction.update({
              where: { id: actionId },
              data: { phase: 'EXPIRED', reason: 'DERIVED_BEFORE_T0' },
            });
          return { held: 'DERIVED_BEFORE_T0' };
        }
        if (+new Date(r.check.scheduledAt) > Date.now())
          throw new RecoveryHold('DERIVED_NOT_DUE');
        if (!r.parentRemoteId)
          throw new RecoveryHold('PARENT_CONFIRMATION_REQUIRED');
        if (
          r.action.phase === 'RETAINED' &&
          r.action.reason === 'DERIVED_CONFIGURATION_CHANGED'
        )
          throw new RecoveryHold('DERIVED_CONFIGURATION_CHANGED');
        if (
          (r.action.phase === 'RETAINED' &&
            r.action.reason === 'RECEIPT_CONTRACT_UNAVAILABLE') ||
          !supported[r.target.providerIdentifier]?.includes(r.action.method)
        )
          throw new RecoveryHold('RECEIPT_CONTRACT_UNAVAILABLE');
        const id = recoveryKey(
            r.action.organizationId,
            subjectKey,
            `check:${index}`
          ),
          claimId = randomUUID();
        await tx.automationEffectAttempt.create({
          data: {
            id,
            organizationId: r.action.organizationId,
            subjectKey,
            actionKey: `check:${index}`,
            requestHash: r.requestHash,
            occurrenceId: r.root.id,
            postId: r.post.id,
            claimId,
            generation: policy.generation,
          },
        });
        return { id, claimId, generation: policy.generation, r };
      }
    );
    if ('cached' in reservation) return reservation.cached;
    if ('held' in reservation) throw new RecoveryHold(reservation.held);
    const { id, claimId, generation, r } = reservation;
    const checkpoint = async (receipt: DerivedReceipt) => {
      await this.prisma.$transaction(async (tx) => {
        const count = await tx.automationEffectAttempt.updateMany({
          where: { id, claimId, phase: 'CLAIMED' },
          data: {
            phase: 'CONFIRMED',
            remoteId: receipt.remoteId,
            receipt: { kind: 'CONFIRMED', receipt },
          },
        });
        if (count.count !== 1)
          throw new RecoveryHold('DERIVED_CHECKPOINT_CONFLICT');
        await tx.publicationDerivedAction.update({
          where: { id: actionId },
          data: { phase: 'CONFIRMED', reason: null },
        });
      });
    };
    const outcome = await captureDerivedEffect(
      async () => {
        const provider = this.manager.getSocialIntegration(
          r.target.providerIdentifier
        );
        const callback = provider?.[r.action.method];
        if (typeof callback !== 'function')
          throw new RecoveryHold('RECEIPT_CONTRACT_UNAVAILABLE');
        if (r.action.kind === 'internal')
          await callback.call(
            provider,
            r.target,
            r.post.integration,
            r.parentRemoteId,
            r.configuration
          );
        else
          await callback.call(
            provider,
            r.target,
            r.parentRemoteId,
            r.configuration
          );
      },
      {
        checkpoint,
        beforeMutation: () =>
          this.recovery.withOpenPolicy(async (tx, policy) => {
            if (policy.generation !== generation)
              throw new RecoveryHold('RECOVERY_GENERATION_CHANGED');
            const current = await this.resolve(tx, actionId, index);
            if (
              current.requestHash !== r.requestHash ||
              +new Date(current.check.scheduledAt) < +policy.cutoffAt
            )
              throw new RecoveryHold('DERIVED_ADMISSION_CHANGED');
            const attempt = await tx.automationEffectAttempt.findUnique({
              where: { id },
            });
            if (
              !attempt ||
              attempt.claimId !== claimId ||
              attempt.phase !== 'CLAIMED'
            )
              throw new RecoveryHold('DERIVED_CLAIM_UNAVAILABLE');
          }),
      }
    );
    if (outcome.kind === 'CONFIRMED') return outcome;
    // If a checkpoint's acknowledgement was lost, metadata may already prove
    // success. Never issue another POST while resolving this uncertainty.
    const stored = await this.prisma.automationEffectAttempt.findUnique({
      where: { id },
    });
    if (stored?.phase === 'CONFIRMED')
      return stored.receipt as unknown as DerivedOutcome;
    await this.prisma.$transaction(async (tx) => {
      await tx.automationEffectAttempt.updateMany({
        where: { id, claimId, phase: 'CLAIMED' },
        data: {
          phase: outcome.kind === 'NOT_EXECUTED' ? 'NOT_EXECUTED' : 'UNCERTAIN',
          receipt: outcome as Prisma.InputJsonValue,
          failureReason: outcome.kind === 'UNCERTAIN' ? outcome.reason : null,
        },
      });
      await tx.publicationDerivedAction.update({
        where: { id: actionId },
        data: {
          phase:
            outcome.kind === 'UNCERTAIN'
              ? 'UNCERTAIN'
              : index === r.checks.length - 1
              ? 'NOT_EXECUTED'
              : 'PENDING',
          reason: outcome.kind === 'UNCERTAIN' ? outcome.reason : null,
        },
      });
    });
    return outcome;
  }
}
