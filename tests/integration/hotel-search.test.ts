import { deepStrictEqual, equal, ok, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { Context } from '@temporalio/activity';
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import { DefaultLogger, NativeConnection, Runtime, Worker } from '@temporalio/worker';
import express, { type Express } from 'express';
import pino from 'pino';
import { createApp } from '../../src/app';
import { createMockSuppliersApp } from '../../src/mock-suppliers/app';
import { createSupplierClients } from '../../src/modules/suppliers/suppliers.factory';
import {
  RedisSnapshotRepository,
  snapshotKeyFor,
} from '../../src/modules/hotel-search/repositories/redis-snapshot.repository';
import { createComparisonActivities } from '../../src/modules/hotel-search/temporal/activities';
import { TemporalWorkflowRunner, workflowIdFor } from '../../src/modules/hotel-search/temporal/workflow-runner';
import { createHotelSearch } from '../../src/modules/hotel-search/hotel-search.service';
import { SupplierRequestFailure, type Supplier } from '../../src/modules/suppliers/supplier.types';
import { readConfig } from '../../src/config/config';
import { connectRedis, createRedisClient } from '../../src/common/redis/client';

const holtin = { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 };
const radison = { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 };
const fallbackHoltin = { name: 'Holtin', price: 6000, supplier: 'Supplier A', commissionPct: 10 };

test('hotel API over live HTTP, Temporal, and Redis', { timeout: 60_000 }, async (t) => {
  const config = readConfig();
  const taskQueue = 'hotel-offers-test-' + randomUUID();
  const redis = createRedisClient(config.redisUrl, (error) => t.diagnostic(String(error)));
  t.after(() => {
    if (redis.isOpen) redis.destroy();
  });
  await connectRedis(redis);
  const snapshots = new RedisSnapshotRepository(redis, 30);
  const connection = await Connection.connect({ ...config.temporal, connectTimeout: '3 seconds' });
  t.after(() => connection.close());
  const temporal = new Client({ connection, namespace: config.namespace });

  const mockOutages = { 'supplier-a': false, 'supplier-b': false };
  let hangSupplierA = false;
  const logger = pino({ level: 'silent' });
  const fixtures = express();
  fixtures.use((req, res, next) => {
    if (hangSupplierA && req.path === '/supplierA/hotels') {
      res.flushHeaders();
      return;
    }
    next();
  });
  fixtures.use(createMockSuppliersApp(mockOutages, logger));
  const [supplierAOrigin, supplierBOrigin] = await Promise.all([listen(t, fixtures), listen(t, fixtures)]);
  const supplierAPath = '/supplierA/hotels';
  const supplierBPath = '/supplierB/hotels';
  const supplierAUrl = new URL(supplierAPath, supplierAOrigin);
  const supplierBUrl = new URL(supplierBPath, supplierBOrigin);
  const suppliers = createSupplierClients({
    SUPPLIER_A_URL: supplierAUrl.href,
    SUPPLIER_B_URL: supplierBUrl.href,
  });
  const app = createApp({
    search: createHotelSearch(new TemporalWorkflowRunner(temporal, taskQueue), snapshots),
    probeSupplier: (supplier) => suppliers[supplier].probe(),
    logger,
  });
  const baseUrl = await listen(t, app);
  const get = (path: string) => fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(13_000) });

  await t.test('returns a search-timeout 504 within the HTTP budget when no worker polls the queue', async () => {
    const unavailableApp = createApp({
      search: createHotelSearch(new TemporalWorkflowRunner(temporal, 'no-worker-' + randomUUID()), snapshots),
      probeSupplier: async () => {},
      logger,
    });
    const origin = await listen(t, unavailableApp);
    const started = performance.now();
    const response = await fetch(new URL('/api/hotels?city=delhi', origin), {
      signal: AbortSignal.timeout(13_000),
    });
    equal(response.status, 504);
    equal((await response.json()).type, 'urn:hotel-offer-orchestrator:problem:search-timeout');
    ok(performance.now() - started < 13_000);
    const requestId = response.headers.get('Request-Id');
    ok(requestId);
    const history = await temporal.workflow.getHandle(workflowIdFor(requestId)).fetchHistory();
    ok(history.events?.some((event) => event.workflowExecutionTimedOutEventAttributes));
    equal(
      history.events?.some((event) => event.workflowTaskStartedEventAttributes),
      false,
    );
    equal(await redis.exists(snapshotKeyFor(workflowIdFor(requestId))), 0);
  });

  const calls: Supplier[] = [];
  let barrier: Promise<void> | undefined;
  let releaseBarrier: (() => void) | undefined;
  let failBOnce = false;
  let timeOutA = false;
  let isolateSupplierFailure = false;
  let partialWorkflowId: string | undefined;

  async function fetchOffers(supplier: Supplier, city: string, signal?: AbortSignal) {
    calls.push(supplier);
    if (barrier) {
      if (new Set(calls).size === 2) releaseBarrier?.();
      await barrier;
    }
    if (timeOutA && supplier === 'supplier-a') {
      throw new SupplierRequestFailure('timeout', true, 'Simulated supplier timeout');
    }
    if (failBOnce && supplier === 'supplier-b') {
      failBOnce = false;
      throw new SupplierRequestFailure('unavailable', true, 'Simulated transient error');
    }
    if (isolateSupplierFailure && supplier === 'supplier-b') {
      const workflow = Context.current().info.workflowExecution;
      ok(workflow);
      partialWorkflowId ??= workflow.workflowId;
      if (workflow.workflowId === partialWorkflowId) {
        throw new SupplierRequestFailure('unavailable', true, 'Simulated failure for one workflow');
      }
    }
    return suppliers[supplier].list(city, signal);
  }

  Runtime.install({ logger: new DefaultLogger('ERROR') });
  const workerConnection = await NativeConnection.connect(config.temporal);
  t.after(() => workerConnection.close());
  const worker = await Worker.create({
    connection: workerConnection,
    namespace: config.namespace,
    taskQueue,
    workflowsPath: require.resolve('../../dist/worker/workflows'),
    activities: createComparisonActivities(
      {
        'supplier-a': {
          list: (city, signal) => fetchOffers('supplier-a', city, signal),
          probe: () => suppliers['supplier-a'].probe(),
        },
        'supplier-b': {
          list: (city, signal) => fetchOffers('supplier-b', city, signal),
          probe: () => suppliers['supplier-b'].probe(),
        },
      },
      snapshots,
    ),
  });

  await worker.runUntil(async () => {
    await t.test('serves the supplier routes only from the fixture service', async () => {
      for (const supplierUrl of [supplierAUrl, supplierBUrl]) {
        const fixture = await fetch(supplierUrl, { signal: AbortSignal.timeout(3000) });
        equal(fixture.status, 200);
        ok((await fixture.json()).length > 0);
        equal((await get(supplierUrl.pathname)).status, 404);
      }
    });

    await t.test('starts both supplier Activities together and saves the exact Delhi winners', async () => {
      barrier = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      const response = await get('/api/hotels?city=%20DELHI%20');
      releaseBarrier?.();
      barrier = undefined;
      equal(response.status, 200);
      equal(response.headers.get('Hotel-Offer-Completeness'), 'complete');
      equal(response.headers.get('Cache-Control'), 'no-store');
      deepStrictEqual(await response.json(), [holtin, radison]);
      deepStrictEqual([...calls].sort(), ['supplier-a', 'supplier-b']);

      const requestId = response.headers.get('Request-Id');
      ok(requestId);
      const workflowId = workflowIdFor(requestId);
      equal(await redis.zCard(snapshotKeyFor(workflowId)), 3);
      const history = await temporal.workflow.getHandle(workflowId).fetchHistory();
      equal(
        history.events?.filter(
          (event) => event.activityTaskScheduledEventAttributes?.activityType?.name === 'fetchSupplierOffers',
        ).length,
        2,
      );
    });

    await t.test('filters after deduplication and refreshes suppliers for each range', async () => {
      const before = calls.length;
      const response = await get('/api/hotels?city=delhi&minPrice=5800&maxPrice=6000');
      equal(response.status, 200);
      deepStrictEqual(await response.json(), [radison]);
      deepStrictEqual(await (await get('/api/hotels?city=delhi&minPrice=5340&maxPrice=5340')).json(), [holtin]);
      equal(calls.length - before, 4);
    });

    await t.test('returns complete empty results and scopes the data to the requested city', async () => {
      const response = await get('/api/hotels?city=helsinki');
      equal(response.headers.get('Hotel-Offer-Completeness'), 'complete');
      deepStrictEqual(await response.json(), []);
      deepStrictEqual(await (await get('/api/hotels?city=mumbai')).json(), [
        { name: 'Holtin', price: 6900, supplier: 'Supplier B', commissionPct: 16 },
      ]);
    });

    await t.test('rejects invalid input before starting a workflow', async () => {
      const before = calls.length;
      for (const query of [
        '',
        'city=delhi&city=mumbai',
        'city=delhi&minPrice[x]=2',
        'city=delhi&minPrice=300&maxPrice=200',
        'city=delhi&minPrice=9007199254740992',
        'city=delhi&maxPrice=0.5',
        'city=delhi&minPrice=-5',
      ]) {
        const response = await get('/api/hotels?' + query);
        equal(response.status, 400, query);
        ok(response.headers.get('Content-Type')?.startsWith('application/problem+json'));
        const requestId = response.headers.get('Request-Id');
        ok(requestId);
        await response.json();
        await rejects(temporal.workflow.getHandle(workflowIdFor(requestId)).describe(), WorkflowNotFoundError);
      }
      equal(calls.length, before);
    });

    await t.test('isolates concurrent complete and partial requests for the same city', async () => {
      isolateSupplierFailure = true;
      const path = '/api/hotels?city=delhi&minPrice=5800';
      const responses = await Promise.all([get(path), get(path)]);
      isolateSupplierFailure = false;

      const complete = responses.find((response) => response.headers.get('Hotel-Offer-Completeness') === 'complete');
      const partial = responses.find((response) => response.headers.get('Hotel-Offer-Completeness') === 'partial');
      ok(complete && partial);
      deepStrictEqual(await complete.json(), [radison]);
      deepStrictEqual(await partial.json(), [radison, fallbackHoltin]);
      const completeId = complete.headers.get('Request-Id');
      const partialId = partial.headers.get('Request-Id');
      ok(completeId && partialId);
      deepStrictEqual(await snapshots.read(workflowIdFor(completeId), {}), [holtin, radison]);
      deepStrictEqual(await snapshots.read(workflowIdFor(partialId), {}), [radison, fallbackHoltin]);
    });

    await t.test('bounds a hanging supplier body and returns partial offers before the search deadline', async () => {
      const before = calls.length;
      hangSupplierA = true;
      const started = performance.now();
      try {
        const response = await get('/api/hotels?city=delhi');
        equal(response.status, 200);
        equal(response.headers.get('Hotel-Offer-Completeness'), 'partial');
        equal(response.headers.get('Hotel-Offer-Failed-Supplier'), 'supplier-a');
        deepStrictEqual(await response.json(), [holtin]);
        ok(performance.now() - started < 12_000);
        equal(calls.slice(before).filter((supplier) => supplier === 'supplier-a').length, 2);
      } finally {
        hangSupplierA = false;
      }
    });

    await t.test('retries transient failures and returns partial results after a persistent outage', async () => {
      const before = calls.length;
      failBOnce = true;
      equal((await (await get('/api/hotels?city=delhi')).json())[0]?.price, 5340);
      equal(calls.slice(before).filter((supplier) => supplier === 'supplier-b').length, 2);

      mockOutages['supplier-b'] = true;
      const response = await get('/api/hotels?city=delhi');
      equal(response.status, 200);
      equal(response.headers.get('Hotel-Offer-Completeness'), 'partial');
      equal(response.headers.get('Hotel-Offer-Failed-Supplier'), 'supplier-b');
      deepStrictEqual(await response.json(), [radison, fallbackHoltin]);

      const health = await get('/health');
      equal(health.status, 503);
      deepStrictEqual(await health.json(), {
        status: 'degraded',
        suppliers: { 'supplier-a': 'up', 'supplier-b': 'down' },
      });
      const empty = await get('/api/hotels?city=helsinki');
      equal(empty.headers.get('Hotel-Offer-Completeness'), 'partial');
      deepStrictEqual(await empty.json(), []);
    });

    await t.test('returns 502 for dual failure and 504 when a supplier timed out', async () => {
      mockOutages['supplier-a'] = true;
      const response = await get('/api/hotels?city=delhi');
      equal(response.status, 502);
      equal((await response.json()).status, 502);
      timeOutA = true;
      const timeout = await get('/api/hotels?city=delhi');
      equal(timeout.status, 504);
      equal((await timeout.json()).status, 504);
    });
  });
});

async function listen(t: TestContext, app: Express): Promise<URL> {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))));
  await once(server, 'listening');
  const address = server.address();
  ok(address && typeof address !== 'string');
  return new URL('http://127.0.0.1:' + address.port);
}
