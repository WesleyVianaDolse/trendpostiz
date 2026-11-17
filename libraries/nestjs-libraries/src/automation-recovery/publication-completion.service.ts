import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma/prisma.service';
import { NotificationService } from '../database/prisma/notifications/notification.service';
import { WebhooksService } from '../database/prisma/webhooks/webhooks.service';
import { PostsService } from '../database/prisma/posts/posts.service';
import { IntegrationManager } from '../integrations/integration.manager';
import { TemporalService } from 'nestjs-temporal-core';
import {
  PublicationSchedulingService,
  ScheduleDescriptor,
} from './publication-scheduling.service';
import { AutomationRecoveryService } from './automation-recovery.service';
import {
  RecoveryHold,
  RecoveryWorkflowContext,
  recoveryKey,
} from './recovery-policy';
import { inventoryHash } from './recovery-inventory';
import { TypedSearchAttributes } from '@temporalio/common';
import { organizationId } from '../temporal/temporal.search.attribute';

/** Ancillary effects have their own ledger. They never change publication proof. */
@Injectable()
export class PublicationCompletionService {
  constructor(
    private prisma: PrismaService,
    private recovery: AutomationRecoveryService,
    private scheduling: PublicationSchedulingService,
    private notifications: NotificationService,
    private webhooks: WebhooksService,
    private posts: PostsService,
    private manager: IntegrationManager,
    private temporal: TemporalService
  ) {}

  private async evidence(
    context: RecoveryWorkflowContext,
    descriptor: ScheduleDescriptor,
    phase: 'root' | 'thread' | 'failure'
  ) {
    const postId = await this.scheduling.rootPostId(descriptor);
    const bound = await this.scheduling.bind(context, descriptor, postId);
    return this.recovery.withOpenPolicy(async (tx, policy) => {
      if (+new Date(descriptor.scheduledAt) < +policy.cutoffAt)
        throw new RecoveryHold('COMPLETION_BEFORE_T0');
      const post = await tx.post.findFirstOrThrow({
        where: { id: postId, organizationId: descriptor.organizationId },
        include: { integration: true, organization: true },
      });
      if (
        post.scheduleRevision !== bound.post.scheduleRevision ||
        post.group !== bound.post.group ||
        +post.publishDate !== +bound.post.publishDate ||
        post.adminPausedAt ||
        post.deletedAt ||
        post.organization.suspendedAt ||
        post.organization.deletionRequestedAt ||
        post.integration.organizationId !== post.organizationId ||
        post.integration.deletedAt ||
        (phase !== 'failure' &&
          (post.integration.disabled ||
            post.integration.refreshNeeded ||
            post.integration.inBetweenSteps))
      )
        throw new RecoveryHold('COMPLETION_SCOPE_OR_REVISION_CHANGED');
      const primary = await tx.automationEffectAttempt.findFirst({
        where: {
          organizationId: post.organizationId,
          occurrenceId: descriptor.occurrenceId,
          actionKey: `publication:${postId}`,
          phase: 'CONFIRMED',
        },
      });
      if (phase !== 'failure' && !primary?.remoteId)
        throw new RecoveryHold('PRIMARY_RECEIPT_REQUIRED');
      if (phase === 'failure' && primary)
        throw new RecoveryHold('PRIMARY_ALREADY_CONFIRMED');
      if (
        phase === 'thread' &&
        this.manager.getSocialIntegration(post.integration.providerIdentifier)
          ?.comment
      ) {
        for (const member of bound.members.slice(1)) {
          const binding = await tx.automationWorkflowBinding.findUnique({
            where: {
              workflowId_runId_actionKey: {
                workflowId: context.workflowId,
                runId: context.runId,
                actionKey: `comment:${member.id}`,
              },
            },
          });
          if (
            !binding ||
            !(await tx.automationEffectAttempt.findFirst({
              where: {
                organizationId: post.organizationId,
                occurrenceId: binding.occurrenceId,
                actionKey: `comment:${member.id}`,
                phase: 'CONFIRMED',
              },
            }))
          )
            throw new RecoveryHold('THREAD_RECEIPT_REQUIRED');
        }
      }
      return { post, primary, generation: policy.generation };
    });
  }

