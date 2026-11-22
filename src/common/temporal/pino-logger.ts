import { context, isSpanContextValid, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { DefaultLogger } from '@temporalio/worker';
import type { Logger } from 'pino';

const severity = { TRACE: 'trace', DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' } as const;

export function createTemporalLogger(logger: Pick<Logger, (typeof severity)[keyof typeof severity]>): DefaultLogger {
  return new DefaultLogger('TRACE', ({ level, message, meta }) => {
    const attributes = { ...meta };
    delete attributes.taskToken;
    delete attributes.task_token;
    const write = () => logger[severity[level]](attributes, message);
    const { trace_id: traceId, span_id: spanId, trace_flags: traceFlags } = attributes;
    if (typeof traceId === 'string' && typeof spanId === 'string' && typeof traceFlags === 'string') {
      const span = { traceId, spanId, traceFlags: Number.parseInt(traceFlags, 16) };
      if (isSpanContextValid(span)) {
        // Temporal forwards logs asynchronously. Restore the captured context for OTLP log correlation.
        context.with(trace.setSpanContext(ROOT_CONTEXT, span), write);
        return;
      }
    }
    write();
  });
}
