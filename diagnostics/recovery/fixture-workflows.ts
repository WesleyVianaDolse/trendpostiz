export { postWorkflowV101 } from '../../apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.1';
export { postWorkflowV102 } from '../../apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.2';
export { postWorkflowV103 } from '../../apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.3';
export { postWorkflowV104 } from '../../apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.4';
export { postWorkflowV105 } from '../../apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.5';
export { postWorkflowV106 } from '../../apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.6';
export { instagramCommentAutomationWorkflow } from '../../apps/orchestrator/src/workflows/instagram-comment-automation.workflow';
export { derivedPublicationWorkflow } from '../../apps/orchestrator/src/workflows/derived-publication.workflow';
export { missingPostWorkflow } from '../../apps/orchestrator/src/workflows/missing.post.workflow';
export { autoPostWorkflow } from '../../apps/orchestrator/src/workflows/autopost.workflow';
export { streakWorkflow } from '../../apps/orchestrator/src/workflows/streak.workflow';
import { proxyActivities, startChild } from '@temporalio/workflow';
export async function recoveryFixtureWorkflow(id: string) {
  return proxyActivities<{ fixtureAction(id: string): Promise<unknown> }>({ startToCloseTimeout: '2 minutes', retry: { maximumAttempts: 1 } }).fixtureAction(id);
}
export async function recoveryAbandonFixture(input: {postId:string;organizationId:string;childWorkflowId:string;version?:number;childTaskQueue?:string}) {
  const child=await startChild(`postWorkflowV${input.version||105}`,{workflowId:input.childWorkflowId,taskQueue:input.childTaskQueue||'fg-abandon-paused',parentClosePolicy:'ABANDON',
    args:[{postId:input.postId,organizationId:input.organizationId,taskQueue:'linkedin',postNow:true}]});
  return child.firstExecutionRunId;
}
export async function recoveryDeliveryProbe(input: {descriptor: any;queue:string}) {
  const plan=await proxyActivities<any>({taskQueue:'main',startToCloseTimeout:'10 seconds'}).recoveryPublicationPlan(input.descriptor);
  return proxyActivities<any>({taskQueue:input.queue,startToCloseTimeout:'3 seconds',retry:{maximumAttempts:3,initialInterval:'200 milliseconds'}})
    .recoveryPublicationDeliver(input.descriptor,plan.members[0].id,undefined,undefined,true);
}
