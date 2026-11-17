import { createHash } from 'node:crypto';

export const RECOVERY_PROTOCOL = 1;
export const RECOVERY_EXPIRED_MESSAGE =
  'Publicação automática não realizada na retomada: o horário agendado já havia passado. Verifique se o conteúdo foi publicado manualmente.';

export class RecoveryHold extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'RecoveryHold';
  }
}

export function recoveryKey(...parts: (string | number)[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function nextFixedOccurrence(
  anchor: Date,
  intervalInDays: number,
  cutoff: Date
) {
  const step = intervalInDays * 86_400_000;
  if (
    !Number.isSafeInteger(step) ||
    step <= 0 ||
    !Number.isFinite(+anchor) ||
    !Number.isFinite(+cutoff)
  ) {
    throw new RecoveryHold('RECURRENCE_ANCHOR_UNRESOLVED');
  }
  const next =
    +anchor + Math.max(0, Math.ceil((+cutoff - +anchor) / step)) * step;
  if (!Number.isSafeInteger(next) || !Number.isFinite(+new Date(next)))
    throw new RecoveryHold('RECURRENCE_ANCHOR_UNRESOLVED');
  return new Date(next);
}

export interface RecoveryWorkflowContext {
  workflowId: string;
  runId: string;
  protocolVersion: number;
}

export interface RecoveryPostSnapshot {
  id: string;
  group: string;
  publishDate: Date;
  scheduleRevision?: number;
}

export interface PublicationEffectContext extends RecoveryWorkflowContext {
  organizationId: string;
  integrationId: string;
  snapshots: RecoveryPostSnapshot[];
  actionKey: string;
  parentRemoteId?: string;
  derived?: boolean;
  targetIntegrationId?: string;
  dependencyHash?: string;
  plannedAt?: Date;
}

export function publicationRequestHash(input: PublicationEffectContext) {
  return recoveryKey(
    'post-effect-v1',
    input.organizationId,
    input.integrationId,
    input.actionKey,
    JSON.stringify(
      input.snapshots.map((s) => [
        s.id,
        s.group,
        new Date(s.publishDate).toISOString(),
        s.scheduleRevision ?? null,
      ])
    ),
    input.derived ? 'derived' : 'publication',
    input.targetIntegrationId || '',
    input.parentRemoteId || '',
    input.dependencyHash || '',
    input.plannedAt
      ? new Date(input.plannedAt).toISOString()
      : 'binding-time-required'
  );
}
