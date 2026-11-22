import type { Supplier, SupplierOffer } from '../../suppliers/supplier.types';
import type { HotelOffer } from '../interfaces/hotel-offer.interface';

export interface ComparisonActivities {
  fetchSupplierOffers(supplier: Supplier, city: string): Promise<SupplierOffer[]>;
  saveOfferSnapshot(snapshotId: string, offers: HotelOffer[]): Promise<void>;
}
