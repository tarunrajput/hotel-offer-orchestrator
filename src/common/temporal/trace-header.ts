import { defaultPayloadConverter, type Headers } from '@temporalio/common';

export const temporalTraceHeader = 'otel.trace-context';

export function readTraceCarrier(payload: Headers[string] | undefined): Record<string, string> {
  if (!payload?.data || payload.data.byteLength > 1024) return {};
  try {
    const value = defaultPayloadConverter.fromPayload<Record<string, unknown> | null>(payload);
    const traceparent = value?.traceparent;
    const tracestate = value?.tracestate;
    return {
      ...(typeof traceparent === 'string' && traceparent.length <= 256 ? { traceparent } : {}),
      ...(typeof tracestate === 'string' && tracestate.length <= 512 ? { tracestate } : {}),
    };
  } catch {
    return {};
  }
}