  private async once(
    context: RecoveryWorkflowContext,
    descriptor: ScheduleDescriptor,
    phase: 'root' | 'thread' | 'failure',
    actionKey: string,
    configuration: unknown,
    callback: () => Promise<void>
  ) {
    const bound = await this.evidence(context, descriptor, phase),
      subjectKey = `completion:${descriptor.occurrenceId}`;
    const requestHash = inventoryHash({
      occurrenceId: descriptor.occurrenceId,
      actionKey,
      revision: bound.post.scheduleRevision,
      configuration,
    });
    const id = recoveryKey(descriptor.organizationId, subjectKey, actionKey),
      claimId = randomUUID();
    const reserved = await this.recovery.withOpenPolicy(async (tx, policy) => {
      if (policy.generation !== bound.generation)
        throw new RecoveryHold('RECOVERY_GENERATION_CHANGED');
      const previous = await tx.automationEffectAttempt.findUnique({
        where: { id },
      });
      if (previous)
        return {
          cached:
            previous.phase === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'UNCERTAIN',
        };
      await tx.automationEffectAttempt.create({
        data: {
          id,
          organizationId: descriptor.organizationId,
          subjectKey,
          actionKey,
          requestHash,
          occurrenceId: descriptor.occurrenceId,
          postId: bound.post.id,
          claimId,
          generation: policy.generation,
        },
      });
      return { cached: null };
    });
    if (reserved.cached) return { actionKey, phase: reserved.cached };
    // A lost callback acknowledgement is retained, never automatically repeated.
    let acknowledged = false;
    try {
      await this.evidence(context, descriptor, phase);
      await callback();
      acknowledged = true;
    } catch {
      /* Never persist network response/error bodies or secrets. */
    }
    await this.prisma.automationEffectAttempt.updateMany({
      where: { id, claimId, phase: 'CLAIMED' },
      data: {
        phase: acknowledged ? 'ACKNOWLEDGED' : 'UNCERTAIN',
        receipt: {
          kind: acknowledged
            ? 'ANCILLARY_CALLBACK_RETURNED'
            : 'ANCILLARY_RESULT_UNCONFIRMED',
          publicationConfirmed: false,
        },
        failureReason: acknowledged ? null : 'ANCILLARY_RESULT_UNCONFIRMED',
      },
    });
    return { actionKey, phase: acknowledged ? 'ACKNOWLEDGED' : 'UNCERTAIN' };
  }

  async threadFailure(
    context: RecoveryWorkflowContext,
    descriptor: ScheduleDescriptor,
    memberId: string
  ) {
    const { post, primary } = await this.evidence(context, descriptor, 'root');
    const bound = await this.scheduling.bind(
      context,
      descriptor,
      memberId,
      primary!.remoteId!
    );
    if (memberId === post.id || !bound.members.some((m) => m.id === memberId))
      throw new RecoveryHold('THREAD_MEMBER_UNVERIFIED');
    const binding =
      await this.prisma.automationWorkflowBinding.findUniqueOrThrow({
        where: {
          workflowId_runId_actionKey: {
            workflowId: context.workflowId,
            runId: context.runId,
            actionKey: `comment:${memberId}`,
          },
        },
      });
    const confirmed = await this.prisma.automationEffectAttempt.findFirst({
      where: {
        organizationId: post.organizationId,
        occurrenceId: binding.occurrenceId,
        actionKey: `comment:${memberId}`,
        phase: 'CONFIRMED',
      },
    });
    if (confirmed)
      return {
        actionKey: `notification-thread-failure:${memberId}`,
        phase: 'PRESERVED_CONFIRMED_REPLY',
      };
    const releaseURL = (primary!.receipt as any)?.[0]?.releaseURL;
    return this.once(
      context,
      descriptor,
      'root',
      `notification-thread-failure:${memberId}`,
      { memberId },
      async () => {
        await this.notifications.inAppNotification(
          post.organizationId,
          'A scheduled reply requires review',
          'The main post was published, but a scheduled reply was not confirmed. Check the thread before retrying.',
          true,
          false,
          'fail',
          {
            accountName: post.integration.name,
            username: post.integration.profile || undefined,
            providerIdentifier: post.integration.providerIdentifier,
            content: bound.post.content,
            releaseURL,
            occurredAt: new Date().toISOString(),
          }
        );
      }
    );
  }

