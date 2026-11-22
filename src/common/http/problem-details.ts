import { trace } from '@opentelemetry/api';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';

export class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'HttpFailure';
  }
}

export function invalidQuery(detail: string): HttpFailure {
  return new HttpFailure(400, 'invalid-query', detail);
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpFailure(404, 'not-found', 'This endpoint does not exist.'));
};

const titles: Record<number, string> = {
  400: 'Invalid query',
  404: 'Not found',
  500: 'Internal server error',
  502: 'Bad gateway',
  503: 'Service unavailable',
  504: 'Gateway timeout',
};

export function createProblemHandler(logger: Pick<Logger, 'error'>): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const problem =
      error instanceof HttpFailure ? error : new HttpFailure(500, 'internal-error', 'An unexpected error occurred.');
    const requestId = String(res.get('Request-Id'));
    if (problem.status >= 500) {
      trace.getActiveSpan()?.setAttribute('hotel.error.code', problem.code);
      logger.error({ event: 'http.request.failed', err: error, requestId, code: problem.code }, 'HTTP request failed');
    }
    res
      .status(problem.status)
      .type('application/problem+json')
      .json({
        type: 'urn:hotel-offer-orchestrator:problem:' + problem.code,
        title: titles[problem.status],
        status: problem.status,
        detail: problem.message,
        requestId,
      });
  };
}
