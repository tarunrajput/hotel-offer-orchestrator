import { deepStrictEqual, equal, rejects } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  RedisSnapshotRepository,
  snapshotKeyFor,
} from '../../src/modules/hotel-search/repositories/redis-snapshot.repository';
import type { HotelOffer } from '../../src/modules/hotel-search/interfaces/hotel-offer.interface';
import { readConfig } from '../../src/config/config';
import { connectRedis, createRedisClient } from '../../src/common/redis/client';

const offers: HotelOffer[] = [
  { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
  { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
];

test(
  'Redis applies score ranges and isolates idempotent, expiring search snapshots',
  { timeout: 10_000 },
  async (t) => {
    const config = readConfig();
    const redis = createRedisClient(config.redisUrl, (error) => t.diagnostic(String(error)));
    t.after(() => {
      if (redis.isOpen) redis.destroy();
    });
    await connectRedis(redis);

    const repository = new RedisSnapshotRepository(redis, 10);
    const complete = randomUUID();
    const partial = randomUUID();
    const empty = randomUUID();
    const expiring = randomUUID();
    const partialOffers: HotelOffer[] = [{ name: 'Holtin', price: 6000, supplier: 'Supplier A', commissionPct: 10 }];

    await Promise.all([
      repository.save(complete, offers),
      repository.save(partial, partialOffers),
      repository.save(empty, []),
      new RedisSnapshotRepository(redis, 1).save(expiring, []),
    ]);
    await repository.save(complete, offers);

    equal(await redis.zCard(snapshotKeyFor(complete)), 3);
    const byScore = await redis.zRangeWithScores(snapshotKeyFor(complete), 5340, 5900, { BY: 'SCORE' });
    deepStrictEqual(
      byScore.map(({ score }) => score),
      [5340, 5900],
    );
    deepStrictEqual(await repository.read(complete, { minPrice: 5340, maxPrice: 5900 }), [...offers].reverse());
    deepStrictEqual(await repository.read(complete, { maxPrice: 5340 }), offers.slice(1));
    deepStrictEqual(await repository.read(complete, { minPrice: 5800 }), offers.slice(0, 1));
    deepStrictEqual(await repository.read(complete, { minPrice: 6000 }), []);
    deepStrictEqual(await repository.read(partial, {}), partialOffers);
    deepStrictEqual(await repository.read(empty, {}), []);
    equal(await redis.exists(snapshotKeyFor(empty)), 1);

    await rejects(repository.read(randomUUID(), {}), { code: 'redis-unavailable' });
    await delay(1100);
    await rejects(repository.read(expiring, {}), { code: 'redis-unavailable' });
    await rejects(repository.read(complete, {}, Date.now() - 1), { code: 'search-timeout' });
    await redis.del([snapshotKeyFor(complete), snapshotKeyFor(partial), snapshotKeyFor(empty)]);
  },
);
