import express from 'express';
import type { Logger } from 'pino';
import type { Supplier } from '../modules/suppliers/supplier.types';
import { parseCity } from '../common/http/city-query';
import { createProblemHandler, HttpFailure } from '../common/http/problem-details';
import { observeHttpRequests } from '../common/middleware/request-telemetry.middleware';
import { supplierFixtures } from './fixtures';

const supplierPaths = {
  'supplier-a': '/supplierA/hotels',
  'supplier-b': '/supplierB/hotels',
} as const satisfies Record<Supplier, string>;

export function createMockSuppliersApp(
  outages: Readonly<Record<Supplier, boolean>>,
  logger: Pick<Logger, 'info' | 'error'>,
) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('query parser', 'simple');
  app.use(observeHttpRequests(logger));
  app.get('/livez', (_req, res) => {
    res.json({ status: 'up' });
  });
  for (const supplier of ['supplier-a', 'supplier-b'] as const) {
    app.get(supplierPaths[supplier], (req, res) => {
      if (outages[supplier]) throw new HttpFailure(503, 'mock-supplier-unavailable', 'Mock supplier is down.');
      const city = req.query.city === undefined ? undefined : parseCity(req.query.city);
      const offers = supplierFixtures[supplier];
      res.json(city === undefined ? offers : offers.filter((offer) => offer.city === city));
    });
  }
  app.use(createProblemHandler(logger));
  return app;
}
