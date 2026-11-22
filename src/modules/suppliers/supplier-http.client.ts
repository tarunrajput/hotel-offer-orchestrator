import { context, propagation, SpanKind } from '@opentelemetry/api';
import { durationHistogram, markSpanError, tracer } from '../../common/observability/instruments';
import {
  isCommissionPct,
  isPrice,
  SupplierRequestFailure,
  type Supplier,
  type SupplierClient,
  type SupplierListing,
} from './supplier.types';

const supplierAttemptDuration = durationHistogram(
  'hotel.supplier.request.duration',
  'Duration of supplier HTTP attempts',
);

export class SupplierHttpClient implements SupplierClient {
  constructor(
    private readonly supplier: Supplier,
    private readonly endpoint: URL,
  ) {}

  list(city: string, cancellation?: AbortSignal): Promise<SupplierListing[]> {
    return this.requestOffers(city, 1500, 'search', cancellation);
  }

  async probe(): Promise<void> {
    await this.requestOffers('delhi', 1000, 'health');
  }

  private async requestOffers(
    city: string,
    timeoutMs: number,
    purpose: 'search' | 'health',
    cancellation?: AbortSignal,
  ): Promise<SupplierListing[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set('city', city);
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = cancellation ? AbortSignal.any([timeout, cancellation]) : timeout;

    const attributes = { 'hotel.supplier': this.supplier, 'hotel.supplier.purpose': purpose };
    return tracer.startActiveSpan(
      'GET ' + url.pathname,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          ...attributes,
          'http.request.method': 'GET',
          'server.address': url.hostname,
          'url.path': url.pathname,
        },
      },
      async (span) => {
        const started = performance.now();
        let outcome = 'success';
        try {
          const headers: Record<string, string> = { accept: 'application/json' };
          propagation.inject(context.active(), headers);
          const response = await fetch(url, { signal, redirect: 'error', headers });
          span.setAttribute('http.response.status_code', response.status);
          assertSuccessfulResponse(response);
          return parseListings(await response.json(), city);
        } catch (error) {
          if (cancellation?.aborted) {
            outcome = 'cancelled';
            throw cancellation.reason;
          }
          const failure = classifyRequestFailure(error, timeout.aborted);
          outcome = failure.kind;
          markSpanError(span, outcome);
          throw failure;
        } finally {
          supplierAttemptDuration.record((performance.now() - started) / 1000, {
            ...attributes,
            'hotel.outcome': outcome,
          });
          span.end();
        }
      },
    );
  }
}

function assertSuccessfulResponse(response: Response): void {
  if (response.ok) return;
  void response.body?.cancel().catch(() => undefined);
  const retryable = response.status === 429 || response.status >= 500;
  throw new SupplierRequestFailure(
    retryable ? 'unavailable' : 'invalid-response',
    retryable,
    'Supplier HTTP status ' + response.status,
  );
}

function classifyRequestFailure(error: unknown, timedOut: boolean): SupplierRequestFailure {
  if (error instanceof SupplierRequestFailure) return error;
  if (timedOut) return new SupplierRequestFailure('timeout', true, 'Supplier request timed out', error);
  if (error instanceof SyntaxError) {
    return new SupplierRequestFailure('invalid-response', false, 'Supplier response is invalid JSON', error);
  }
  return new SupplierRequestFailure('unavailable', true, 'Supplier request failed', error);
}

function parseListings(payload: unknown, city: string): SupplierListing[] {
  if (!Array.isArray(payload)) {
    throw new SupplierRequestFailure('invalid-response', false, 'Supplier response must be an array');
  }

  const hotelIds = new Set<string>();
  return payload.map((row: unknown) => {
    if (row === null || typeof row !== 'object') {
      throw new SupplierRequestFailure('invalid-response', false, 'Supplier returned an invalid hotel row');
    }
    const { hotelId, name, city: listedCity, price, commissionPct } = row as Record<string, unknown>;
    if (
      typeof hotelId !== 'string' ||
      !hotelId.trim() ||
      hotelIds.has(hotelId) ||
      typeof name !== 'string' ||
      !name.trim() ||
      listedCity !== city ||
      !isPrice(price) ||
      !isCommissionPct(commissionPct)
    ) {
      throw new SupplierRequestFailure('invalid-response', false, 'Supplier returned an invalid hotel row');
    }
    hotelIds.add(hotelId);
    return { hotelId, name, city, price, commissionPct };
  });
}
