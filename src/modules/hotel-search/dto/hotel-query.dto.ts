import { parseCity } from '../../../common/http/city-query';
import { invalidQuery } from '../../../common/http/problem-details';
import { isPrice } from '../../suppliers/supplier.types';
import type { HotelQuery } from '../hotel-search.service';

export function parseHotelQuery(query: Record<string, unknown>): HotelQuery {
  if (Object.keys(query).some((name) => !['city', 'minPrice', 'maxPrice'].includes(name))) {
    throw invalidQuery('Only city, minPrice, and maxPrice query parameters are supported.');
  }
  const city = parseCity(query.city);
  const minPrice = parseBound(query.minPrice, 'minPrice');
  const maxPrice = parseBound(query.maxPrice, 'maxPrice');

  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw invalidQuery('minPrice must be less than or equal to maxPrice.');
  }
  return { city, minPrice, maxPrice };
}

function parseBound(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const bound = Number(value);
    if (isPrice(bound)) return bound;
  }
  throw invalidQuery(name + ' must be a single non-negative whole number within the safe integer range.');
}
