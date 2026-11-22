export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env.TEMPORAL_API_KEY || undefined;
  const tls = readBoolean(env.TEMPORAL_TLS, 'TEMPORAL_TLS', Boolean(apiKey));
  if (apiKey && !tls) throw new Error('TEMPORAL_API_KEY requires TEMPORAL_TLS');

  return {
    port: readPort(env),
    corsOrigins: readCorsOrigins(env.CORS_ORIGINS),
    redisUrl: validatedUrl(env.REDIS_URL ?? 'redis://127.0.0.1:6379', 'REDIS_URL', ['redis:', 'rediss:']).href,
    snapshotTtlSeconds: wholeNumber(env.SNAPSHOT_TTL_SECONDS, 'SNAPSHOT_TTL_SECONDS', 300, 86_400),
    temporal: { address: env.TEMPORAL_ADDRESS || '127.0.0.1:7233', tls, apiKey },
    namespace: env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: env.TEMPORAL_TASK_QUEUE || 'hotel-offers',
  };
}

function readCorsOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(',').map((entry) => {
    const origin = entry.trim();
    const url = URL.parse(origin);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('CORS_ORIGINS must contain comma-separated HTTP(S) origins without paths or credentials');
    }
    return origin;
  });
}

export function readPort(env: NodeJS.ProcessEnv = process.env): number {
  return wholeNumber(env.PORT, 'PORT', 3000, 65_535);
}

function wholeNumber(value: string | undefined, key: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (/^\d+$/.test(value) && Number.isSafeInteger(number) && number >= 1 && number <= max) return number;
  throw new Error(key + ' must be an integer from 1 to ' + max);
}

export function readBoolean(value: string | undefined, key: string, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (value === 'true' || value === 'false') return value === 'true';
  throw new Error(key + ' must be true or false');
}

function validatedUrl(value: string, key: string, protocols: string[]): URL {
  const url = URL.parse(value);
  if (!url || !url.hostname || !protocols.includes(url.protocol)) throw new Error(key + ' has an invalid URL');
  return url;
}
