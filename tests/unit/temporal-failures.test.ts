import { equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { ServiceError, WorkflowFailedError } from '@temporalio/client';
import { ActivityFailure, ApplicationFailure, RetryState, TimeoutFailure, TimeoutType } from '@temporalio/common';
import { classifySupplierFailures, temporalFailure } from '../../src/modules/hotel-search/temporal/failures';
import { mapComparisonFailure } from '../../src/modules/hotel-search/temporal/workflow-runner';
import { SearchFailure } from '../../src/modules/hotel-search/exceptions/search-failure';

function activityTimeout(type: TimeoutType) {
  return new ActivityFailure(
    'Activity failed',
    'fetchSupplierOffers',
    '1',
    RetryState.TIMEOUT,
    'worker',
    new TimeoutFailure('Activity timed out', undefined, type),
  );
}

function workflowFailure(cause: Error) {
  return new WorkflowFailedError('Workflow failed', cause, RetryState.NON_RETRYABLE_FAILURE);
}

function assertCode(error: unknown, code: string) {
  ok(error instanceof SearchFailure);
  equal(error.code, code);
}

for (const [timeout, type, code] of [
  [TimeoutType.SCHEDULE_TO_START, temporalFailure.temporalUnavailable, 'temporal-unavailable'],
  [TimeoutType.START_TO_CLOSE, temporalFailure.upstreamTimeout, 'upstream-timeout'],
  [TimeoutType.SCHEDULE_TO_CLOSE, temporalFailure.upstreamTimeout, 'upstream-timeout'],
  [TimeoutType.HEARTBEAT, temporalFailure.upstreamFailure, 'upstream-failure'],
] as const) {
  test('classifies Activity ' + timeout + ' and maps the resulting workflow failure', () => {
    const classified = classifySupplierFailures([activityTimeout(timeout), new Error('Other supplier failed')]);
    equal(classified, type);
    assertCode(
      mapComparisonFailure(
        workflowFailure(ApplicationFailure.nonRetryable('Both failed', classified)),
        Date.now() + 12_000,
      ),
      code,
    );
  });
}

test('Activity queue exhaustion takes precedence over another supplier timeout in either order', () => {
  const queue = activityTimeout(TimeoutType.SCHEDULE_TO_START);
  const supplier = activityTimeout(TimeoutType.START_TO_CLOSE);
  for (const reasons of [
    [queue, supplier],
    [supplier, queue],
    [queue, queue],
  ]) {
    equal(classifySupplierFailures(reasons), temporalFailure.temporalUnavailable);
  }
});

test('preserves supplier HTTP timeout and invalid-response classifications', () => {
  equal(
    classifySupplierFailures([ApplicationFailure.retryable('HTTP timeout', temporalFailure.supplierTimeout)]),
    temporalFailure.upstreamTimeout,
  );
  equal(
    classifySupplierFailures([ApplicationFailure.nonRetryable('Too large', temporalFailure.supplierInvalidResponse)]),
    temporalFailure.upstreamFailure,
  );
});

test('maps an expired HTTP search deadline before dependency failures', () => {
  assertCode(mapComparisonFailure(new ServiceError('Unavailable'), Date.now() - 1), 'search-timeout');
});

test('maps raw and wrapped gRPC deadlines and unavailable service errors', () => {
  const deadline = Date.now() + 12_000;
  const grpc = Object.assign(new Error('deadline exceeded'), { code: 4, details: 'deadline', metadata: {} });
  assertCode(mapComparisonFailure(grpc, deadline), 'search-timeout');
  assertCode(mapComparisonFailure(new ServiceError('RPC failed', { cause: grpc }), deadline), 'search-timeout');
  assertCode(mapComparisonFailure(new ServiceError('Unavailable'), deadline), 'temporal-unavailable');
  assertCode(
    mapComparisonFailure(
      Object.assign(new Error('Unavailable'), {
        code: 14,
        details: 'unavailable',
        metadata: {},
      }),
      deadline,
    ),
    'temporal-unavailable',
  );
});

test('maps a workflow execution timeout with no worker to a search timeout', () => {
  assertCode(
    mapComparisonFailure(
      workflowFailure(new TimeoutFailure('No worker', undefined, TimeoutType.START_TO_CLOSE)),
      Date.now() + 12_000,
    ),
    'search-timeout',
  );
});

test('maps snapshot failure to Redis unavailability and preserves unexpected errors', () => {
  const deadline = Date.now() + 12_000;
  assertCode(
    mapComparisonFailure(
      workflowFailure(ApplicationFailure.nonRetryable('Save failed', temporalFailure.snapshotFailure)),
      deadline,
    ),
    'redis-unavailable',
  );
  const unknown = new Error('Unexpected');
  equal(mapComparisonFailure(unknown, deadline), unknown);
});
