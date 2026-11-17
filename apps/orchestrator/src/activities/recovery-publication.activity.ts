import { Injectable, Optional } from '@nestjs/common';
import { DerivedPublicationService } from '@gitroom/nestjs-libraries/automation-recovery/derived-publication.service';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import {
  PublicationSchedulingService,
  ScheduleDescriptor,
} from '@gitroom/nestjs-libraries/automation-recovery/publication-scheduling.service';
import { AutomationRecoveryService } from '@gitroom/nestjs-libraries/automation-recovery/automation-recovery.service';
import { RecoveryHold } from '@gitroom/nestjs-libraries/automation-recovery/recovery-policy';
import { PostActivity } from './post.activity';
import { PublicationCompletionService } from '@gitroom/nestjs-libraries/automation-recovery/publication-completion.service';

@Injectable()
@Activity()
export class RecoveryPublicationActivity {
  constructor(
    private scheduling: PublicationSchedulingService,
    private recovery: AutomationRecoveryService,
    private posts: PostActivity,
    @Optional() private derived?: DerivedPublicationService,
    @Optional() private completion?: PublicationCompletionService
  ) {}

  private context() {
    return { ...Context.current().info.workflowExecution, protocolVersion: 1 };
  }
  private async guarded<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof RecoveryHold)
        throw ApplicationFailure.nonRetryable(
          error.reason,
          'automation_recovery_hold'
        );
      throw error;
    }
  }

  @ActivityMethod()
  recoveryPublicationPlan(descriptor: ScheduleDescriptor) {
    return this.guarded(async () => {
      const bound = await this.scheduling.bind(
        this.context(),
        descriptor,
        await this.scheduling.rootPostId(descriptor)
      );
      return {
        members: bound.members.map((m) => ({
          id: m.id,
          scheduledAt: m.scheduledAt,
        })),
        commentable:
          bound.members.length > 1 &&
          (await this.posts.isCommentable(bound.integration)),
        next: await this.scheduling.next(this.context(), descriptor),
        derived: await this.scheduling.derivedPlan(
          descriptor.organizationId,
          descriptor.occurrenceId
        ),
      };
    });
  }

  @ActivityMethod()
  recoveryDerivedDeliver(
    organizationId: string,
    rootOccurrenceId: string,
    actionId: string,
    index: number
  ) {
    return this.guarded(async () => {
      if (!this.derived) throw new RecoveryHold('DERIVED_SERVICE_UNAVAILABLE');
      try {
        return await this.derived.executeScheduled(
          this.context(),
          organizationId,
          rootOccurrenceId,
          actionId,
          index
        );
      } catch (error) {
        // Admission holds are visible in the action ledger and produce no HTTP.
        if (error instanceof RecoveryHold)
          return { kind: 'HELD' as const, reason: error.reason };
        throw error;
      }
    });
  }

  @ActivityMethod()
  recoveryPublicationCompletion(
    descriptor: ScheduleDescriptor,
    phase: 'root' | 'thread' | 'failure'
  ) {
    return this.guarded(async () => {
      if (!this.completion)
        throw new RecoveryHold('COMPLETION_SERVICE_UNAVAILABLE');
      if (phase === 'failure')
        await this.recovery.recordWorkflowFailure(
          this.context(),
          await this.scheduling.rootPostId(descriptor)
        );
      return this.completion.run(this.context(), descriptor, phase);
    });
  }

  @ActivityMethod()
  recoveryPublicationThreadFailure(
    descriptor: ScheduleDescriptor,
    memberId: string
  ) {
    return this.guarded(async () => {
      if (!this.completion)
        throw new RecoveryHold('COMPLETION_SERVICE_UNAVAILABLE');
      await this.recovery.recordWorkflowFailure(this.context(), memberId);
      return this.completion.threadFailure(
        this.context(),
        descriptor,
        memberId
      );
    });
  }

  @ActivityMethod()
  recoveryPublicationDeliver(
    descriptor: ScheduleDescriptor,
    postId: string,
    parentRemoteId?: string,
    lastRemoteId?: string,
    completionHandled = false
  ) {
    return this.guarded(async () => {
      const bound = await this.scheduling.bind(
        this.context(),
        descriptor,
        postId,
        parentRemoteId
      );
      const rows = parentRemoteId
        ? await this.posts.postComment(
            parentRemoteId,
            lastRemoteId,
            bound.integration,
            [bound.post]
          )
        : await this.posts.postSocial(
            bound.integration,
            [bound.post],
            completionHandled
          );
      for (const row of rows)
        await this.recovery.projectPublication(
          bound.input,
          row.postId,
          row.releaseURL
        );
      return rows;
    });
  }
}
