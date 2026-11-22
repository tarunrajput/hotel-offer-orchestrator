import type { Supplier, supplierLabels } from '../../suppliers/supplier.types';

export interface HotelOffer {
  name: string;
  price: number;
  supplier: (typeof supplierLabels)[Supplier];
  commissionPct: number;
}

export interface PriceRange {
  minPrice?: number;
  maxPrice?: number;
}
