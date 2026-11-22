import { parse } from 'node:querystring';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { createHotelRoutes, hotelSearchPath } from './modules/hotel-search/hotel-search.controller';
import type { HotelSearch } from './modules/hotel-search/hotel-search.service';
import { createProblemHandler, notFound } from './common/http/problem-details';
import { observeHttpRequests } from './common/middleware/request-telemetry.middleware';
import { createHealthRoutes, type SupplierProbe } from './modules/health/health.controller';

interface AppDependencies {
  corsOrigins?: string[];
  search: HotelSearch;
  probeSupplier: SupplierProbe;
  logger: Pick<Logger, 'info' | 'error'>;
}

export function createApp({ search, probeSupplier, logger, corsOrigins = [] }: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  // The default 1,000-pair limit can hide invalid parameters after empty query entries.
  app.set('query parser', (query: string) => parse(query, undefined, undefined, { maxKeys: 0 }));

  app.use(observeHttpRequests(logger, hotelSearchPath));
  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      methods: ['GET', 'HEAD'],
      exposedHeaders: ['Request-Id', 'Hotel-Offer-Completeness', 'Hotel-Offer-Failed-Supplier'],
    }),
  );
  app.use(createHotelRoutes(search));
  app.use(createHealthRoutes(probeSupplier));
  app.use(notFound);
  app.use(createProblemHandler(logger));
  return app;
}
