import { once } from 'node:events';
import { Client, Connection } from '@temporalio/client';
import type { Logger } from 'pino';
import { RedisSnapshotRepository } from './modules/hotel-search/repositories/redis-snapshot.repository';
import { TemporalWorkflowRunner } from './modules/hotel-search/temporal/workflow-runner';
import { createHotelSearch } from './modules/hotel-search/hotel-search.service';
import { readConfig } from './config/config';
import { drainOnSignal } from './common/http/server';
import { connectRedis, createRedisClient } from './common/redis/client';
import { traceWorkflowStart } from './common/temporal/trace-interceptors';
import { createSupplierClients } from './modules/suppliers/suppliers.factory';
import { createApp } from './app';

export async function runApi(logger: Logger, telemetryEnabled: boolean): Promise<void> {
  const config = readConfig();
  const suppliers = createSupplierClients();
  const connection = Connection.lazy({ ...config.temporal, connectTimeout: '3 seconds' });
  const redis = createRedisClient(config.redisUrl, (err) =>
    logger.warn({ event: 'redis.connection.failed', err }, 'Redis connection error'),
  );

  try {
    await Promise.all([connectRedis(redis), connection.ensureConnected()]);
    const temporal = new Client({
      connection,
      namespace: config.namespace,
      interceptors: telemetryEnabled ? { workflow: [traceWorkflowStart] } : undefined,
    });
    const comparison = new TemporalWorkflowRunner(temporal, config.taskQueue);
    const snapshots = new RedisSnapshotRepository(redis, config.snapshotTtlSeconds);
    const app = createApp({
      corsOrigins: config.corsOrigins,
      search: createHotelSearch(comparison, snapshots),
      probeSupplier: (supplier) => suppliers[supplier].probe(),
      logger,
    });
    const server = app.listen(config.port, '0.0.0.0');
    await once(server, 'listening');
    logger.info({ event: 'api.started', port: config.port }, 'API listening');
    await drainOnSignal(server, () => logger.info({ event: 'api.draining' }, 'Draining HTTP requests'));
  } finally {
    if (redis.isOpen) redis.destroy();
    await connection.close();
  }
}
