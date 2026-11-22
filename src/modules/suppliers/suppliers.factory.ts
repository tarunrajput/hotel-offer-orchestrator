import { SupplierHttpClient } from './supplier-http.client';
import type { SupplierClients } from './supplier.types';

export function createSupplierClients(env: NodeJS.ProcessEnv = process.env): SupplierClients {
  return {
    'supplier-a': new SupplierHttpClient('supplier-a', readEndpoint(env, 'SUPPLIER_A_URL')),
    'supplier-b': new SupplierHttpClient('supplier-b', readEndpoint(env, 'SUPPLIER_B_URL')),
  };
}

function readEndpoint(env: NodeJS.ProcessEnv, key: string): URL {
  const value = env[key];
  if (!value) throw new Error(key + ' is required');
  const url = URL.parse(value);
  if (!url?.hostname || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error(key + ' must be an HTTP(S) endpoint URL without embedded credentials or a fragment');
  }
  return url;
}
