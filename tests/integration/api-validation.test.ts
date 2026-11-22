import { deepStrictEqual, equal, ok } from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import pino from 'pino';
import { createApp } from '../../src/app';
import type { HotelQuery } from '../../src/modules/hotel-search/hotel-search.service';

test('API validates all search inputs before calling dependencies', async (t) => {
  const calls: HotelQuery[] = [];
  const app = createApp({
    async search(query) {
      calls.push(query);
      return { completeness: 'complete', offers: [] };
    },
    probeSupplier: async () => {},
    logger: pino({ level: 'silent' }),
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  await once(server, 'listening');
  const address = server.address();
  ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  const get = (query: string) => fetch(origin + '/api/hotels?' + query, { signal: AbortSignal.timeout(3000) });

  await t.test('returns consistent 400 errors without starting a search', async () => {
    for (const query of [
      '',
      'city=',
      'city=%20',
      'city=new%20delhi',
      'city=' + 'a'.repeat(65),
      'city=delhi&city=mumbai',
      'city[]=delhi',
      'city=delhi&minPrice[]=1',
      'city=delhi&minPrice[x]=1',
      'city=delhi&minPrice=1&minPrice=2',
      'city=delhi&maxPrice=1&maxPrice=2',
      'city=delhi&minPrice=-1',
      'city=delhi&maxPrice=1.5',
      'city=delhi&maxPrice=1e3',
      'city=delhi&minPrice=9007199254740992',
      'city=delhi&minPrice=1%0A',
      'city=delhi&minPrice=6000&maxPrice=5000',
      'city=delhi&minprice=5000',
      'city=delhi&supplier=a',
      'city=delhi&__proto__=1',
      'city=delhi' + '&'.repeat(1100) + 'minPrice=-1',
      'city=delhi' + '&'.repeat(1100) + 'city=mumbai',
      'city=delhi' + '&'.repeat(1100) + 'unknown=1',
    ]) {
      const response = await get(query);
      equal(response.status, 400, query);
      ok(response.headers.get('Content-Type')?.startsWith('application/problem+json'));
      equal(response.headers.get('Cache-Control'), 'no-store');
      const problem = await response.json();
      equal(problem.type, 'urn:hotel-offer-orchestrator:problem:invalid-query');
      equal(problem.status, 400);
      equal(problem.requestId, response.headers.get('Request-Id'));
      ok(problem.requestId);
      ok(problem.detail);
      equal(calls.length, 0);
    }
  });

  await t.test('accepts normalized cities, zero and equal bounds, and optional bounds', async () => {
    for (const [query, expected] of [
      ['city=%20DELHI%20&minPrice=0&maxPrice=0', { city: 'delhi', minPrice: 0, maxPrice: 0 }],
      ['city=new-delhi&minPrice=5000', { city: 'new-delhi', minPrice: 5000, maxPrice: undefined }],
      [
        'city=delhi&maxPrice=9007199254740991',
        { city: 'delhi', minPrice: undefined, maxPrice: Number.MAX_SAFE_INTEGER },
      ],
    ] as const) {
      const response = await get(query);
      equal(response.status, 200);
      deepStrictEqual(await response.json(), []);
      deepStrictEqual(calls.at(-1), expected);
    }
  });
});
