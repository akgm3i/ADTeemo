import type { ErrorCategory } from "../../lib/logger/mod.ts";

export interface RecordedRequestFailure {
  error: unknown;
  errorCategory: ErrorCategory;
}

const failures = new WeakMap<Request, RecordedRequestFailure>();

export function recordRequestFailure(
  request: Request,
  error: unknown,
  errorCategory: ErrorCategory = "unexpected",
): void {
  failures.set(request, { error, errorCategory });
}

export function takeRequestFailure(
  request: Request,
): RecordedRequestFailure | undefined {
  const failure = failures.get(request);
  failures.delete(request);
  return failure;
}
