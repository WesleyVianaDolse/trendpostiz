import { AsyncLocalStorage } from 'node:async_hooks';

export type DerivedReceipt = {
  proof:
    | 'THREADS_PUBLISH_ID'
    | 'LINKEDIN_POST_ID'
    | 'LINKEDIN_COMMENT_ID'
    | 'ATPROTO_RECORD'
    | 'X_POST_ID'
    | 'X_RETWEET_ACK';
  remoteId: string;
  actorId?: string;
  cid?: string;
};
export type DerivedOutcome =
  | {
      kind: 'NOT_EXECUTED';
      evidence: {
        reason: 'CONDITION_NOT_MET';
        observed: number;
        threshold: number;
      };
    }
  | { kind: 'CONFIRMED'; receipt: DerivedReceipt }
  | { kind: 'UNCERTAIN'; reason: string };

type Capture = {
  mutations: number;
  outcome?: DerivedOutcome;
  beforeMutation: () => Promise<void>;
  checkpoint: (receipt: DerivedReceipt) => Promise<void>;
};
const capture = new AsyncLocalStorage<Capture>();

export function isDerivedEffectCaptureActive() {
  return !!capture.getStore();
}

// Atproto's credential session can transparently refresh/retry a mutation after
// an ExpiredToken response. Under a durable claim, return no ambiguous response
// to that retry path. Outside capture the SDK keeps its existing transport.
export const derivedSdkFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const method = (
    init?.method || (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    isDerivedEffectCaptureActive() &&
    method === 'POST' &&
    url.pathname === '/xrpc/com.atproto.repo.createRecord' &&
    !response.ok
  ) {
    throw new Error('DERIVED_REMOTE_OUTCOME_UNCONFIRMED');
  }
  return response;
};

// No change to public provider return types. Only audited mutation call sites
// emit evidence; true/false/void are deliberately ignored by this adapter.
export async function captureDerivedEffect(
  run: () => Promise<unknown>,
  hooks: Pick<Capture, 'beforeMutation' | 'checkpoint'>
): Promise<DerivedOutcome> {
  const state: Capture = { mutations: 0, ...hooks };
  return capture.run(state, async () => {
    try {
      await run();
    } catch {
      /* transport/error bodies must not enter ledger */
    }
    return (
      state.outcome || {
        kind: 'UNCERTAIN',
        reason: 'REMOTE_OUTCOME_UNCONFIRMED',
      }
    );
  });
}

export async function derivedMutation<T>(
  request: () => Promise<T>
): Promise<T> {
  const state = capture.getStore();
  if (state) {
    if (state.outcome) throw new Error('DERIVED_OUTCOME_ALREADY_RECORDED');
    await state.beforeMutation();
    state.mutations++;
  }
  return request();
}

export function derivedConditionNotMet(observed: unknown, threshold: unknown) {
  const state = capture.getStore();
  if (!state) return;
  if (
    state.mutations ||
    !Number.isFinite(observed) ||
    !Number.isFinite(threshold) ||
    Number(observed) < 0 ||
    Number(threshold) < 0 ||
    Number(observed) >= Number(threshold)
  )
    throw new Error('DERIVED_NO_EFFECT_UNPROVEN');
  state.outcome = {
    kind: 'NOT_EXECUTED',
    evidence: {
      reason: 'CONDITION_NOT_MET',
      observed: Number(observed),
      threshold: Number(threshold),
    },
  };
}

export async function derivedConfirmed(receipt: DerivedReceipt) {
  const state = capture.getStore();
  if (!state) return;
  if (
    !state.mutations ||
    !receipt.remoteId ||
    typeof receipt.remoteId !== 'string' ||
    receipt.remoteId.length > 2048 ||
    (receipt.actorId && receipt.actorId.length > 2048) ||
    (receipt.cid && receipt.cid.length > 2048) ||
    (receipt.proof === 'ATPROTO_RECORD' &&
      (!receipt.cid || !receipt.remoteId.startsWith('at://'))) ||
    (receipt.proof === 'X_RETWEET_ACK' && !receipt.actorId)
  )
    throw new Error('DERIVED_RECEIPT_UNPROVEN');
  // Persist positive proof immediately after acknowledgement. A crash before
  // this checkpoint keeps the existing claim unconfirmed, never retryable.
  await state.checkpoint(receipt);
  state.outcome = { kind: 'CONFIRMED', receipt };
}

export async function derivedLinkedInResponse(
  response: Response,
  proof: 'LINKEDIN_POST_ID' | 'LINKEDIN_COMMENT_ID'
) {
  if (!capture.getStore() || !response || ![200, 201].includes(response.status))
    return;
  let remoteId = response.headers.get('x-restli-id');
  if (!remoteId && proof === 'LINKEDIN_COMMENT_ID') {
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    remoteId = typeof body?.id === 'string' ? body.id : null;
  }
  // `object` in the comment response identifies the parent, not the new comment.
  if (remoteId) await derivedConfirmed({ proof, remoteId });
}
