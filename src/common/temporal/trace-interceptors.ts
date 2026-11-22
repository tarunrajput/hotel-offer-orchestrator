import { context, isSpanContextValid, propagation, ROOT_CONTEXT, SpanKind, type SpanContext } from '@opentelemetry/api';
import type { WorkflowClientInterceptor } from '@temporalio/client';
import { ApplicationFailure, defaultPayloadConverter } from '@temporalio/common';
import type { ActivityInterceptorsFactory } from '@temporalio/worker';
import { markSpanError, tracer } from '../observability/instruments';
import { readTraceCarrier, temporalTraceHeader } from './trace-header';

export const traceWorkflowStart: WorkflowClientInterceptor = {
  startWithDetails(input, next) {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    if (!carrier.traceparent) return next(input);
    return next({
      ...input,
      headers: { ...input.headers, [temporalTraceHeader]: defaultPayloadConverter.toPayload(carrier) },
    });
  },
};

export const traceActivity: ActivityInterceptorsFactory = (activity) => {
  let spanContext: SpanContext | undefined;
  return {
    inbound: {
      execute(input, next) {
        const parent = propagation.extract(ROOT_CONTEXT, readTraceCarrier(input.headers[temporalTraceHeader]));
        const { activityType, activityId, attempt, workflowExecution } = activity.info;
        return tracer.startActiveSpan(
          'temporal.activity.' + activityType,
          {
            kind: SpanKind.CONSUMER,
            attributes: {
              'temporal.workflow.id': workflowExecution?.workflowId,
              'temporal.activity.id': activityId,
              'temporal.activity.attempt': attempt,
            },
          },
          parent,
          async (span) => {
            spanContext = span.spanContext();
            try {
              return await next(input);
            } catch (error) {
              if (!activity.cancellationSignal.aborted) {
                const type = error instanceof ApplicationFailure ? error.type : undefined;
                markSpanError(span, type ?? 'activity_failure');
              }
              throw error;
            } finally {
              span.end();
            }
          },
        );
      },
    },
    outbound: {
      getLogAttributes(input, next) {
        const attributes = next(input);
        if (!spanContext || !isSpanContextValid(spanContext)) return attributes;
        return {
          ...attributes,
          trace_id: spanContext.traceId,
          span_id: spanContext.spanId,
          trace_flags: spanContext.traceFlags.toString(16).padStart(2, '0'),
        };
      },
    },
  };
};
