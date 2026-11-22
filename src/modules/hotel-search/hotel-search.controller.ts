import { Router, type RequestHandler } from 'express';
import { HttpFailure } from '../../common/http/problem-details';
import { SearchFailure, type SearchFailureCode } from './exceptions/search-failure';
import type { HotelSearch } from './hotel-search.service';
import { parseHotelQuery } from './dto/hotel-query.dto';

export const hotelSearchPath = '/api/hotels';

const searchProblems = {
  'temporal-unavailable': [503, 'The search service is temporarily unavailable.'],
  'redis-unavailable': [503, 'Offer storage is temporarily unavailable.'],
  'upstream-failure': [502, 'Both hotel suppliers failed to provide offers.'],
  'upstream-timeout': [504, 'The search could not complete because a supplier timed out.'],
  'search-timeout': [504, 'The hotel search exceeded its time limit.'],
} as const satisfies Record<SearchFailureCode, readonly [number, string]>;

export function createHotelRoutes(search: HotelSearch): Router {
  const handleHotelSearch: RequestHandler = async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const result = await search(parseHotelQuery(req.query), String(res.get('Request-Id')));
      res.set('Hotel-Offer-Completeness', result.completeness);
      if (result.completeness === 'partial') res.set('Hotel-Offer-Failed-Supplier', result.failedSupplier);
      res.json(result.offers);
    } catch (error) {
      if (!(error instanceof SearchFailure)) throw error;
      const [status, detail] = searchProblems[error.code];
      throw new HttpFailure(status, error.code, detail, error);
    }
  };

  const router = Router();
  router.get(hotelSearchPath, handleHotelSearch);
  return router;
}
