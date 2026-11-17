import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { YoutubePublicationService } from '@gitroom/nestjs-libraries/integrations/youtube-publication.service';
import {
  Activity,
  ActivityMethod,
  TemporalService,
} from 'nestjs-temporal-core';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  NotificationService,
  NotificationType,
} from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Integration, Post, State } from '@prisma/client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { AuthTokenDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { timer } from '@gitroom/helpers/utils/timer';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import type { PostNotificationDetails } from '@gitroom/nestjs-libraries/emails/notification.email';
import { PlatformService } from '@gitroom/nestjs-libraries/database/prisma/platform/platform.service';
import { ApplicationFailure } from '@temporalio/common';
import { AutomationRecoveryService } from '@gitroom/nestjs-libraries/automation-recovery/automation-recovery.service';
import { RECOVERY_PROTOCOL, RecoveryHold } from '@gitroom/nestjs-libraries/automation-recovery/recovery-policy';

// Drops fields the workflow and downstream activities never read — biggest wins are `error` (grows per retry) and `childrenPost` (Prisma side-loads it on every recursive row).
function slimPost(post: any) {
  if (!post) return post;
  const {
    error,
    childrenPost,
    tags,
    description,
    title,
    submittedForOrderId,
    submittedForOrganizationId,
    submittedForOrder,
    submittedForOrganization,
    lastMessageId,
    parentPostId,
    approvedSubmitForOrder,
    deletedAt,
    createdAt,
    updatedAt,
    payoutProblems,
    comments,
    errors,
    ...rest
  } = post;
  return rest;
}

@Injectable()
@Activity()
export class PostActivity {
  constructor(
    private _postService: PostsService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _webhookService: WebhooksService,
    private _temporalService: TemporalService,
    private _subscriptionService: SubscriptionService,
    private _platform: PlatformService,
    private _recovery: AutomationRecoveryService,
    private _youtube?: YoutubePublicationService
  ) {}

  private recoveryWorkflowContext() {
    const execution = Context.current().info.workflowExecution;
    return { workflowId: execution.workflowId, runId: execution.runId, protocolVersion: RECOVERY_PROTOCOL };
  }

