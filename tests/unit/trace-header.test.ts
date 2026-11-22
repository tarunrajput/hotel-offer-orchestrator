import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import { defaultPayloadConverter } from '@temporalio/common';
import { readTraceCarrier } from '../../src/common/temporal/trace-header';

const traceparent = '00-06b3fd05255a452790a48254f5a40d29-097ab9bf915d4ec1-01';

test('Temporal forwards the W3C trace context fields', () => {
  const payload = defaultPayloadConverter.toPayload({ traceparent, tracestate: 'test=1', baggage: 'other=value' });
  deepStrictEqual(readTraceCarrier(payload), { traceparent, tracestate: 'test=1' });
});

test('absent, oversized, and malformed context leaves Activities observable as separate spans', () => {
  for (const payload of [
    undefined,
    defaultPayloadConverter.toPayload({ traceparent: 'a'.repeat(2048) }),
    defaultPayloadConverter.toPayload({ traceparent: 123 }),
    { data: Uint8Array.from([255]) },
  ]) {
    deepStrictEqual(readTraceCarrier(payload), {});
  }
});
