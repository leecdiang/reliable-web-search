/**
 * Error Classifier — decides retry/fallback/breaker behavior.
 * Updated to handle ProviderError and no_results.
 */
import type { ClassifiedError, ErrorCategory } from '../types.js';
import { isProviderError } from '../types.js';

export function classifyError(error: unknown, _providerId?: string): ClassifiedError {
  // Structured ProviderError — use its metadata directly
  if (isProviderError(error)) {
    const cat: ErrorCategory =
      error.code === 'no_results' ? 'no_results' :
      error.code === 'missing_credentials' ? 'missing_credentials' :
      error.code === 'auth_failed' ? 'auth_failed' :
      error.code === 'rate_limited' ? 'rate_limited' :
      error.code === 'timeout' ? 'timeout' :
      error.status && error.status >= 500 ? 'server_error' :
      error.code === 'network_error' ? 'network_error' :
      error.code === 'parse_error' ? 'parse_error' :
      'unknown';
    return {
      category: cat,
      retryable: error.retryable,
      shouldFallback: true,
      shouldBreakerTrip: error.shouldBreakerTrip,
      original: error,
    };
  }

  const message = extractMessage(error);
  const status = extractStatus(error);

  // Missing credentials
  if (/missing.api.?key|no.api.?key|api.?key.*(required|missing|not.?set)/i.test(message)) {
    return c('missing_credentials', false, true, false, error);
  }
  // Auth failed (401/403)
  if (status === 401 || status === 403 ||
      /unauthorized|forbidden|invalid.*(api.?key|token|auth)/i.test(message)) {
    return c('auth_failed', false, true, false, error);
  }
  // Rate limited — retryable
  if (status === 429 || /rate.?limit|too.?many.?requests/i.test(message)) {
    return c('rate_limited', true, true, true, error);
  }
  // Timeout — retryable
  if (
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') ||
    /timeout|timed.?out/i.test(message)
  ) {
    return c('timeout', true, true, true, error);
  }
  // Server errors (5xx) — retryable
  if (status !== undefined && status >= 500 && status < 600) {
    return c('server_error', true, true, true, error);
  }
  // Network errors — retryable
  if (/fetch.?fail|network.?error|econnrefused|enotfound/i.test(message)) {
    return c('network_error', true, true, true, error);
  }
  // No results — NOT an error, should fallback
  if (/no.?results/i.test(message)) {
    return c('no_results', false, true, false, error);
  }
  // Parse errors
  if (/parse|json|syntax|unexpected.?token/i.test(message)) {
    return c('parse_error', false, true, false, error);
  }
  return c('unknown', false, true, false, error);
}

function c(
  category: ErrorCategory, retryable: boolean,
  shouldFallback: boolean, shouldBreakerTrip: boolean,
  original: unknown,
): ClassifiedError {
  return { category, retryable, shouldFallback, shouldBreakerTrip, original };
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as Record<string, unknown>).message ?? '');
  }
  return String(error ?? '');
}

function extractStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    if (typeof e.statusCode === 'number') return e.statusCode;
    if (typeof e.code === 'number') return e.code;
  }
  return undefined;
}
