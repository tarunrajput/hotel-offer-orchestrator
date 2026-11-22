import type { HotelOffer, PriceRange } from './interfaces/hotel-offer.interface';
import type { OfferComparison, SearchCompletion, SnapshotReader } from './interfaces/hotel-search.interface';

export interface HotelQuery extends PriceRange {
  city: string;
}

export type HotelSearch = (
  query: HotelQuery,
  requestId: string,
) => Promise<SearchCompletion & { offers: HotelOffer[] }>;

const searchDeadlineMs = 12_000;

export function createHotelSearch(comparison: OfferComparison, snapshots: SnapshotReader): HotelSearch {
  return async (query, requestId) => {
    const deadline = Date.now() + searchDeadlineMs;
    const { snapshotId, ...completion } = await comparison.compare(query.city, requestId, deadline);
    const offers = await snapshots.read(snapshotId, query, deadline);
    return { ...completion, offers };
  };
}
