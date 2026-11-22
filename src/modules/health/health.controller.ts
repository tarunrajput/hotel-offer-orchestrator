import { Router, type RequestHandler } from 'express';
import type { Supplier } from '../suppliers/supplier.types';

export type SupplierProbe = (supplier: Supplier) => Promise<void>;

export function createHealthRoutes(probeSupplier: SupplierProbe): Router {
  const reportSupplierHealth: RequestHandler = async (_req, res) => {
    const [supplierAResult, supplierBResult] = await Promise.allSettled([
      probeSupplier('supplier-a'),
      probeSupplier('supplier-b'),
    ]);
    const supplierAHealth = supplierAResult.status === 'fulfilled' ? 'up' : 'down';
    const supplierBHealth = supplierBResult.status === 'fulfilled' ? 'up' : 'down';
    const healthy = supplierAHealth === 'up' && supplierBHealth === 'up';
    res
      .set('Cache-Control', 'no-store')
      .status(healthy ? 200 : 503)
      .json({
        status: healthy ? 'up' : 'degraded',
        suppliers: {
          'supplier-a': supplierAHealth,
          'supplier-b': supplierBHealth,
        },
      });
  };

  const router = Router();
  router.get('/livez', (_req, res) => {
    res.status(200).json({ status: 'up' });
  });
  router.get('/health', reportSupplierHealth);
  return router;
}
