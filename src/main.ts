import { telemetry } from './instrumentation';
import pino from 'pino';
import { runApi } from './bootstrap';

const logger = pino({ name: 'hotel-offer-api', level: process.env.LOG_LEVEL ?? 'info' });

void runApi(logger, telemetry.enabled)
  .catch((err: unknown) => {
    logger.error({ event: 'api.failed', err }, 'API stopped with an error');
    process.exitCode = 1;
  })
  .finally(() =>
    telemetry.shutdown().catch((err: unknown) => {
      logger.warn({ event: 'telemetry.shutdown.failed', err }, 'Could not flush telemetry');
    }),
  );
