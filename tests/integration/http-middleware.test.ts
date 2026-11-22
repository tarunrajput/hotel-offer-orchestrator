import { equal, ok } from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import pino from 'pino';
import { createApp } from '../../src/app';

test('API applies security headers and the configured browser access policy', async (t) => {
  let searches = 0;
  const allowedOrigin = 'https://app.example.com';
  const app = createApp({
    corsOrigins: [allowedOrigin],
    async search(query) {
      searches++;
      if (query.city === 'fail') throw new Error('Search failed');
      return { completeness: 'partial', failedSupplier: 'supplier-a', offers: [] };
    },
    probeSupplier: async () => {},
    logger: pino({ level: 'silent' }),
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  await once(server, 'listening');
  const address = server.address();
  ok(address && typeof address !== 'string');
  const baseUrl = 'http://127.0.0.1:' + address.port;
  const request = (path: string, init?: RequestInit) =>
    fetch(baseUrl + path, { ...init, signal: AbortSignal.timeout(3000) });

  await t.test('security and CORS headers cover successful, invalid, and missing endpoints', async () => {
    for (const [path, status] of [
      ['/api/hotels?city=delhi', 200],
      ['/api/hotels', 400],
      ['/api/hotels?city=fail', 500],
      ['/missing', 404],
      ['/livez', 200],
    ] as const) {
      const response = await request(path, { headers: { Origin: allowedOrigin } });
      equal(response.status, status);
      equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
      equal(response.headers.get('X-Frame-Options'), 'SAMEORIGIN');
      equal(response.headers.get('X-Powered-By'), null);
      equal(response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
      equal(response.headers.get('Access-Control-Allow-Credentials'), null);
      ok(response.headers.get('Vary')?.includes('Origin'));
      const exposed = response.headers.get('Access-Control-Expose-Headers')?.toLowerCase();
      for (const header of ['request-id', 'hotel-offer-completeness', 'hotel-offer-failed-supplier']) {
        ok(exposed?.includes(header));
      }
      ok(response.headers.get('Request-Id'));
      await response.arrayBuffer();
    }
  });

  await t.test('preflight allows read methods without starting a search', async () => {
    const before = searches;
    const response = await request('/api/hotels?city=delhi', {
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'GET' },
    });
    equal(response.status, 204);
    equal(response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
    equal(response.headers.get('Access-Control-Allow-Methods'), 'GET,HEAD');
    equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    ok(response.headers.get('Request-Id'));
    equal(searches, before);
  });

  await t.test('unlisted origins receive no browser access grant while non-browser requests still work', async () => {
    for (const origin of ['https://other.example.com', undefined]) {
      const response = await request('/api/hotels?city=delhi', {
        headers: origin ? { Origin: origin } : undefined,
      });
      equal(response.status, 200);
      equal(response.headers.get('Access-Control-Allow-Origin'), null);
      await response.arrayBuffer();
    }
  });

  await t.test('omitting the allowlist grants no cross-origin browser access', async () => {
    const closedApp = createApp({
      search: async () => ({ completeness: 'complete', offers: [] }),
      probeSupplier: async () => {},
      logger: pino({ level: 'silent' }),
    });
    const closedServer = closedApp.listen(0, '127.0.0.1');
    t.after(
      () => new Promise<void>((resolve, reject) => closedServer.close((error) => (error ? reject(error) : resolve()))),
    );
    await once(closedServer, 'listening');
    const closedAddress = closedServer.address();
    ok(closedAddress && typeof closedAddress !== 'string');
    const response = await fetch('http://127.0.0.1:' + closedAddress.port + '/livez', {
      headers: { Origin: allowedOrigin },
      signal: AbortSignal.timeout(3000),
    });
    equal(response.status, 200);
    equal(response.headers.get('Access-Control-Allow-Origin'), null);
    await response.arrayBuffer();
  });
});
