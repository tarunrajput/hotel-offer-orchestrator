export const supplierLabels = {
  'supplier-a': 'Supplier A',
  'supplier-b': 'Supplier B',
} as const;

export type Supplier = keyof typeof supplierLabels;

export interface SupplierListing {
  hotelId: string;
  name: string;
  city: string;
  price: number;
  commissionPct: number;
}

export interface SupplierOffer extends SupplierListing {
  supplier: Supplier;
}

/** Clients normalize and validate provider responses before returning listings. */
export interface SupplierClient {
  list(city: string, cancellation?: AbortSignal): Promise<SupplierListing[]>;
  probe(): Promise<void>;
}

export type SupplierClients = Readonly<Record<Supplier, SupplierClient>>;

export type SupplierFailureKind = 'timeout' | 'unavailable' | 'invalid-response';

export class SupplierRequestFailure extends Error {
  constructor(
    readonly kind: SupplierFailureKind,
    readonly retryable: boolean,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'SupplierRequestFailure';
  }
}

export function isPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isCommissionPct(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}
