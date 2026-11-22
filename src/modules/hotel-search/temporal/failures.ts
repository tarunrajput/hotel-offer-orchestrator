import { ActivityFailure, ApplicationFailure, TimeoutFailure, TimeoutType } from '@temporalio/common';

export const temporalFailure = {
  supplierTimeout: 'SupplierTimeout',
  supplierUnavailable: 'SupplierUnavailable',
  supplierInvalidResponse: 'SupplierInvalidResponse',
  upstreamFailure: 'UpstreamFailure',
  upstreamTimeout: 'UpstreamTimeout',
  snapshotFailure: 'SnapshotFailure',
  temporalUnavailable: 'TemporalUnavailable',
} as const;

export function classifySupplierFailures(reasons: readonly unknown[]) {
  const causes = reasons.map((reason) => (reason instanceof ActivityFailure ? reason.cause : reason));
  if (causes.some((cause) => cause instanceof TimeoutFailure && cause.timeoutType === TimeoutType.SCHEDULE_TO_START)) {
    return temporalFailure.temporalUnavailable;
  }
  const timedOut = causes.some(isSupplierTimeout);
  return timedOut ? temporalFailure.upstreamTimeout : temporalFailure.upstreamFailure;
}

function isSupplierTimeout(cause: unknown): boolean {
  if (
    cause instanceof TimeoutFailure &&
    (cause.timeoutType === TimeoutType.START_TO_CLOSE || cause.timeoutType === TimeoutType.SCHEDULE_TO_CLOSE)
  ) {
    return true;
  }
  return cause instanceof ApplicationFailure && cause.type === temporalFailure.supplierTimeout;
}
