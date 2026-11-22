import { hostname } from 'node:os';
import { makeTelemetryFilterString, NativeConnection, Runtime, Worker } from '@temporalio/worker';
import type { Logger } from 'pino';
import { RedisSnapshotRepository } from '../modules/hotel-search/repositories/redis-snapshot.repository';
import { createComparisonActivities } from '../modules/hotel-search/temporal/activities';
import { readConfig } from '../config/config';
import { connectRedis, createRedisClient } from '../common/redis/client';
import { createTemporalLogger } from '../common/temporal/pino-logger';
import { traceActivity } from '../common/temporal/trace-interceptors';
import { createSupplierClients } from '../modules/suppliers/suppliers.factory';

export async function runWorker(logger: Logger, telemetryEnabled: boolean): Promise<void> {
  const config = readConfig();
  const suppliers = createSupplierClients();
  const metricsEndpoint = process.env.TEMPORAL_METRICS_OTLP_ENDPOINT;
  Runtime.install({
    logger: createTemporalLogger(logger),
    telemetryOptions: {
      logging: { filter: makeTelemetryFilterString({ core: 'WARN', other: 'WARN' }), forward: {} },
      metrics:
        telemetryEnabled && metricsEndpoint
          ? {
              globalTags: { 'service.instance.id': process.pid + '@' + hostname() },
              otel: {
                url: metricsEndpoint,
                http: true,
                metricsExportInterval: '5 seconds',
                useSecondsForDurations: true,
              },
            }
          : undefined,
    },
  });
  const redis = createRedisClient(config.redisUrl, (err) =>
    logger.warn({ event: 'redis.connection.failed', err }, 'Redis connection error'),
  );
  let connection: NativeConnection | undefined;
  try {
    await connectRedis(redis);
    connection = await NativeConnection.connect(config.temporal);
    const snapshots = new RedisSnapshotRepository(redis, config.snapshotTtlSeconds);
    const worker = await Worker.create({
      connection,
      namespace: config.namespace,
      taskQueue: config.taskQueue,
      workflowsPath: require.resolve('./workflows'),
      activities: createComparisonActivities(suppliers, snapshots),
      interceptors: telemetryEnabled
        ? {
            workflowModules: [require.resolve('../common/temporal/workflow-interceptors')],
            activity: [traceActivity],
          }
        : undefined,
      shutdownGraceTime: '5 seconds',
      shutdownForceTime: '8 seconds',
    });
    await worker.run();
  } finally {
    if (redis.isOpen) redis.destroy();
    await connection?.close();
  }
}
