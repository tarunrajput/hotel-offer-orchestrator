import { deepStrictEqual, equal, ok, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { parseHotelQuery } from '../../src/modules/hotel-search/dto/hotel-query.dto';
import { HttpFailure } from '../../src/common/http/problem-details';

function invalidQuery(error: unknown): boolean {
  ok(error instanceof HttpFailure);
  equal(error.status, 400);
  equal(error.code, 'invalid-query');
  return true;
}

test('normalizes city and accepts optional, inclusive, safe-integer price bounds', () => {
  deepStrictEqual(parseHotelQuery({ city: ' DELHI ' }), {
    city: 'delhi',
    minPrice: undefined,
    maxPrice: undefined,
  });
  deepStrictEqual(parseHotelQuery({ city: 'new-delhi', minPrice: '0', maxPrice: '0' }), {
    city: 'new-delhi',
    minPrice: 0,
    maxPrice: 0,
  });
  equal(
    parseHotelQuery({ city: 'a'.repeat(64), maxPrice: String(Number.MAX_SAFE_INTEGER) }).maxPrice,
    Number.MAX_SAFE_INTEGER,
  );
  equal(parseHotelQuery({ city: 'delhi', minPrice: '005340' }).minPrice, 5340);
  equal(parseHotelQuery({ city: 'delhi', maxPrice: '6000' }).minPrice, undefined);
});

test('rejects missing, repeated, structured, blank, and malformed cities', () => {
  for (const city of [
    undefined,
    null,
    1,
    true,
    [],
    ['delhi'],
    ['delhi', 'mumbai'],
    {},
    '',
    ' ',
    'a'.repeat(65),
    'new delhi',
    '-delhi',
    'delhi-',
    'new--delhi',
    'delhi_1',
    'delhi\0',
    'दिल्ली',
  ]) {
    throws(() => parseHotelQuery({ city }), invalidQuery, String(city));
  }
});

test('rejects unsupported query parameters including misspellings and bracket notation', () => {
  for (const name of [
    'minprice',
    'maxprice',
    'City',
    'supplier',
    'limit',
    'city[]',
    'minPrice[x]',
    'maxPrice[]',
    '__proto__',
    'constructor',
  ]) {
    throws(() => parseHotelQuery({ city: 'delhi', [name]: '1' }), invalidQuery, name);
  }
});

test('rejects invalid prices without silently coercing them', () => {
  for (const name of ['minPrice', 'maxPrice']) {
    for (const value of [
      '',
      ' ',
      '1\n',
      '1\r',
      '1\r\n',
      ' 1',
      '1 ',
      '-1',
      '+1',
      '1.5',
      '1e3',
      '0x10',
      'Infinity',
      'NaN',
      '１２',
      '9007199254740992',
      null,
      1,
      true,
      ['1'],
      ['1', '2'],
      {},
    ]) {
      throws(() => parseHotelQuery({ city: 'delhi', [name]: value }), invalidQuery, name + ': ' + String(value));
    }
  }
});

test('rejects reversed price ranges', () => {
  throws(() => parseHotelQuery({ city: 'delhi', minPrice: '6000', maxPrice: '5000' }), invalidQuery);
});
