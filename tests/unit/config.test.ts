import { deepStrictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../../src/config/config';

test('CORS defaults to no allowed origins and reads a comma-separated allowlist', () => {
  deepStrictEqual(readConfig({}).corsOrigins, []);
  deepStrictEqual(readConfig({ CORS_ORIGINS: '' }).corsOrigins, []);
  deepStrictEqual(readConfig({ CORS_ORIGINS: ' http://localhost:5173, https://app.example.com ' }).corsOrigins, [
    'http://localhost:5173',
    'https://app.example.com',
  ]);
});

test('CORS configuration rejects wildcards, opaque origins, and URLs that are not exact HTTP origins', () => {
  for (const origin of [
    '*',
    'null',
    'not-a-url',
    'ftp://example.com',
    'https://example.com/path',
    'https://example.com/',
    'https://example.com?query=1',
    'https://example.com#fragment',
    'https://user:password@example.com',
    'https://example.com,',
  ]) {
    throws(() => readConfig({ CORS_ORIGINS: origin }), /CORS_ORIGINS/, origin);
  }
});
