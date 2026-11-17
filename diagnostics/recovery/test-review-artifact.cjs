// Local metadata only. No application, network, process restart or activation.
const assert = require('node:assert/strict');
const { createReviewArtifact, verifyReviewArtifact } = require('../../scripts/recovery/review-artifact.cjs');
const artifact = createReviewArtifact();
assert.equal(verifyReviewArtifact(artifact).activationAuthorized, false);
assert(artifact.files.some((file) => file.file === 'version.txt'));
const alterations = [
  { protocolVersion: 0 },
  { sourceVersion: 'unreviewed' },
  { targetVersion: 'unreviewed' },
  { sourceDigest: 'stale' },
  { activationAuthorized: true },
  { oldConsumersContained: true },
  { imageDigest: 'unverified' },
];
for (const alteration of alterations) {
  assert.throws(() => verifyReviewArtifact({ ...artifact, ...alteration }));
}
console.log(JSON.stringify({ acceptedLocalMetadata: true, rejectedAlterations: alterations.length, activationAuthorized: false }));
