import type { Headers, WorkflowInterceptorsFactory } from '@temporalio/workflow';
import { readTraceCarrier, temporalTraceHeader } from './trace-header';

// Forward only persisted context inside the Workflow sandbox. Spans are created in Node.js.
export const interceptors: WorkflowInterceptorsFactory = () => {
  let traceContext: Headers[string] | undefined;
  let traceAttributes: Record<string, string> = {};

  return {
    inbound: [
      {
        execute(input, next) {
          traceContext = input.headers[temporalTraceHeader];
          const { traceparent } = readTraceCarrier(traceContext);
          const match = traceparent?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/);
          if (match?.[1] && match[2] && match[3]) {
            traceAttributes = { trace_id: match[1], span_id: match[2], trace_flags: match[3] };
          }
          return next(input);
        },
      },
    ],
    outbound: [
      {
        scheduleActivity(input, next) {
          if (!traceContext) return next(input);
          return next({ ...input, headers: { ...input.headers, [temporalTraceHeader]: traceContext } });
        },
        getLogAttributes(input, next) {
          return { ...next(input), ...traceAttributes };
        },
      },
    ],
  };
};
