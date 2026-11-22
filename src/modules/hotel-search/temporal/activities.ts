import { ApplicationFailure, Context, log } from '@temporalio/activity';
import { SupplierRequestFailure, type SupplierClients } from '../../suppliers/supplier.types';
import type { SnapshotWriter } from '../interfaces/hotel-search.interface';
import type { ComparisonActivities } from './activity-contract';
import { temporalFailure } from './failures';

const failureType = {
  timeout: temporalFailure.supplierTimeout,
  unavailable: temporalFailure.supplierUnavailable,
  'invalid-response': temporalFailure.supplierInvalidResponse,
} as const;

export function createComparisonActivities(
  suppliers: SupplierClients,
  snapshots: SnapshotWriter,
): ComparisonActivities {
  return {
    async fetchSupplierOffers(supplier, city) {
      const started = performance.now();
      const context = Context.current();
      try {
        const listings = await suppliers[supplier].list(city, context.cancellationSignal);
        log.info('Supplier responded', {
          event: 'hotel.supplier.completed',
          supplier,
          city,
          count: listings.length,
          attempt: context.info.attempt,
          durationMs: performance.now() - started,
        });
        return listings.map((listing) => ({ ...listing, supplier }));
      } catch (error) {
        log.warn('Supplier Activity failed', {
          event: 'hotel.supplier.failed',
          supplier,
          city,
          err: error,
          attempt: context.info.attempt,
          durationMs: performance.now() - started,
        });
        if (!(error instanceof SupplierRequestFailure)) throw error;
        throw ApplicationFailure.create({
          message: error.message,
          type: failureType[error.kind],
          nonRetryable: !error.retryable,
        });
      }
    },
    async saveOfferSnapshot(snapshotId, offers) {
      await snapshots.save(snapshotId, offers);
      log.info('Offer snapshot saved', { event: 'hotel.snapshot.saved', snapshotId, count: offers.length });
    },
  };
}
