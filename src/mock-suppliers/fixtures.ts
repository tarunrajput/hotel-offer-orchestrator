import type { Supplier, SupplierListing } from '../modules/suppliers/supplier.types';

export const supplierFixtures: Record<Supplier, readonly SupplierListing[]> = {
  'supplier-a': [
    { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
    { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
    { hotelId: 'a3', name: 'Holtin', price: 7100, city: 'mumbai', commissionPct: 12 },
  ],
  'supplier-b': [
    { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
    { hotelId: 'b2', name: 'Holtin', price: 6900, city: 'mumbai', commissionPct: 16 },
  ],
};