  private async recoveryCall<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error) {
      if (error instanceof RecoveryHold) throw ApplicationFailure.nonRetryable(error.reason, 'automation_recovery_hold');
      throw error;
    }
  }

  @ActivityMethod()
  async getIntegrationById(orgId: string, id: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  @ActivityMethod()
  async searchForMissingThreeHoursPosts() {
    return this._postService.reconcileSafeSchedules();
  }

  @ActivityMethod()
  async updatePost(id: string, postId: string, releaseURL: string) {
    return this.recoveryCall(() => this._recovery.projectActivityReceipt(this.recoveryWorkflowContext(), id, postId, releaseURL));
  }

  @ActivityMethod()
  async getPost(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return false;
      }
    }
    return this._postService.getPostById(postId, orgId);
  }

  @ActivityMethod()
  async getPostsList(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return [];
      }
    }

    const getPosts = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId
    );
    if (!getPosts || getPosts.length === 0 || getPosts[0].parentPostId) {
      return [];
    }

    return getPosts.map(slimPost);
  }

  @ActivityMethod()
  async isCommentable(integration: Integration) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return !!getIntegration.comment;
  }

  @ActivityMethod()
  async postComment(
    postId: string,
    lastPostId: string | undefined,
    integration: Integration,
    posts: Post[]
  ) {
    const recovery = { ...this.recoveryWorkflowContext(), organizationId: integration.organizationId,
      integrationId: integration.id, snapshots: posts, actionKey: `comment:${posts[0]?.id}`, parentRemoteId: postId };
    const confirmed = await this.recoveryCall(() => this._recovery.confirmedPublicationReceipt(recovery));
    if (confirmed) return confirmed;
    await this.recoveryCall(() => this._recovery.guardPublication(recovery));
    if (!await this._platform.canPublishPosts(integration.organizationId, posts)) {
      throw ApplicationFailure.nonRetryable('Publicação pausada ou reagendada.', 'organization_suspended');
    }
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    const newPosts = await this._postService.updateTags(
      integration.organizationId,
      posts
    );

    const payload = await Promise.all(
        (newPosts || []).map(async (p) => ({
          id: p.id,
          message: stripHtmlValidation(
            getIntegration.editor,
            p.content,
            true,
            false,
            !/<\/?[a-z][\s\S]*>/i.test(p.content),
            getIntegration.mentionFormat
          ),
          settings: JSON.parse(p.settings || '{}'),
          media: await this._postService.updateMedia(
            p.id,
            JSON.parse(p.image || '[]'),
            getIntegration?.convertToJPEG || false
          ),
        }))
    );
    if (!await this._platform.canPublishPosts(integration.organizationId, posts)) {
      throw ApplicationFailure.nonRetryable('Publicação pausada ou reagendada.', 'organization_suspended');
    }
    return this.recoveryCall(() => this._recovery.executePublication(recovery, () =>
      getIntegration.comment(integration.internalId, postId, lastPostId, integration.token, payload, integration)));
  }

  @ActivityMethod()
  async postSocial(integration: Integration, posts: Post[], completionHandled = false) {
    const recovery = { ...this.recoveryWorkflowContext(), organizationId: integration.organizationId,
      integrationId: integration.id, snapshots: posts, actionKey: `publication:${posts[0]?.id}` };
    const confirmed = await this.recoveryCall(() => this._recovery.confirmedPublicationReceipt(recovery));
    if (confirmed) return confirmed;
    await this.recoveryCall(() => this._recovery.guardPublication(recovery));
    if (!await this._platform.canPublishPosts(integration.organizationId, posts)) {
      throw ApplicationFailure.nonRetryable('Publicação pausada ou reagendada.', 'organization_suspended');
    }
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        integration.organizationId
      );

      if (!subscription) {
        throw new Error('No active subscription found for this organization.');
      }
    }

    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    const newPosts = await this._postService.updateTags(
      integration.organizationId,
      posts
    );

    const payload = await Promise.all(
        (newPosts || []).map(async (p) => ({
          id: p.id,
          message: stripHtmlValidation(
            getIntegration.editor,
            p.content,
            true,
            false,
            !/<\/?[a-z][\s\S]*>/i.test(p.content),
            getIntegration.mentionFormat
          ),
          settings: JSON.parse(p.settings || '{}'),
          media: await this._postService.updateMedia(
            p.id,
            JSON.parse(p.image || '[]'),
            getIntegration?.convertToJPEG || false
          ),
        }))
    );
    if (!await this._platform.canPublishPosts(integration.organizationId, posts)) {
      throw ApplicationFailure.nonRetryable('Publicação pausada ou reagendada.', 'organization_suspended');
    }
    const bound = integration.providerIdentifier === 'youtube'
      ? await this.recoveryCall(() => this._recovery.contextForBoundAction(recovery, recovery.actionKey, posts[0].id)) : null;
    const postNow = await this.recoveryCall(() => this._recovery.executePublication(recovery, () => integration.providerIdentifier === 'youtube'
      ? this._youtube!.publish(integration, payload, Context.current().info.workflowExecution.workflowId, {
          snapshot: { ...posts[0], scheduleRevision: bound!.snapshots[0].scheduleRevision },
          onUploaded: videoId => this._recovery.checkpointPublication(recovery, videoId, `https://www.youtube.com/watch?v=${videoId}`),
        })
      : getIntegration.post(integration.internalId, integration.token, payload, integration)));

    if (!completionHandled) await this._temporalService.client
      .getRawClient()
      .workflow.start('streakWorkflow', {
        args: [{ organizationId: integration.organizationId }],
        workflowId: `streak_${integration.organizationId}`,
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: organizationId,
            value: integration.organizationId,
          },
        ]),
      });

    return postNow;
  }

  @ActivityMethod()
  async processYoutubeThumbnail(organizationId: string, postId: string, videoId: string) {
    return this._youtube!.attempt(organizationId, postId, videoId);
  }

  @ActivityMethod()
  async stopYoutubeThumbnail(organizationId: string, postId: string, videoId: string) {
    return this._youtube!.stop(organizationId, postId, videoId);
  }

  @ActivityMethod()
  async inAppNotification(
    orgId: string,
    subject: string,
    message: string,
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success',
    post?: PostNotificationDetails
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      subject,
      message,
      sendEmail,
      digest,
      type,
      post
    );
  }

  @ActivityMethod()
  async globalPlugs(integration: Integration) {
    return this._postService.checkPlugs(
      integration.organizationId,
      integration.providerIdentifier,
      integration.id
    );
  }

  @ActivityMethod()
  async changeState(id: string, state: State, err?: any, body?: any) {
    if (state !== 'ERROR') throw ApplicationFailure.nonRetryable('Workflow state mutation requires reconciliation.', 'automation_recovery_hold');
    return this.recoveryCall(() => this._recovery.recordWorkflowFailure(this.recoveryWorkflowContext(), id));
  }

  @ActivityMethod()
  async internalPlugs(integration: Integration, settings: any) {
    return this._postService.checkInternalPlug(
      integration,
      integration.organizationId,
      integration.id,
      settings
    );
  }

  @ActivityMethod()
  async sendWebhooks(postId: string, orgId: string, integrationId: string) {
    const webhooks = (await this._webhookService.getWebhooks(orgId)).filter(
      (f) => {
        return (
          f.integrations.length === 0 ||
          f.integrations.some((i) => i.integration.id === integrationId)
        );
      }
    );

    const post = await this._postService.getPostByForWebhookId(postId);
    await Promise.all(
      webhooks.map(async (webhook) => {
        try {
          await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(post),
          });
        } catch (e) {
          /**empty**/
        }
      })
    );
  }
  @ActivityMethod()
  async processPlug(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    return this.recoveryCall(() => this._integrationService.processPlugs(data, this.recoveryWorkflowContext()));
  }

  @ActivityMethod()
  async processInternalPlug(data: {
    post: string;
    originalIntegration: string;
    integration: string;
    plugName: string;
    orgId: string;
    delay: number;
    information: any;
  }) {
    if (!await this._platform.isOrganizationActive(data.orgId)) return;
    return this.recoveryCall(() => this._integrationService.processInternalPlug(data, false, this.recoveryWorkflowContext()));
  }

  @ActivityMethod()
  async refreshToken(
    integration: Integration
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(integration);
      return false;
    }
  }

  @ActivityMethod()
  async refreshTokenWithCause(
    integration: Integration,
    cause: string
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration,
        cause
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(integration, cause);
      return false;
    }
  }
}
