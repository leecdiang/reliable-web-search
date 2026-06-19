/**
 * Fallback Chain — sequential provider failover executor (v0.1.1)
 *
 * Modes:
 * - fallback (was 'sequential'): try providers in order, skip on no_results/fail
 * - race (was 'parallel'): fire all, first success wins, cancel losers via AbortController
 * - aggregate (was 'best-effort'): fire all, merge all successes
 *
 * Backward compat: 'sequential'→fallback, 'parallel'→race, 'best-effort'→aggregate
 */

import type {
  SearchProvider, SearchParams, ReliableSearchOptions,
  UnifiedSearchResult, AttemptRecord, ResultStatus,
} from '../types.js';
import { createProviderError } from '../types.js';
import { classifyError } from './error-classify.js';
import { BreakerRegistry, type BreakerOptions } from './circuit-breaker.js';

export const breakerRegistry = new BreakerRegistry();

type InternalResult = {
  results: UnifiedSearchResult[];
  provider: string;
  providerPath: string[];
  attempts: AttemptRecord[];
  elapsedMs: number;
  fallbackReason?: string;
  resultStatus: ResultStatus;
  retrievalSucceeded: boolean;
  usableForReview: boolean;
};

// ─── Mode resolution (with backward compat) ──────────

type Mode = 'fallback' | 'race' | 'aggregate';

function resolveMode(opts?: ReliableSearchOptions): Mode {
  const raw = opts?.fallback?.mode;
  if (raw === 'race' || raw === 'aggregate' || raw === 'fallback') return raw;
  // backward compat
  if (raw === 'sequential') return 'fallback';
  if (raw === 'parallel') return 'race';
  if (raw === 'best-effort') return 'aggregate';
  return 'fallback';
}

function shouldFallbackOn(status: ResultStatus, opts?: ReliableSearchOptions): boolean {
  if (status === 'no_results' || status === 'failed' || status === 'aborted') return true;
  if (status === 'partial') {
    const fallbackOn = opts?.fallbackOn;
    if (fallbackOn?.includes('partial')) return true;
  }
  return false;
}

// ─── Main Executor ───────────────────────────────────

export async function executeWithFallback(
  providers: SearchProvider[],
  params: SearchParams,
  opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  const mode = resolveMode(opts);
  if (mode === 'race') return executeRace(providers, params, opts);
  if (mode === 'aggregate') return executeAggregate(providers, params, opts);
  return executeFallback(providers, params, opts);
}

// ─── Fallback (sequential) ───────────────────────────

async function executeFallback(
  providers: SearchProvider[], params: SearchParams, opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  const startTime = Date.now();
  const providerPath: string[] = [];
  const attempts: AttemptRecord[] = [];
  const maxRetries = opts?.fallback?.maxRetries ?? 1;
  const timeout = opts?.timeout ?? 15_000;
  const breakerCfg = resolveBreakerConfig(opts);
  const minResults = opts?.minResults ?? 1;
  let lastErrorCode: string | undefined;
  let lastHttpStatus: number | undefined;

  for (const provider of providers) {
    providerPath.push(provider.id);

    if (breakerCfg) {
      const breaker = breakerRegistry.get(provider.id);
      if (!breaker.allowRequest()) {
        const rec: AttemptRecord = {
          providerId: provider.id, attempt: 1,
          status: 'aborted', resultCount: 0,
          elapsedMs: 0, errorCode: 'circuit_open',
        };
        attempts.push(rec);
        continue;
      }
    }

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const t0 = Date.now();
      try {
        const result = await withTimeout(provider.search(params), timeout);
        const normalized = provider.normalize(result, params.query);

        // Empty results → treat as no_results, fall through
        if (normalized.length === 0 || normalized.length < minResults) {
          const status: ResultStatus = normalized.length === 0 ? 'no_results' : 'partial';
          const rec: AttemptRecord = {
            providerId: provider.id, attempt, status,
            resultCount: normalized.length, elapsedMs: Date.now() - t0,
          };
          attempts.push(rec);

          if (shouldFallbackOn(status, opts)) {
            lastErrorCode = status;
            break; // fall through to next provider
          }
          // partial but user opted not to fallback → accept
          return buildResult(normalized, provider.id, providerPath, attempts, startTime, status);
        }

        // Success with results
        if (breakerCfg) breakerRegistry.get(provider.id).recordSuccess();
        const rec: AttemptRecord = {
          providerId: provider.id, attempt, status: 'success',
          resultCount: normalized.length, elapsedMs: Date.now() - t0,
        };
        attempts.push(rec);
        return buildResult(normalized, provider.id, providerPath, attempts, startTime, 'success');
      } catch (error) {
        const classified = classifyError(error, provider.id);
        const pe = createProviderError({
          providerId: provider.id,
          code: classified.category,
          message: error instanceof Error ? error.message : String(error),
          status: lastHttpStatus,
          retryable: classified.retryable,
          shouldBreakerTrip: classified.shouldBreakerTrip,
        });

        if (breakerCfg && classified.shouldBreakerTrip) {
          breakerRegistry.get(provider.id).recordFailure();
        }

        lastErrorCode = classified.category;
        const rec: AttemptRecord = {
          providerId: provider.id, attempt, status: 'failed',
          resultCount: 0, elapsedMs: Date.now() - t0,
          errorCode: classified.category, httpStatus: lastHttpStatus,
        };
        attempts.push(rec);

        if (!classified.retryable || attempt > maxRetries) break;
        await sleep(Math.min(2 ** attempt * 200, 5000));
      }
    }
  }

  throw createProviderError({
    providerId: 'all',
    code: 'all_exhausted',
    message: `All ${providers.length} provider(s) exhausted. Path: ${providerPath.join(' → ')}. Last: ${lastErrorCode ?? 'unknown'}`,
    status: lastHttpStatus,
    retryable: false,
    shouldBreakerTrip: false,
  });
}

