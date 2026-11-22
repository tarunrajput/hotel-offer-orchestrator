import { supplierLabels, type SupplierOffer } from '../../suppliers/supplier.types';
import type { HotelOffer } from '../interfaces/hotel-offer.interface';

export function selectBestOffers(offers: readonly SupplierOffer[]): HotelOffer[] {
  const winners = new Map<string, SupplierOffer>();

  for (const offer of offers) {
    const normalizedName = offer.name.trim().normalize('NFC').toLowerCase();
    const current = winners.get(normalizedName);
    if (!current || isBetterOffer(offer, current)) {
      winners.set(normalizedName, offer);
    }
  }

  return Array.from(winners.values(), ({ name, price, supplier, commissionPct }) => ({
    name,
    price,
    supplier: supplierLabels[supplier],
    commissionPct,
  }));
}

function isBetterOffer(candidate: SupplierOffer, current: SupplierOffer): boolean {
  if (candidate.price !== current.price) return candidate.price < current.price;
  if (candidate.supplier !== current.supplier) return candidate.supplier === 'supplier-a';
  return candidate.hotelId < current.hotelId;
}
