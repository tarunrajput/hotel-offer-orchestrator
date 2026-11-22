import { ApplicationFailure, log, proxyActivities, workflowInfo } from '@temporalio/workflow';
import type { ComparisonResult } from '../interfaces/hotel-search.interface';
import { selectBestOffers } from '../utils/select-best-offers';
import type { ComparisonActivities } from './activity-contract';
import { classifySupplierFailures, temporalFailure } from './failures';

const { fetchSupplierOffers } = proxyActivities<ComparisonActivities>({
  startToCloseTimeout: '2 seconds',
  scheduleToCloseTimeout: '5 seconds',
  retry: { initialInterval: '250 milliseconds', maximumAttempts: 2 },
});

const { saveOfferSnapshot } = proxyActivities<ComparisonActivities>({
  startToCloseTimeout: '1500 milliseconds',
  scheduleToCloseTimeout: '3 seconds',
  retry: { initialInterval: '250 milliseconds', maximumAttempts: 2 },
});

export async function compareHotelOffers(city: string): Promise<ComparisonResult> {
  const [supplierAResult, supplierBResult] = await Promise.allSettled([
    fetchSupplierOffers('supplier-a', city),
    fetchSupplierOffers('supplier-b', city),
  ]);

  if (supplierAResult.status === 'rejected' && supplierBResult.status === 'rejected') {
    const failureType = classifySupplierFailures([supplierAResult.reason, supplierBResult.reason]);
    log.warn('Both suppliers failed', { event: 'hotel.search.suppliers_failed', city, failureType });
    throw ApplicationFailure.nonRetryable('Both suppliers failed', failureType);
  }

  const offers = selectBestOffers([
    ...(supplierAResult.status === 'fulfilled' ? supplierAResult.value : []),
    ...(supplierBResult.status === 'fulfilled' ? supplierBResult.value : []),
  ]);
  const snapshotId = workflowInfo().workflowId;
  try {
    await saveOfferSnapshot(snapshotId, offers);
  } catch (error) {
    log.error('Could not save offer snapshot', { event: 'hotel.snapshot.failed', city, err: error });
    throw ApplicationFailure.nonRetryable('Could not save offer snapshot', temporalFailure.snapshotFailure);
  }

  if (supplierAResult.status === 'rejected' || supplierBResult.status === 'rejected') {
    const failedSupplier = supplierAResult.status === 'rejected' ? 'supplier-a' : 'supplier-b';
    log.warn('Returning partial search', { event: 'hotel.search.partial', city, failedSupplier });
    return { snapshotId, completeness: 'partial', failedSupplier };
  }
  log.info('Completed hotel search', { event: 'hotel.search.completed', city, count: offers.length });
  return { snapshotId, completeness: 'complete' };
}