// ─── Race (was 'parallel') — first wins, losers aborted ──

async function executeRace(
  providers: SearchProvider[], params: SearchParams, opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  const startTime = Date.now();
  const timeout = opts?.timeout ?? 15_000;
  const attempts: AttemptRecord[] = [];
  const providerPath = providers.map((p) => p.id);

  const controller = new AbortController();
  const linkSignal = (signal?: AbortSignal) => {
    if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason));
  };
  linkSignal(params.signal);

  const promises = providers.map(async (provider) => {
    const t0 = Date.now();
    const providerSignal = controller.signal;
    try {
      const result = await withTimeout(
        provider.search({ ...params, signal: providerSignal }),
        timeout,
      );
      const normalized = provider.normalize(result, params.query);
      if (normalized.length > 0) {
        // Cancel losers
        controller.abort(`won by ${provider.id}`);
        const rec: AttemptRecord = {
          providerId: provider.id, attempt: 1, status: 'success',
          resultCount: normalized.length, elapsedMs: Date.now() - t0,
        };
        attempts.push(rec);
        return { winner: true, results: normalized, provider: provider.id };
      }
      const rec: AttemptRecord = {
        providerId: provider.id, attempt: 1, status: 'no_results',
        resultCount: 0, elapsedMs: Date.now() - t0,
      };
      attempts.push(rec);
      return { winner: false, results: [], provider: provider.id };
    } catch (error) {
      const isAbort = (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.message?.includes('Aborted'));
      const classified = classifyError(error, provider.id);
      const rec: AttemptRecord = {
        providerId: provider.id, attempt: 1,
        status: isAbort ? 'aborted' : 'failed',
        resultCount: 0, elapsedMs: Date.now() - t0,
        errorCode: isAbort ? 'cancelled' : classified.category,
      };
      attempts.push(rec);
      return { winner: false, results: [], provider: provider.id };
    }
  });

  // Promise.any: first success wins
  const winner = await Promise.any(
    promises.map(async (p) => {
      const r = await p;
      if (r.winner) return r;
      throw new Error(`provider ${r.provider} did not win`);
    })
  ).catch(() => null);

  if (winner && winner.results.length > 0) {
    return buildResult(winner.results, winner.provider, providerPath, attempts, startTime, 'success');
  }

  throw createProviderError({
    providerId: 'all', code: 'all_exhausted',
    message: `All ${providers.length} provider(s) failed in race mode.`,
    retryable: false, shouldBreakerTrip: false,
  });
}

// ─── Aggregate (was 'best-effort') — merge all ────────

async function executeAggregate(
  providers: SearchProvider[], params: SearchParams, opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  const startTime = Date.now();
  const timeout = opts?.timeout ?? 15_000;
  const attempts: AttemptRecord[] = [];
  const allResults: UnifiedSearchResult[] = [];
  const successful: string[] = [];

  await Promise.all(providers.map(async (provider) => {
    const t0 = Date.now();
    try {
      const result = await withTimeout(provider.search(params), timeout);
      const normalized = provider.normalize(result, params.query);
      allResults.push(...normalized);
      successful.push(provider.id);
      const rec: AttemptRecord = {
        providerId: provider.id, attempt: 1, status: normalized.length > 0 ? 'success' : 'no_results',
        resultCount: normalized.length, elapsedMs: Date.now() - t0,
      };
      attempts.push(rec);
    } catch (error) {
      const classified = classifyError(error, provider.id);
      const rec: AttemptRecord = {
        providerId: provider.id, attempt: 1, status: 'failed',
        resultCount: 0, elapsedMs: Date.now() - t0,
        errorCode: classified.category,
      };
      attempts.push(rec);
    }
  }));

  if (allResults.length === 0) {
    throw createProviderError({
      providerId: 'all', code: 'all_exhausted',
      message: `All ${providers.length} provider(s) failed in aggregate mode.`,
      retryable: false, shouldBreakerTrip: false,
    });
  }

  return buildResult(
    allResults,
    successful.join('+'),
    providers.map((p) => p.id),
    attempts, startTime,
    successful.length < providers.length ? 'partial' : 'success',
  );
}

// ─── Helpers ──────────────────────────────────────────

function buildResult(
  results: UnifiedSearchResult[], provider: string,
  providerPath: string[], attempts: AttemptRecord[],
  startTime: number, resultStatus: ResultStatus,
): InternalResult {
  return {
    results, provider, providerPath, attempts,
    elapsedMs: Date.now() - startTime,
    resultStatus,
    retrievalSucceeded: resultStatus === 'success' || resultStatus === 'partial',
    usableForReview: results.length > 0,
  };
}

function resolveBreakerConfig(opts?: ReliableSearchOptions): Partial<BreakerOptions> | false {
  const cfg = opts?.fallback?.circuitBreaker;
  if (cfg === false) return false;
  return cfg ?? {};
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Search timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try { return await Promise.race([promise, timeoutPromise]); }
  finally { if (timer) clearTimeout(timer); }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