  async run(
    context: RecoveryWorkflowContext,
    descriptor: ScheduleDescriptor,
    phase: 'root' | 'thread' | 'failure'
  ) {
    const { post, primary } = await this.evidence(context, descriptor, phase),
      results: any[] = [];
    if (phase === 'root' || phase === 'failure') {
      const failed = phase === 'failure',
        provider = post.integration.providerIdentifier;
      const releaseURL = (primary?.receipt as any)?.[0]?.releaseURL;
      results.push(
        await this.once(
          context,
          descriptor,
          phase,
          failed ? 'notification-failure' : 'notification-success',
          { remoteId: primary?.remoteId || null },
          async () => {
            await this.notifications.inAppNotification(
              post.organizationId,
              failed
                ? `Automatic publication requires review on ${provider}`
                : `Your post has been published on ${provider}`,
              failed
                ? 'Automatic publication was not confirmed. Check the channel before sending again.'
                : `Your post has been published on ${provider} at ${
                    releaseURL || ''
                  }`,
              true,
              !failed,
              failed
                ? post.integration.disabled || post.integration.refreshNeeded
                  ? 'info'
                  : 'fail'
                : 'success',
              {
                accountName: post.integration.name,
                username: post.integration.profile || undefined,
                providerIdentifier: provider,
                content: post.content,
                releaseURL: releaseURL || undefined,
                occurredAt: new Date().toISOString(),
              }
            );
          }
        )
      );
      if (!failed)
        results.push(
          await this.once(
            context,
            descriptor,
            phase,
            'streak',
            {},
            async () => {
              await this.temporal.client
                .getRawClient()
                .workflow.start('streakWorkflow', {
                  args: [{ organizationId: post.organizationId }],
                  workflowId: `streak_${post.organizationId}`,
                  taskQueue: 'main',
                  workflowIdConflictPolicy: 'TERMINATE_EXISTING',
                  typedSearchAttributes: new TypedSearchAttributes([
                    { key: organizationId, value: post.organizationId },
                  ]),
                });
            }
          )
        );
    }
    if (phase === 'thread') {
      const hooks = (
        await this.webhooks.getWebhooks(post.organizationId)
      ).filter(
        (h) =>
          !h.integrations.length ||
          h.integrations.some((i) => i.integration.id === post.integrationId)
      );
      for (const hook of hooks) {
        const configuration = inventoryHash({
          url: hook.url,
          integrations: hook.integrations,
        });
        results.push(
          await this.once(
            context,
            descriptor,
            phase,
            `webhook:${hook.id}`,
            configuration,
            async () => {
              const current = (
                await this.webhooks.getWebhooks(post.organizationId)
              ).find((h) => h.id === hook.id);
              if (
                !current ||
                inventoryHash({
                  url: current.url,
                  integrations: current.integrations,
                }) !== configuration
              )
                throw new RecoveryHold('WEBHOOK_CONFIGURATION_CHANGED');
              // Existing recipient/payload contract, now using the local Post id.
              // The legacy workflow passed a remote id to this local-id reader.
              const payload = await this.posts.getPostByForWebhookId(post.id);
              await this.evidence(context, descriptor, phase);
              const response = await fetch(current.url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Idempotency-Key': recoveryKey(
                    descriptor.occurrenceId,
                    hook.id
                  ),
                },
                body: JSON.stringify(payload),
                redirect: 'error',
                signal: AbortSignal.timeout(30000),
              });
              if (!response.ok) throw new Error('WEBHOOK_RESULT_UNCONFIRMED');
            }
          )
        );
      }
    }
    return results;
  }
}
