import { readFileSync } from 'node:fs';

// Client authentication is independent of worker admission. A valid certificate
// never overrides the still closed H-I guard.
export function temporalClientTls(env: NodeJS.ProcessEnv = process.env) {
  const keys = [
    'TEMPORAL_CLIENT_CERT_PATH',
    'TEMPORAL_CLIENT_KEY_PATH',
    'TEMPORAL_SERVER_CA_PATH',
    'TEMPORAL_TLS_SERVER_NAME',
  ];
  if (!keys.some((k) => env[k]))
    return env.TEMPORAL_TLS === 'true' ? { tls: true } : {};
  if (!keys.every((k) => env[k]))
    throw new Error('Incomplete Temporal mutual TLS configuration');
  return {
    tls: {
      serverNameOverride: env.TEMPORAL_TLS_SERVER_NAME,
      serverRootCACertificate: readFileSync(env.TEMPORAL_SERVER_CA_PATH!),
      clientCertPair: {
        crt: readFileSync(env.TEMPORAL_CLIENT_CERT_PATH!),
        key: readFileSync(env.TEMPORAL_CLIENT_KEY_PATH!),
      },
    },
  };
}
