// H/I are intentionally unavailable in this development stage. Keep this guard
// in worker registration as well as the shell preflight: a direct Node launch
// must not create pollers while backlog recovery is still unauthorized.
import { admittedContract } from './recovery-approval';
import { RecoveryHold } from './recovery-policy';
import { readRecoveryDatabase, readRecoveryTemporal } from './recovery-inventory-source';
import { inventoryHash } from './recovery-inventory';
import { Connection, Client } from '@temporalio/client';
import { temporalClientTls } from '../temporal/temporal-tls';

let prepared:
  | {
      prisma: any;
      authorizationId: string;
      sourceDigest: string;
      imageDigest: string;
      queues: string[];
      workflowBundlePath?: string;
    }
  | undefined;
let pollingStarted = false;

/** Called after all native workers exist, immediately before the first run(). */
export async function beginWorkerConsumption() {
  assertWorkerConsumptionPrepared();
  const control = await prepared!.prisma.automationRecoveryControl.findUnique({
    where: { id: 'global' },
  });
  if (control?.phase !== 'OPEN') throw new RecoveryHold('RECOVERY_CLOSED');
  const { a, m, p } = await admittedContract(prepared!.prisma, control);
  if (
    a.id !== prepared!.authorizationId ||
    Date.now() > Date.parse(p.resumeNotAfter)
  )
    throw new RecoveryHold('NEW_RECOVERY_HANDOFF_REQUIRED');
  const tables = await readRecoveryDatabase(
    prepared!.prisma,
    m.scope as string[]
  );
  const fingerprint = inventoryHash(
    Object.fromEntries(
      Object.entries(tables).filter(([key]) => key !== 'recoveryControl')
    )
  );
  if (fingerprint !== a.expectedDbHash)
    throw new RecoveryHold('WORKER_START_SOURCE_CHANGED');
  const connection=await Connection.connect({address:p.temporalAddress,...temporalClientTls()});
  try {
    const client=new Client({connection,namespace:p.namespace});
    const metadata=await readRecoveryTemporal(client,m.scope as string[],tables.automationWorkflowBinding,p.queues);
    if(inventoryHash(metadata)!==(a.admitted as any).temporalHash)throw new RecoveryHold('WORKER_START_TEMPORAL_CHANGED');
  }finally{await connection.close();}
  if (Date.now() > Date.parse(p.resumeNotAfter))
    throw new RecoveryHold('NEW_RECOVERY_HANDOFF_REQUIRED');
  pollingStarted = true;
}

/** Only the isolated candidate entrypoint calls this after artifact verification. */
export async function prepareWorkerConsumption(
  prisma: any,
  actual: {
    sourceDigest: string;
    imageDigest: string;
    queues: string[];
    workflowBundlePath?: string;
  }
) {
  pollingStarted = false;
  const control = await prisma.automationRecoveryControl.findUnique({
    where: { id: 'global' },
  });
  if (control?.phase !== 'OPEN') throw new RecoveryHold('RECOVERY_CLOSED');
  const { a, p } = await admittedContract(prisma, control),
    ticket = a.admitted;
  if (Date.now() > Date.parse(ticket.resumeNotAfter))
    throw new RecoveryHold('NEW_RECOVERY_HANDOFF_REQUIRED');
  if (p.scope !== 'ISOLATED_LAB' || ticket.scope !== p.scope)
    throw new RecoveryHold('PRODUCTION_ACTIVATION_NOT_RELEASED');
  const db = await prisma.$queryRaw`SELECT current_database() AS name`;
  const marker = await prisma.automationRecoveryDecision.findFirst({
    where: {
      subjectKey: `environment:${p.containment.environmentId}`,
      action: 'ISOLATED_LAB',
    },
  });
  if (
    db[0]?.name !== 'guard_test' ||
    !marker ||
    p.containment.kind !== 'OWNED_ISOLATED_LAB' ||
    p.sourceDigest !== actual.sourceDigest ||
    p.imageDigest !== actual.imageDigest ||
    p.temporalAddress !== process.env.TEMPORAL_ADDRESS ||
    p.namespace !== (process.env.TEMPORAL_NAMESPACE || 'default') ||
    JSON.stringify([...p.queues].sort()) !==
      JSON.stringify([...actual.queues].sort())
  )
    throw new RecoveryHold('WORKER_RUNTIME_BINDING_CHANGED');
  prepared = { prisma, authorizationId: a.id, ...actual };
  return { protocol: 2, scope: p.scope, queues: actual.queues };
}

export async function checkWorkerConsumption(workflow?: {
  workflowId: string;
  runId: string;
}) {
  assertWorkerConsumptionPrepared();
  if (!pollingStarted) throw new RecoveryHold('WORKER_CONSUMPTION_NOT_STARTED');
  const control = await prepared!.prisma.automationRecoveryControl.findUnique({
    where: { id: 'global' },
  });
  if (control?.phase !== 'OPEN') throw new RecoveryHold('RECOVERY_CLOSED');
  const { a, m, p } = await admittedContract(prepared!.prisma, control);
  if (
    a.id !== prepared!.authorizationId ||
    p.sourceDigest !== prepared!.sourceDigest ||
    p.imageDigest !== prepared!.imageDigest
  )
    throw new RecoveryHold('WORKER_ADMISSION_CHANGED');
  if (workflow) {
    const item = m.items.find(
      (i: any) =>
        i.subjectKey === `workflow:${workflow.workflowId}:${workflow.runId}`
    );
    if (item) {
      const applied = await prepared!.prisma.recoveryApplicationItem.findUnique(
        {
          where: {
            authorizationId_ordinal: {
              authorizationId: a.id,
              ordinal: item.ordinal,
            },
          },
        }
      );
      if (applied?.result?.outcome === 'RETAINED')
        throw new RecoveryHold('WORKFLOW_RETAINED_BY_MANIFEST');
    }
  }
  return { cutoffAt: p.cutoffAt };
}

export function assertWorkerConsumptionPrepared(): void {
  if (prepared) return;
  throw new Error(
    'RECOVERY_WORKER_ACTIVATION_UNAVAILABLE: workers require classified/reconciled backlog and a separately authorized H-I implementation.'
  );
}

export function workerRuntime() {
  assertWorkerConsumptionPrepared();
  return { ...prepared!, queues: [...prepared!.queues] };
}
