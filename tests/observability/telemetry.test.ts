import { deepStrictEqual, equal, ok } from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

interface JaegerSpan {
  spanID: string;
  operationName: string;
  references: { refType: string; spanID: string }[];
  tags: { key: string; value: unknown }[];
}

const apiPort = process.env.API_PORT ?? 3000;
const jaegerPort = process.env.JAEGER_PORT ?? 16686;
const prometheusPort = process.env.PROMETHEUS_PORT ?? 9090;

test('exports connected search spans and bounded metrics through the Collector', { timeout: 45_000 }, async () => {
  const traceId = randomBytes(16).toString('hex');
  const clientSpan = randomBytes(8).toString('hex');
  const response = await fetch('http://127.0.0.1:' + apiPort + '/api/hotels?city=delhi&minPrice=5800', {
    headers: { traceparent: '00-' + traceId + '-' + clientSpan + '-01' },
    signal: AbortSignal.timeout(13_000),
  });
  equal(response.status, 200);
  equal(response.headers.get('Hotel-Offer-Completeness'), 'complete');
  deepStrictEqual(await response.json(), [{ name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 }]);

  const spans = await poll('complete trace', async () => {
    const result = await fetch('http://127.0.0.1:' + jaegerPort + '/api/traces/' + traceId, {
      signal: AbortSignal.timeout(3000),
    });
    if (result.status === 404) return undefined;
    equal(result.status, 200);
    const trace: { data: { spans: JaegerSpan[] }[] } = await result.json();
    const spans = trace.data[0]?.spans;
    return spans && spans.length >= 11 ? spans : undefined;
  });

  const matches = (name: string, kind?: string) =>
    spans.filter(
      (span) =>
        span.operationName === name &&
        (!kind || span.tags.some(({ key, value }) => key === 'span.kind' && value === kind)),
    );
  const find = (name: string, kind?: string) => {
    const span = matches(name, kind)[0];
    ok(span, name);
    return span;
  };
  const parent = (span: JaegerSpan) => span.references.find(({ refType }) => refType === 'CHILD_OF')?.spanID;
  const server = find('GET /api/hotels', 'server');
  const comparison = find('hotel.workflow.compare');
  equal(parent(server), clientSpan);
  equal(parent(comparison), server.spanID);
  const activities = matches('temporal.activity.fetchSupplierOffers');
  equal(activities.length, 2);
  for (const activity of activities) equal(parent(activity), comparison.spanID);
  for (const supplier of ['A', 'B']) {
    const operation = 'GET /supplier' + supplier + '/hotels';
    const outbound = find(operation, 'client');
    ok(activities.some((activity) => activity.spanID === parent(outbound)));
    equal(parent(find(operation, 'server')), outbound.spanID);
  }
  const writeActivity = find('temporal.activity.saveOfferSnapshot');
  equal(parent(writeActivity), comparison.spanID);
  equal(parent(find('redis.offer_snapshot.write')), writeActivity.spanID);
  equal(parent(find('redis.offer_snapshot.read')), server.spanID);
  ok(spans.every((span) => span.tags.every(({ key }) => key !== 'url.query' && key !== 'url.full')));

  await Promise.all(
    [
      'hotel_search_requests_total{hotel_search_outcome="complete"}',
      'http_server_request_duration_seconds_bucket{http_route="/api/hotels"}',
      'hotel_supplier_request_duration_seconds_count{hotel_supplier="supplier-b",hotel_outcome="success"}',
      'hotel_workflow_duration_seconds_count{hotel_outcome="complete"}',
      'hotel_redis_operation_duration_seconds_count{db_operation_name="ZRANGE",hotel_outcome="success"}',
    ].map(async (query) => {
      const series = await poll(query, async () => {
        const result = await fetch(
          'http://127.0.0.1:' + prometheusPort + '/api/v1/query?' + new URLSearchParams({ query }),
          { signal: AbortSignal.timeout(3000) },
        );
        equal(result.status, 200);
        const payload: { data: { result: { metric: Record<string, string> }[] } } = await result.json();
        return payload.data.result.length ? payload.data.result : undefined;
      });
      for (const { metric } of series) {
        ok(['hotel_request_id', 'temporal_workflow_id', 'url_query', 'city'].every((label) => !(label in metric)));
      }
    }),
  );
});

async function poll<T>(label: string, read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== undefined) return result;
    await delay(500);
  }
  throw new Error('Timed out waiting for ' + label);
}
