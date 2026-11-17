// Deliberately closed during staged development. No .env, DB writes, migrations,
// PM2 commands, imports of the application, or environment bypass switches.
const fs = require('node:fs');
const path = require('node:path');

function assertRecoveryRelease() {
  const release = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../recovery-release.json'), 'utf8'));
  if (!release.migrationChainVerified || !release.deliveryGuardsVerified || !release.recoveryScenariosVerified) {
    throw new Error('RECOVERY_IMPLEMENTATION_INCOMPLETE: automatic worker startup is blocked; complete and verify phases B-G first.');
  }
  // Phase I intentionally has no activation path in this stage. A verified
  // implementation will still require persistent policy/readiness checks.
  throw new Error('RECOVERY_ACTIVATION_UNAVAILABLE: phases H-I have not been implemented or authorized.');
}

module.exports = { assertRecoveryRelease };
if (require.main === module) {
  try { assertRecoveryRelease(); }
  catch (error) { console.error(error.message); process.exitCode = 78; }
}
