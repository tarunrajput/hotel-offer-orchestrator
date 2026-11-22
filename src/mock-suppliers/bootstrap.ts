import { once } from 'node:events';
import type { Logger } from 'pino';
import { readBoolean, readPort } from '../config/config';
import { drainOnSignal } from '../common/http/server';
import { createMockSuppliersApp } from './app';

export async function runMockSuppliers(logger: Logger): Promise<void> {
  const port = readPort();
  const app = createMockSuppliersApp(
    {
      'supplier-a': readBoolean(process.env.MOCK_SUPPLIER_A_DOWN, 'MOCK_SUPPLIER_A_DOWN'),
      'supplier-b': readBoolean(process.env.MOCK_SUPPLIER_B_DOWN, 'MOCK_SUPPLIER_B_DOWN'),
    },
    logger,
  );
  const server = app.listen(port, '0.0.0.0');
  await once(server, 'listening');
  logger.info({ event: 'mock-suppliers.started', port }, 'Mock suppliers listening');
  await drainOnSignal(server);
}
