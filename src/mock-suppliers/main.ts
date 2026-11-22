import { telemetry } from './instrumentation';
import pino from 'pino';
import { runMockSuppliers } from './bootstrap';

const logger = pino({ name: 'hotel-mock-suppliers', level: process.env.LOG_LEVEL ?? 'info' });

void runMockSuppliers(logger)
  .catch((err: unknown) => {
    logger.error({ event: 'mock-suppliers.failed', err }, 'Mock suppliers stopped with an error');
    process.exitCode = 1;
  })
  .finally(() =>
    telemetry.shutdown().catch((err: unknown) => {
      logger.warn({ event: 'telemetry.shutdown.failed', err }, 'Could not flush telemetry');
    }),
  );
