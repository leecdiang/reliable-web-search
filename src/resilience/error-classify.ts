/**
 * ============================================================
 *  Error Classifier — decides retry/fallback behavior
 * ============================================================
 *  Classifies provider errors into categories that drive
 *  the fallback chain's decisions:
 *  - Should we retry this provider?
 *  - Should we fall through to the next one?
 */

import type { ClassifiedError, ErrorCategory } from '../types.js';

/**
 * Classify a thrown error from a provider.
 * Uses heuristics on error message + HTTP status codes to
 * decide the category and fallback behavior.
 */
export function classifyError(
  error: unknown,
  providerId: string,
): ClassifiedError {
  const message = extractMessage(error);
  const status = extractStatus(error);

  // Missing credentials — don't count as failure, just skip
  if (/missing.api.?key|no.api.?key|api.?key.*(required|missing|not.?set)/i.test(message)) {
    return classify('missing_credentials', false, true, error);
  }

  // Auth failed (wrong key) — skip, don't retry
  if (status === 401 || status === 403 ||
      /unauthorized|forbidden|invalid.*(api.?key|token|auth)/i.test(message)) {
    return classify('auth_failed', false, true, error);
  }

  // Rate limited — retry with backoff, fall through if exhausted
  if (status === 429 || /rate.?limit|too.?many.?requests/i.test(message)) {
    return classify('rate_limited', true, true, error);
  }

  // Timeout — retry once
  if (
    error instanceof DOMException && error.name === 'AbortError' ||
    /timeout|timed.?out/i.test(message)
  ) {
    return classify('timeout', true, true, error);
  }

  // Server errors (5xx) — retry, fall through if exhausted
  if (status !== undefined && status >= 500 && status < 600) {
    return classify('server_error', true, true, error);
  }

  // Network errors — retry
  if (/fetch.?fail|network.?error|econnrefused|enotfound/i.test(message)) {
    return classify('network_error', true, true, error);
  }

  // Parse errors — skip (provider response format changed?)
  if (/parse|json|syntax|unexpected.?token/i.test(message)) {
    return classify('parse_error', false, true, error);
  }

  // Unknown — skip for safety
  return classify('unknown', false, true, error);
}

function classify(
  category: ErrorCategory,
  retryable: boolean,
  shouldFallback: boolean,
  original: unknown,
): ClassifiedError {
  return { category, retryable, shouldFallback, original };
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
