import { metrics, SpanStatusCode, trace, type Span } from '@opentelemetry/api';

const name = 'hotel-offer-orchestrator';
export const tracer = trace.getTracer(name);
export const meter = metrics.getMeter(name);
const histogramBuckets = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

export function durationHistogram(name: string, description: string) {
  return meter.createHistogram(name, {
    unit: 's',
    description,
    advice: { explicitBucketBoundaries: histogramBuckets },
  });
}

export function markSpanError(span: Span, errorType: string): void {
  span.setAttribute('error.type', errorType);
  span.setStatus({ code: SpanStatusCode.ERROR });
}
