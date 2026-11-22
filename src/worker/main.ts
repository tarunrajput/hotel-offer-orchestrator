import { telemetry } from './instrumentation';
import pino from 'pino';
import { runWorker } from './bootstrap';

const logger = pino({ name: 'hotel-offer-worker', level: process.env.LOG_LEVEL ?? 'info' });

void runWorker(logger, telemetry.enabled)
  .catch((err: unknown) => {
    logger.error({ event: 'worker.failed', err }, 'Worker stopped with an error');
    process.exitCode = 1;
  })
  .finally(() =>
    telemetry.shutdown().catch((err: unknown) => {
      logger.warn({ event: 'telemetry.shutdown.failed', err }, 'Could not flush telemetry');
    }),
  );
