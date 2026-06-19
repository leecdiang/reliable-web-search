/**
 * ============================================================
 *  Fallback Chain — sequential provider failover executor
 * ============================================================
 *  Core resilience engine. Iterates through providers in
 *  priority order, applying circuit breaker checks, retries
 *  with exponential backoff, and error classification to
 *  decide when to fall through to the next provider.
 */

import {
  type SearchProvider,
  type SearchParams,
  type ReliableSearchOptions,
  type UnifiedSearchResult,
} from '../types.js';
import { classifyError } from './error-classify.js';
import { BreakerRegistry, type BreakerOptions } from './circuit-breaker.js';

/** Shared breaker registry across all searches */
export const breakerRegistry = new BreakerRegistry();

/**
 * Execute search with fallback across multiple providers.
 */
export async function executeWithFallback(
  providers: SearchProvider[],
  params: SearchParams,
  opts?: ReliableSearchOptions,
): Promise<{
  results: UnifiedSearchResult[];
  provider: string;
  providerPath: string[];
  attempts: Record<string, number>;
  elapsedMs: number;
  fallbackReason?: string;
}> {
  const startTime = Date.now();
  const providerPath: string[] = [];
  const attempts: Record<string, number> = {};
  const maxRetries = opts?.fallback?.maxRetries ?? 1;
  const timeout = opts?.timeout ?? 15_000;
  const breakerCfg = resolveBreakerConfig(opts?.fallback?.circuitBreaker);
  const mode = opts?.fallback?.mode ?? 'sequential';

  // Parallel mode: fire all at once
  if (mode === 'parallel') {
    return executeParallel(providers, params, opts, startTime);
  }

  // Best-effort mode: fire all, collect all successes
  if (mode === 'best-effort') {
    return executeBestEffort(providers, params, opts, startTime);
  }

  // Sequential mode (default): try one by one
  let lastError: unknown;
  let fallbackReason: string | undefined;

  for (const provider of providers) {
    providerPath.push(provider.id);

    // Circuit breaker check
    if (breakerCfg) {
      const breaker = breakerRegistry.get(provider.id);
      if (!breaker.allowRequest()) {
        fallbackReason = `circuit breaker open for "${provider.id}"`;
        continue;
      }
    }

    // Retry loop
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      attempts[provider.id] = attempt;

      try {
        const result = await withTimeout(
          provider.search(params),
          timeout,
          `Search timed out after ${timeout}ms`,
        );

        // Success!
        const classified = classifyError(result, provider.id);
        if (classified.category === 'missing_credentials') {
          // Provider returned a structured "no key" error
          fallbackReason = `provider "${provider.id}" missing credentials`;
          break; // skip to next provider
        }

        const normalized = provider.normalize(result, params.query);
        if (breakerCfg) {
          breakerRegistry.get(provider.id).recordSuccess();
        }
        return {
          results: normalized,
          provider: provider.id,
          providerPath,
          attempts,
          elapsedMs: Date.now() - startTime,
          fallbackReason,
        };
      } catch (error) {
        lastError = error;
        const classified = classifyError(error, provider.id);

        if (breakerCfg) {
          breakerRegistry.get(provider.id).recordFailure();
        }

        // If not retryable or last attempt, fall through
        if (!classified.retryable || attempt > maxRetries) {
          fallbackReason = `${provider.id}: ${classified.category}`;
          break;
        }

        // Wait with exponential backoff before retry
        const delay = Math.min(2 ** attempt * 200, 5000);
        await sleep(delay);
      }
    }
  }

  // All providers exhausted
  const errMsg = lastError instanceof Error ? lastError.message : String(lastError ?? '');
  throw new Error(
    `All ${providers.length} search provider(s) exhausted. ` +
    `Path: ${providerPath.join(' → ')}. ` +
    `Last error: ${errMsg}`
  );
}

async function executeParallel(
  providers: SearchProvider[],
  params: SearchParams,
  opts: ReliableSearchOptions | undefined,
  startTime: number,
): Promise<{
  results: UnifiedSearchResult[];
  provider: string;
  providerPath: string[];
  attempts: Record<string, number>;
  elapsedMs: number;
}> {
  const timeout = opts?.timeout ?? 15_000;
  const attempts: Record<string, number> = {};

  const promises = providers.map(async (provider) => {
    attempts[provider.id] = 1;
    try {
      const result = await withTimeout(
        provider.search(params),
        timeout,
        `Search timed out after ${timeout}ms`,
      );
      return {
        provider,
        results: provider.normalize(result, params.query),
      };
    } catch {
      return null;
    }
  });

  // Return first success
  const results = await Promise.all(promises);
  for (const r of results) {
    if (r) {
      return {
        results: r.results,
        provider: r.provider.id,
        providerPath: providers.map((p) => p.id),
        attempts,
        elapsedMs: Date.now() - startTime,
      };
    }
  }

  throw new Error(
    `All ${providers.length} search provider(s) failed in parallel mode.`
  );
}

async function executeBestEffort(
  providers: SearchProvider[],
  params: SearchParams,
  opts: ReliableSearchOptions | undefined,
  startTime: number,
): Promise<{
  results: UnifiedSearchResult[];
  provider: string;
  providerPath: string[];
  attempts: Record<string, number>;
  elapsedMs: number;
}> {
  const timeout = opts?.timeout ?? 15_000;
  const attempts: Record<string, number> = {};
  const allResults: UnifiedSearchResult[] = [];
  const successful: string[] = [];

  const promises = providers.map(async (provider) => {
    attempts[provider.id] = 1;
    try {
      const result = await withTimeout(
        provider.search(params),
        timeout,
        `Search timed out after ${timeout}ms`,
      );
      const normalized = provider.normalize(result, params.query);
      allResults.push(...normalized);
      successful.push(provider.id);
    } catch {
      // best-effort: ignore failures
    }
  });

  await Promise.all(promises);

  if (allResults.length === 0) {
    throw new Error(
      `All ${providers.length} search provider(s) failed in best-effort mode.`
    );
  }

  return {
    results: allResults,
    provider: successful.join('+'),
    providerPath: providers.map((p) => p.id),
    attempts,
    elapsedMs: Date.now() - startTime,
  };
}

// ─── Helpers ────────────────────────────────────────────────

function resolveBreakerConfig(
  cfg: NonNullable<ReliableSearchOptions['fallback']>['circuitBreaker'],
): Partial<BreakerOptions> | false {
  if (cfg === false) return false;
  return cfg ?? {}; // default: enabled with defaults
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
