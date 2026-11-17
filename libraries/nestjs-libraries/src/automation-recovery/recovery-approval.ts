import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inventoryHash } from './recovery-inventory';
import { RecoveryHold } from './recovery-policy';

export const ADMISSION_PROTOCOL = 2;
export const authorityKey = () => {
  const file = process.env.RECOVERY_APPROVAL_PUBLIC_KEY_FILE;
  if (!file) throw new RecoveryHold('APPROVAL_AUTHORITY_UNCONFIGURED');
  const key = createPublicKey(readFileSync(file));
  if (key.asymmetricKeyType !== 'ed25519')
    throw new RecoveryHold('APPROVAL_KEY_TYPE');
  return key;
};
export const authorityHash = () =>
  createHash('sha256')
    .update(authorityKey().export({ format: 'der', type: 'spki' }))
    .digest('hex');
export function verifyApproval(
  payload: any,
  signature: string,
  purpose: string
) {
  if (
    payload?.purpose !== purpose ||
    payload.contractProtocol !== ADMISSION_PROTOCOL ||
    !signature ||
    !verify(
      null,
      Buffer.from(inventoryHash(payload)),
      authorityKey(),
      Buffer.from(signature, 'base64')
    )
  )
    throw new RecoveryHold('SIGNED_APPROVAL_REQUIRED');
  if (
    !Number.isFinite(Date.parse(payload.validUntil)) ||
    Date.parse(payload.validUntil) <= Date.now()
  )
    throw new RecoveryHold('APPROVAL_EXPIRED');
}
export const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function manifestContent(m: any) {
  const items = m.items.map((r: any, i: number) => {
    const item = {
      subjectKey: r.subjectKey,
      organizationId: r.organizationId || undefined,
      postId: r.postId || undefined,
      decision: r.decision,
      reason: r.reason,
      metadata: r.metadata,
    };
    if (r.ordinal !== i || inventoryHash(item) !== r.fingerprint)
      throw new RecoveryHold('MANIFEST_ITEM_CHANGED');
    return item;
  });
  if (
    m.itemCount !== items.length ||
    m.cursor !== items.length ||
    !['REVALIDATED'].includes(m.phase) ||
    m.manifestHash !==
      inventoryHash({
        id: m.id,
        cutoffAt: m.cutoffAt,
        scope: m.scope,
        sourceHash: m.sourceHash,
        items,
      })
  )
    throw new RecoveryHold('MANIFEST_NOT_REVALIDATED');
  return items;
}

