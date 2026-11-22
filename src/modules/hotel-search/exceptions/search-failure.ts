export type SearchFailureCode =
  | 'temporal-unavailable'
  | 'redis-unavailable'
  | 'upstream-failure'
  | 'upstream-timeout'
  | 'search-timeout';

export class SearchFailure extends Error {
  constructor(
    readonly code: SearchFailureCode,
    cause?: unknown,
  ) {
    super(code, { cause });
    this.name = 'SearchFailure';
  }
}
