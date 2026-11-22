import { randomUUID } from 'node:crypto';
import { context, propagation, ROOT_CONTEXT, SpanKind } from '@opentelemetry/api';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { durationHistogram, markSpanError, meter, tracer } from '../observability/instruments';

const httpRequestDuration = durationHistogram('http.server.request.duration', 'Duration of HTTP requests');
const searchRequests = meter.createCounter('hotel.search.requests', {
  description: 'Hotel search requests by outcome',
  unit: '{request}',
});
const standardMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'CONNECT', 'OPTIONS', 'TRACE', 'PATCH']);

export function observeHttpRequests(logger: Pick<Logger, 'info'>, searchPath?: string): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    res.set('Request-Id', requestId);
    if (req.path === '/livez') {
      next();
      return;
    }

    const started = performance.now();
    const method = standardMethods.has(req.method) ? req.method : '_OTHER';
    const parent = propagation.extract(ROOT_CONTEXT, req.headers);
    tracer.startActiveSpan(
      method,
      {
        kind: SpanKind.SERVER,
        attributes: { 'http.request.method': method, 'url.scheme': req.protocol, 'hotel.request.id': requestId },
      },
      parent,
      (span) => {
        const requestContext = context.active();
        const finish = () => {
          res.off('close', close);
          record(true);
        };
        const close = () => {
          res.off('finish', finish);
          record(false);
        };
        const record = (finished: boolean) => {
          const route: unknown = req.route?.path;
          const status = finished ? res.statusCode : undefined;
          const completeness = finished ? res.get('Hotel-Offer-Completeness') : undefined;
          const durationMs = performance.now() - started;
          const attributes = {
            'http.request.method': method,
            ...(typeof route === 'string' ? { 'http.route': route } : {}),
            ...(status !== undefined ? { 'http.response.status_code': status } : {}),
          };
          if (typeof route === 'string') span.updateName(method + ' ' + route);
          span.setAttributes(attributes);
          if (completeness) span.setAttribute('hotel.search.completeness', completeness);
          let errorType: string | undefined;
          if (!finished) errorType = 'client_disconnect';
          else if (res.statusCode >= 500) errorType = String(res.statusCode);
          if (errorType) markSpanError(span, errorType);

          context.with(requestContext, () => {
            httpRequestDuration.record(durationMs / 1000, { ...attributes, 'error.type': errorType });
            if (searchPath && route === searchPath) {
              let outcome = 'aborted';
              if (finished) outcome = completeness ?? (res.statusCode < 500 ? 'rejected' : 'failed');
              searchRequests.add(1, { 'hotel.search.outcome': outcome });
            }
            logger.info(
              {
                event: finished ? 'http.request.completed' : 'http.request.aborted',
                requestId,
                method,
                route: typeof route === 'string' ? route : undefined,
                status,
                durationMs,
                completeness,
              },
              'HTTP request',
            );
          });
          span.end();
        };

        res.once('finish', finish);
        res.once('close', close);
        next();
      },
    );
  };
}