/** Flags cannot replace either the approval signature or the applied audit chain. */
export async function approvedContract(
  tx: any,
  authorizationId: string,
  applied = false
) {
  const a = await tx.recoveryAuthorization.findUnique({
    where: { id: authorizationId },
  });
  if (!a || a.phase === 'REVOKED')
    throw new RecoveryHold('AUTHORIZATION_UNAVAILABLE');
  const p = a.approval;
  verifyApproval(p, a.approvalSignature, 'RECOVERY_APPROVAL');
  const m = await tx.recoveryManifest.findUnique({
    where: { id: a.manifestId },
    include: { items: { orderBy: { ordinal: 'asc' } } },
  });
  if (!m) throw new RecoveryHold('MANIFEST_MISSING');
  manifestContent(m);
  const operator = await tx.user.findUnique({ where: { id: a.approvedById } });
  const run = await tx.automationRecoveryRun.findUnique({
    where: { id: m.recoveryId },
  });
  if (
    !operator?.activated ||
    operator.disabledAt ||
    !operator.isSuperAdmin ||
    !run ||
    +run.cutoffAt !== +m.cutoffAt ||
    run.protocolVersion !== 1 ||
    p.recoveryProtocol !== 1 ||
    p.workerProtocol !== 2 ||
    !Number.isFinite(Date.parse(p.resumeNotAfter)) ||
    Date.parse(p.resumeNotAfter) < +m.cutoffAt ||
    Date.parse(p.resumeNotAfter) > +m.cutoffAt + 30000 ||
    !p.temporalAddress ||
    !p.namespace ||
    !Array.isArray(p.queues) ||
    new Set(p.queues).size !== p.queues.length ||
    !['main', 'instagram', 'facebook'].every((q) => p.queues.includes(q)) ||
    !['ISOLATED_LAB', 'PRODUCTION'].includes(p.scope) ||
    p.containment?.kind !==
      (p.scope === 'ISOLATED_LAB'
        ? 'OWNED_ISOLATED_LAB'
        : 'REVIEWED_PRODUCTION_BOUNDARY') ||
    !p.containment.environmentId ||
    !/^[a-f0-9]{64}$/.test(p.containment.evidenceDigest) ||
    a.authorityHash !== authorityHash() ||
    p.authorizationId !== a.id ||
    p.manifestId !== m.id ||
    p.manifestHash !== m.manifestHash ||
    p.inventoryHash !== m.sourceHash ||
    p.inventoryVersion !== m.version ||
    p.cutoffAt !== m.cutoffAt.toISOString() ||
    p.generation !== a.generation ||
    p.planHash !== inventoryHash(a.plan) ||
    p.inventoryHash !== inventoryHash(a.source) ||
    !/^[a-f0-9]{64}$/.test(p.sourceDigest) ||
    !/^[a-f0-9]{64}$/.test(p.applicationDigest) ||
    !/^sha256:[a-f0-9]{64}$/.test(p.imageDigest) ||
    !/^[a-f0-9]{64}$/.test(p.containmentHash) ||
    p.containmentHash !== inventoryHash(p.containment) ||
    p.approvedById !== a.approvedById ||
    p.recoveryId !== m.recoveryId
  )
    throw new RecoveryHold('APPROVAL_BINDING_CHANGED');
  const rows = await tx.recoveryApplicationItem.findMany({
    where: { authorizationId: a.id },
    orderBy: { ordinal: 'asc' },
  });
  let chain = inventoryHash({ approval: p, signature: a.approvalSignature });
  for (const [i, r] of rows.entries()) {
    if (
      r.ordinal !== i ||
      r.fingerprint !== m.items[i]?.fingerprint ||
      r.previousHash !== chain ||
      r.resultHash !==
        inventoryHash({
          previous: chain,
          ordinal: i,
          fingerprint: r.fingerprint,
          result: r.result,
        })
    )
      throw new RecoveryHold('APPLICATION_AUDIT_CHANGED');
    chain = r.resultHash;
  }
  if (
    a.cursor !== rows.length ||
    chain !== a.resultHash ||
    (applied &&
      (a.cursor !== m.itemCount || !['APPLIED', 'ADMITTED'].includes(a.phase)))
  )
    throw new RecoveryHold('APPLICATION_INCOMPLETE');
  return { a, m, p };
}

export async function admittedContract(tx: any, control: any) {
  const latest = await tx.recoveryAuthorization.aggregate({
    _max: { generation: true },
  });
  if (latest._max.generation !== control.generation)
    throw new RecoveryHold('RECOVERY_GENERATION_ROLLBACK');
  // No relation/prefix lookup: bind through the exact run's manifest hash.
  const run =
    control.runId &&
    (await tx.automationRecoveryRun.findUnique({
      where: { id: control.runId },
    }));
  const candidate =
    run &&
    (await tx.recoveryManifest.findFirst({
      where: { recoveryId: run.id, manifestHash: run.manifestHash },
    }));
  const contract =
    candidate &&
    (await tx.recoveryAuthorization.findUnique({
      where: { manifestId: candidate.id },
    }));
  if (!contract) throw new RecoveryHold('SIGNED_ADMISSION_REQUIRED');
  const result = await approvedContract(tx, contract.id, true),
    admission = result.a.admitted;
  verifyApproval(admission, result.a.admittedSignature, 'WORKER_ADMISSION');
  if (result.p.scope !== 'ISOLATED_LAB' || admission.scope !== result.p.scope)
    throw new RecoveryHold('PRODUCTION_ACTIVATION_NOT_RELEASED');
  if (
    result.a.phase !== 'ADMITTED' ||
    admission.authorizationId !== result.a.id ||
    admission.applicationHash !== result.a.resultHash ||
    admission.approvalHash !== inventoryHash(result.p) ||
    admission.expectedDbHash !== result.a.expectedDbHash ||
    admission.sourceDigest !== result.p.sourceDigest ||
    admission.imageDigest !== result.p.imageDigest ||
    admission.containmentHash !== result.p.containmentHash ||
    admission.generation !== control.generation ||
    admission.cutoffAt !== run.cutoffAt.toISOString() ||
    run.authorizedById !== result.a.approvedById ||
    admission.resumeNotAfter !== result.p.resumeNotAfter ||
    run.manifestHash !== result.m.manifestHash ||
    run.phase !== 'VERIFIED' ||
    !run.authorizedAt
  )
    throw new RecoveryHold('ADMISSION_BINDING_CHANGED');
  return result;
}
