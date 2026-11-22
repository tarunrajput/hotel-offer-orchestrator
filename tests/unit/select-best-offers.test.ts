import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { SupplierOffer } from '../../src/modules/suppliers/supplier.types';
import { selectBestOffers } from '../../src/modules/hotel-search/utils/select-best-offers';

const a: SupplierOffer = {
  hotelId: 'a1',
  name: 'Holtin',
  price: 6000,
  city: 'delhi',
  supplier: 'supplier-a',
  commissionPct: 10,
};
const b: SupplierOffer = {
  hotelId: 'b1',
  name: ' holtin ',
  price: 5340,
  city: 'delhi',
  supplier: 'supplier-b',
  commissionPct: 20,
};

test('keeps the winning offer fields and hotels offered by only one supplier', () => {
  const unique = { ...a, hotelId: 'a2', name: 'Radison', price: 5900, commissionPct: 13 };
  deepStrictEqual(selectBestOffers([a, unique, b]), [
    { name: b.name, price: 5340, supplier: 'Supplier B', commissionPct: 20 },
    { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
  ]);
});

test('resolves price ties by supplier and then by ID, regardless of encounter order', () => {
  const samePrice = { ...b, price: a.price };
  const sameSupplier = { ...a, hotelId: 'a0', commissionPct: 12 };
  const expected = [{ name: 'Holtin', price: 6000, supplier: 'Supplier A', commissionPct: 12 }];
  deepStrictEqual(selectBestOffers([samePrice, a, sameSupplier]), expected);
  deepStrictEqual(selectBestOffers([sameSupplier, a, samePrice]), expected);
});

test('matches equivalent Unicode names and keeps punctuation meaningful', () => {
  const offers = [
    { ...a, name: 'Café Inn' },
    { ...b, name: 'Cafe\u0301 Inn' },
    { ...a, hotelId: 'a2', name: 'Café-Inn' },
  ];
  deepStrictEqual(
    selectBestOffers(offers).map(({ name }) => name),
    ['Cafe\u0301 Inn', 'Café-Inn'],
  );
  deepStrictEqual(selectBestOffers([]), []);
});
