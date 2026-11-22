import type { Supplier } from '../../suppliers/supplier.types';
import type { HotelOffer, PriceRange } from './hotel-offer.interface';

export type SearchCompletion = { completeness: 'complete' } | { completeness: 'partial'; failedSupplier: Supplier };

export type ComparisonResult = SearchCompletion & { snapshotId: string };

export interface OfferComparison {
  compare(city: string, requestId: string, deadline: number): Promise<ComparisonResult>;
}

export interface SnapshotReader {
  read(snapshotId: string, range: PriceRange, deadline: number): Promise<HotelOffer[]>;
}

export interface SnapshotWriter {
  save(snapshotId: string, offers: readonly HotelOffer[]): Promise<void>;
}
