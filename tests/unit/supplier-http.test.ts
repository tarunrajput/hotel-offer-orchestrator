import { equal, ok, rejects } from 'node:assert/strict';
import { test } from 'node:test';
import { SupplierHttpClient } from '../../src/modules/suppliers/supplier-http.client';
import { SupplierRequestFailure } from '../../src/modules/suppliers/supplier.types';

const client = new SupplierHttpClient('supplier-a', new URL('https://supplier.example/hotels'));
const listing = { hotelId: '1', name: 'Hotel', city: 'delhi', price: 100, commissionPct: 10 };

const invalidResponse = (error: unknown) => {
  ok(error instanceof SupplierRequestFailure);
  equal(error.kind, 'invalid-response');
  equal(error.retryable, false);
  return true;
};

test('rejects malformed JSON and invalid rows without retrying', async (t) => {
  for (const body of ['[', '{}', JSON.stringify([{ ...listing, city: 'Delhi' }])]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(body));
    await rejects(client.list('delhi'), invalidResponse);
  }
});
