import { SpanKind } from '@opentelemetry/api';
import { durationHistogram, markSpanError, tracer } from '../../../common/observability/instruments';
import { RedisCommandTimeout, runRedisCommand, type RedisClient } from '../../../common/redis/client';
import { isCommissionPct, isPrice, supplierLabels } from '../../suppliers/supplier.types';
import type { SnapshotReader, SnapshotWriter } from '../interfaces/hotel-search.interface';
import { SearchFailure } from '../exceptions/search-failure';
import type { HotelOffer, PriceRange } from '../interfaces/hotel-offer.interface';

const snapshotMarker = '__snapshot__';
const redisCommandTimeoutMs = 1000;
const redisOperationDuration = durationHistogram(
  'hotel.redis.operation.duration',
  'Duration of Redis snapshot operations',
);

export const snapshotKeyFor = (snapshotId: string): string => 'hotel-offers:v1:' + snapshotId;

export class RedisSnapshotRepository implements SnapshotReader, SnapshotWriter {
  constructor(
    private readonly client: RedisClient,
    private readonly ttlSeconds: number,
  ) {}

  async save(snapshotId: string, offers: readonly HotelOffer[]): Promise<void> {
    return observeRedis('write', 'ZADD', async () => {
      const members = offers.map((offer) => ({ value: JSON.stringify(offer), score: offer.price }));
      members.push({ value: snapshotMarker, score: -1 });
      const key = snapshotKeyFor(snapshotId);

      const [, expirySet] = await withinRedisBudget(
        () => this.client.multi().zAdd(key, members).expire(key, this.ttlSeconds).execTyped(),
        redisCommandTimeoutMs,
      );
      if (!expirySet) throw new SearchFailure('redis-unavailable', new Error('Offer snapshot expiry was not set'));
    });
  }

  async read(snapshotId: string, range: PriceRange, deadline = Infinity): Promise<HotelOffer[]> {
    return observeRedis('read', 'ZRANGE', async () => {
      const remainingMs = deadline - Date.now();
      const key = snapshotKeyFor(snapshotId);
      const [exists, members] = await withinRedisBudget(
        () =>
          this.client
            .multi()
            .exists(key)
            .zRange(key, range.minPrice ?? 0, range.maxPrice ?? '+inf', { BY: 'SCORE' })
            .execTyped(),
        Math.min(redisCommandTimeoutMs, remainingMs),
        remainingMs <= redisCommandTimeoutMs ? 'search-timeout' : 'redis-unavailable',
      );

      if (!exists) throw new SearchFailure('redis-unavailable', new Error('Offer snapshot is missing'));
      try {
        return members.map(decodeOffer);
      } catch (error) {
        throw new SearchFailure('redis-unavailable', error);
      }
    });
  }
}

function observeRedis<T>(
  action: 'read' | 'write',
  command: 'ZRANGE' | 'ZADD',
  operation: () => Promise<T>,
): Promise<T> {
  const attributes = { 'db.system.name': 'redis', 'db.operation.name': command };
  return tracer.startActiveSpan(
    'redis.offer_snapshot.' + action,
    { kind: SpanKind.CLIENT, attributes },
    async (span) => {
      const started = performance.now();
      let outcome = 'success';
      try {
        return await operation();
      } catch (error) {
        outcome = error instanceof SearchFailure ? error.code : 'error';
        markSpanError(span, outcome);
        throw error;
      } finally {
        redisOperationDuration.record((performance.now() - started) / 1000, {
          ...attributes,
          'hotel.outcome': outcome,
        });
        span.end();
      }
    },
  );
}

async function withinRedisBudget<T>(
  operation: () => Promise<T>,
  budgetMs: number,
  timeoutCode: 'redis-unavailable' | 'search-timeout' = 'redis-unavailable',
): Promise<T> {
  try {
    return await runRedisCommand(operation, budgetMs);
  } catch (error) {
    throw new SearchFailure(error instanceof RedisCommandTimeout ? timeoutCode : 'redis-unavailable', error);
  }
}

function decodeOffer(member: string): HotelOffer {
  const decoded: unknown = JSON.parse(member);
  if (decoded === null || typeof decoded !== 'object') throw new Error('Invalid offer snapshot member');
  const { name, price, supplier, commissionPct } = decoded as Record<string, unknown>;
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    !isPrice(price) ||
    !isCommissionPct(commissionPct) ||
    (supplier !== supplierLabels['supplier-a'] && supplier !== supplierLabels['supplier-b'])
  ) {
    throw new Error('Invalid offer snapshot member');
  }
  return { name, price, supplier, commissionPct };
}
