import {
  ApplicationFailure,
  ServiceError,
  TimeoutFailure,
  WorkflowFailedError,
  isGrpcDeadlineError,
  isGrpcServiceError,
  type Client,
} from '@temporalio/client';
import { durationHistogram, markSpanError, tracer } from '../../../common/observability/instruments';
import type { OfferComparison } from '../interfaces/hotel-search.interface';
import { SearchFailure } from '../exceptions/search-failure';
import { temporalFailure } from './failures';
import type { compareHotelOffers } from './workflow';

const workflowDuration = durationHistogram(
  'hotel.workflow.duration',
  'Time spent starting and awaiting a hotel comparison',
);

export const workflowIdFor = (requestId: string): string => 'hotel-search-' + requestId;

export class TemporalWorkflowRunner implements OfferComparison {
  constructor(
    private readonly client: Client,
    private readonly taskQueue: string,
  ) {}

  async compare(city: string, requestId: string, deadline: number) {
    const workflowId = workflowIdFor(requestId);
    return tracer.startActiveSpan(
      'hotel.workflow.compare',
      {
        attributes: { 'temporal.workflow.id': workflowId, 'temporal.workflow.type': 'compareHotelOffers' },
      },
      async (span) => {
        const started = performance.now();
        let outcome = 'failed';
        try {
          const result = await this.client.withDeadline(deadline, () =>
            this.client.workflow.execute<typeof compareHotelOffers>('compareHotelOffers', {
              workflowId,
              taskQueue: this.taskQueue,
              args: [city],
              workflowExecutionTimeout: '10 seconds',
              workflowIdReusePolicy: 'REJECT_DUPLICATE',
            }),
          );
          outcome = result.completeness;
          span.setAttribute('hotel.search.completeness', result.completeness);
          if (result.completeness === 'partial')
            span.setAttribute('hotel.search.failed_supplier', result.failedSupplier);
          return result;
        } catch (error) {
          const mapped = mapComparisonFailure(error, deadline);
          outcome = mapped instanceof SearchFailure ? mapped.code : 'failed';
          markSpanError(span, outcome);
          throw mapped;
        } finally {
          workflowDuration.record((performance.now() - started) / 1000, { 'hotel.outcome': outcome });
          span.end();
        }
      },
    );
  }
}

export function mapComparisonFailure(error: unknown, deadline: number): unknown {
  if (
    Date.now() >= deadline ||
    isGrpcDeadlineError(error) ||
    (error instanceof ServiceError && isGrpcDeadlineError(error.cause))
  ) {
    return new SearchFailure('search-timeout', error);
  }
  if (error instanceof WorkflowFailedError) return mapWorkflowFailure(error);
  if (isGrpcServiceError(error) || error instanceof ServiceError)
    return new SearchFailure('temporal-unavailable', error);
  return error;
}

function mapWorkflowFailure(error: WorkflowFailedError): Error {
  const { cause } = error;
  if (cause instanceof TimeoutFailure) return new SearchFailure('search-timeout', error);
  if (!(cause instanceof ApplicationFailure)) return error;
  switch (cause.type) {
    case temporalFailure.temporalUnavailable:
      return new SearchFailure('temporal-unavailable', error);
    case temporalFailure.upstreamFailure:
      return new SearchFailure('upstream-failure', error);
    case temporalFailure.upstreamTimeout:
      return new SearchFailure('upstream-timeout', error);
    case temporalFailure.snapshotFailure:
      return new SearchFailure('redis-unavailable', error);
  }
  return error;
}
