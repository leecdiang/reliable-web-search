/**
 * Fallback Chain v0.1.2 — unified attempt primitive, true AbortController timeout,
 * independent race controllers, immutable attempts.
 */
import type {
  SearchProvider, SearchParams, ReliableSearchOptions,
  UnifiedSearchResult, AttemptRecord, ResultStatus, ProviderExecutionContext,
} from '../types.js';
import type { RouteAttempt } from '../config/route-resolver.js';
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

type AttemptContext = {
  provider: SearchProvider;
  params: SearchParams;
  timeoutMs: number;
  maxRetries: number;
  minResults: number;
  breakerCfg: Partial<BreakerOptions> | false;
  routeId?: string;
  credentialProfile?: string;
  apiKey?: string;
};

// ─── Mode resolution ──────────────────────────────────

type Mode = 'fallback' | 'race' | 'aggregate';

function resolveMode(opts?: ReliableSearchOptions): Mode {
  const raw = opts?.fallback?.mode;
  if (raw === 'race' || raw === 'aggregate' || raw === 'fallback') return raw;
  if (raw === 'sequential') return 'fallback';
  if (raw === 'parallel') return 'race';
  if (raw === 'best-effort') return 'aggregate';
  return 'fallback';
}

function shouldFallbackOn(status: ResultStatus, opts?: ReliableSearchOptions): boolean {
  if (status === 'no_results' || status === 'failed' || status === 'aborted') return true;
  if (status === 'partial') return opts?.fallbackOn?.includes('partial') ?? false;
  return false;
}

function resolveBreakerConfig(opts?: ReliableSearchOptions): Partial<BreakerOptions> | false {
  const cfg = opts?.fallback?.circuitBreaker;
  if (cfg === false) return false;
  return cfg ?? {};
}

// ─── Main Executor ───────────────────────────────────

export async function executeWithFallback(
  providers: SearchProvider[],
  params: SearchParams,
  opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  return executeWithFallbackRoutes(
    providers.map(p => ({ routeId: p.id, provider: p, providerId: p.id })),
    params,
    opts,
  );
}

/**
 * Execute with route-based attempts (v0.4.0).
 * Supports two-layer failover: credential failover → provider fallback.
 */
export async function executeWithFallbackRoutes(
  routes: RouteAttempt[],
  params: SearchParams,
  opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  const mode = resolveMode(opts);
  const ctxs: AttemptContext[] = routes.map(r => ({
    provider: r.provider,
    params,
    timeoutMs: opts?.timeout ?? 15_000,
    maxRetries: opts?.fallback?.maxRetries ?? 1,
    minResults: opts?.minResults ?? 1,
    breakerCfg: resolveBreakerConfig(opts),
    routeId: r.routeId,
    credentialProfile: r.credentialProfile,
    apiKey: r.apiKey,
  }));

  if (mode === 'race') return executeRaceCtx(ctxs, params, opts);
  if (mode === 'aggregate') return executeAggregateCtx(ctxs, params, opts);
  return executeFallbackCtx(ctxs, params, opts);
}

// ═══════════════════════════════════════════════════════
//  Unified attempt primitive — shared by all modes
// ═══════════════════════════════════════════════════════

interface AttemptOutcome {
  record: AttemptRecord;
  results: UnifiedSearchResult[];
  error?: unknown;
}

/**
 * Run one provider call with breaker check, timeout via AbortController,
 * normalize + minResults validation, and error classification.
 */
async function runProviderAttempt(
  ctx: AttemptContext,
  attempt: number,
  outerSignal?: AbortSignal,
): Promise<AttemptOutcome> {
  const t0 = Date.now();
  const pid = ctx.provider.id;
  const routeId = ctx.routeId ?? pid;
  const credProfile = ctx.credentialProfile;

  // Circuit breaker check (only on first attempt)
  if (attempt === 1 && ctx.breakerCfg) {
    const breaker = breakerRegistry.get(pid, ctx.breakerCfg);
    if (!breaker.allowRequest()) {
      return {
        record: { providerId: pid, attempt: 1, status: 'aborted', resultCount: 0, elapsedMs: 0, errorCode: 'circuit_open' },
        results: [],
      };
    }
  }

  // Build AbortController for true timeout (not just Promise.race)
  const attemptController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (ctx.timeoutMs > 0) {
    timeoutId = setTimeout(() => attemptController.abort(new Error(`Search timed out after ${ctx.timeoutMs}ms`)), ctx.timeoutMs);
  }

  // Chain outer signal
  if (outerSignal) {
    if (outerSignal.aborted) { clearTimeout(timeoutId); return abortOutcome(pid, attempt, t0, 'user_cancelled'); }
    outerSignal.addEventListener('abort', () => { clearTimeout(timeoutId); attemptController.abort(outerSignal.reason); }, { once: true });
  }

  const searchSignal = attemptController.signal;

  // Add chained signal to search params
  const searchParams: SearchParams = { ...ctx.params, signal: searchSignal };

  try {
    const execCtx: ProviderExecutionContext = {
      signal: searchSignal,
      apiKey: ctx.apiKey,
      credentialProfileId: ctx.credentialProfile,
    };
    const rawResult = await ctx.provider.search(searchParams, execCtx);
    clearTimeout(timeoutId);

    // Provider returned without throwing — check if signal was aborted during flight
    if (searchSignal.aborted) {
      return abortOutcome(pid, attempt, t0, searchSignal.reason instanceof Error ? searchSignal.reason.message : 'aborted', routeId, credProfile);
    }

    const normalized = ctx.provider.normalize(rawResult, searchParams.query);

    // Empty or below-min-results — treated as no_results/partial
    if (normalized.length === 0 || normalized.length < ctx.minResults) {
      const status: ResultStatus = normalized.length === 0 ? 'no_results' : 'partial';
      return {
        record: { providerId: pid, attempt, status, resultCount: normalized.length, elapsedMs: Date.now() - t0, routeId, credentialProfile: credProfile },
        results: normalized,
      };
    }

    // Success
    if (attempt === 1 && ctx.breakerCfg) breakerRegistry.get(pid, ctx.breakerCfg).recordSuccess();
    return {
      record: { providerId: pid, attempt, status: 'success', resultCount: normalized.length, elapsedMs: Date.now() - t0, routeId, credentialProfile: credProfile },
      results: normalized,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    // Check if it was our timeout abort
    if (error instanceof DOMException && error.name === 'AbortError') {
      return abortOutcome(pid, attempt, t0, 'timeout', routeId, credProfile);
    }

    const classified = classifyError(error, pid);

    // Circuit breaker: only trip on server errors, timeouts, network errors
    if (attempt === 1 && ctx.breakerCfg && classified.shouldBreakerTrip) {
      breakerRegistry.get(pid, ctx.breakerCfg).recordFailure();
    }

    const out: AttemptOutcome = {
      results: [],
      record: {
        providerId: pid, attempt,
        status: 'failed',
        resultCount: 0, elapsedMs: Date.now() - t0,
        errorCode: classified.category,
        httpStatus: extractHttpStatus(error),
        routeId,
        credentialProfile: credProfile,
      },
      error,
    };

    // If retryable and not last attempt, the caller will retry
    if (classified.retryable && attempt <= ctx.maxRetries) {
      out.record.status = 'failed'; // caller will overwrite if retry succeeds
    }

    return out;
  }
}

function abortOutcome(pid: string, attempt: number, t0: number, reason: string, routeId?: string, credProfile?: string): AttemptOutcome {
  return {
    record: { providerId: pid, attempt, status: 'aborted', resultCount: 0, elapsedMs: Date.now() - t0, errorCode: reason, routeId, credentialProfile: credProfile },
    results: [],
  };
}

function extractHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    if (typeof e.statusCode === 'number') return e.statusCode;
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════
//  Fallback mode (sequential) — route-aware with credential failover
// ═══════════════════════════════════════════════════════

async function executeFallback(
  providers: SearchProvider[], params: SearchParams, opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  const ctxs: AttemptContext[] = providers.map(p => ({
    provider: p, params,
    timeoutMs: opts?.timeout ?? 15_000,
    maxRetries: opts?.fallback?.maxRetries ?? 1,
    minResults: opts?.minResults ?? 1,
    breakerCfg: resolveBreakerConfig(opts),
  }));
  return executeFallbackCtx(ctxs, params, opts);
}

async function executeFallbackCtx(
  ctxs: AttemptContext[], params: SearchParams, opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  const startTime = Date.now();
  const providerPath: string[] = [];
  const attempts: AttemptRecord[] = [];
  const maxRetries = opts?.fallback?.maxRetries ?? 1;
  const breakerCfg = resolveBreakerConfig(opts);
  const minResults = opts?.minResults ?? 1;
  let lastErrorCode: string | undefined;

  for (const ctx of ctxs) {
    providerPath.push(ctx.routeId ?? ctx.provider.id);

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const outcome = await runProviderAttempt(ctx, attempt, params.signal);
      attempts.push(outcome.record);

      if (outcome.record.status === 'success') {
        return buildResult(outcome.results, ctx.provider.id, providerPath, attempts, startTime, 'success');
      }

      if (outcome.record.status === 'partial' && !shouldFallbackOn('partial', opts)) {
        return buildResult(outcome.results, ctx.provider.id, providerPath, attempts, startTime, 'partial');
      }

      lastErrorCode = outcome.record.errorCode;

      if (outcome.record.status === 'no_results' || outcome.record.status === 'failed') {
        const classified = outcome.error ? classifyError(outcome.error, ctx.provider.id) : null;

        if (classified) {
          // Credential failover within same provider:
          // rate_limited → check if next route is same provider
          if (classified.category === 'rate_limited') {
            const currentIdx = ctxs.indexOf(ctx);
            const nextCtx = ctxs[currentIdx + 1];
            if (nextCtx && nextCtx.provider.id === ctx.provider.id) {
              break; // let outer loop try next credential
            }
          }
        }

        if (!classified?.retryable || attempt > maxRetries) break;
        if (outcome.error) {
          const delay = Math.min(2 ** attempt * 200, 5000);
          if (params.signal?.aborted) break;
          await sleepWithAbort(delay, params.signal);
          if (params.signal?.aborted) break;
        }
        continue;
      }
      break;
    }
  }

  throw createProviderError({
    providerId: 'all', code: 'all_exhausted',
    message: `All ${ctxs.length} route(s) exhausted. Path: ${providerPath.join(' → ')}. Last: ${lastErrorCode ?? 'unknown'}`,
    retryable: false, shouldBreakerTrip: false,
  });
}

// ═══════════════════════════════════════════════════════
//  Race mode — independent controllers, Promise.any
// ═══════════════════════════════════════════════════════

async function executeRace(
  providers: SearchProvider[], params: SearchParams, opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  const ctxs: AttemptContext[] = providers.map(p => ({
    provider: p, params,
    timeoutMs: opts?.timeout ?? 15_000,
    maxRetries: opts?.fallback?.maxRetries ?? 1,
    minResults: opts?.minResults ?? 1,
    breakerCfg: resolveBreakerConfig(opts),
  }));
  return executeRaceCtx(ctxs, params, opts);
}

async function executeRaceCtx(
  ctxs: AttemptContext[], params: SearchParams, opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  const startTime = Date.now();
  const timeoutMs = opts?.timeout ?? 15_000;
  const breakerCfg = resolveBreakerConfig(opts);
  const minResults = opts?.minResults ?? 1;
  const maxRetries = opts?.fallback?.maxRetries ?? 1;
  const providerPath = ctxs.map((c) => c.routeId ?? c.provider.id);

  const controllers = new Map<string, AbortController>();
  const winnerController = new AbortController();

  const promises = ctxs.map(async (ctx) => {
    const controller = new AbortController();
    controllers.set(ctx.routeId ?? ctx.provider.id, controller);

    winnerController.signal.addEventListener('abort', () => controller.abort(winnerController.signal.reason), { once: true });
    if (params.signal) {
      params.signal.addEventListener('abort', () => controller.abort(params.signal!.reason), { once: true });
    }

    const attemptCtx = { ...ctx, params: { ...params, signal: controller.signal } };
    const outcome = await runProviderAttempt(attemptCtx, 1, controller.signal);

    const isWinner = outcome.record.status === 'success' || (outcome.record.status === 'partial' && !shouldFallbackOn('partial', opts));
    if (isWinner) {
      winnerController.abort(`won by ${ctx.provider.id}`);
    }

    return { routeId: ctx.routeId ?? ctx.provider.id, outcome, isWinner };
  });

  const settled = await Promise.allSettled(promises);

  const attemptsMap = new Map<string, AttemptRecord>();
  let winnerRoute: string | null = null;
  let winnerResults: UnifiedSearchResult[] = [];

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      const { routeId, outcome, isWinner } = s.value;
      attemptsMap.set(routeId, outcome.record);
      if (isWinner && !winnerRoute) {
        winnerRoute = routeId;
        winnerResults = outcome.results;
      }
    }
  }

  const orderedAttempts = providerPath.map((rid) => attemptsMap.get(rid)).filter(Boolean) as AttemptRecord[];

  if (winnerRoute) {
    return buildResult(winnerResults, winnerRoute, providerPath, orderedAttempts, startTime, 'success');
  }

  throw createProviderError({
    providerId: 'all', code: 'all_exhausted',
    message: `All ${ctxs.length} route(s) failed in race mode.`,
    retryable: false, shouldBreakerTrip: false,
  });
}

// ═══════════════════════════════════════════════════════
//  Aggregate mode — collect all, merge results
// ═══════════════════════════════════════════════════════

async function executeAggregate(
  providers: SearchProvider[], params: SearchParams, opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  const ctxs: AttemptContext[] = providers.map(p => ({
    provider: p, params,
    timeoutMs: opts?.timeout ?? 15_000,
    maxRetries: opts?.fallback?.maxRetries ?? 1,
    minResults: opts?.minResults ?? 1,
    breakerCfg: resolveBreakerConfig(opts),
  }));
  return executeAggregateCtx(ctxs, params, opts);
}

async function executeAggregateCtx(
  ctxs: AttemptContext[], params: SearchParams, opts?: ReliableSearchOptions,
): Promise<InternalResult> {
  const startTime = Date.now();
  const timeoutMs = opts?.timeout ?? 15_000;
  const breakerCfg = resolveBreakerConfig(opts);
  const minResults = opts?.minResults ?? 1;
  const maxRetries = opts?.fallback?.maxRetries ?? 1;
  const providerPath = ctxs.map((c) => c.routeId ?? c.provider.id);

  const allResults: UnifiedSearchResult[] = [];
  const attempts: AttemptRecord[] = [];
  const successful: string[] = [];

  const settled = await Promise.allSettled(ctxs.map(async (ctx) => {
    const outcome = await runProviderAttempt(ctx, 1, params.signal);
    return { routeId: ctx.routeId ?? ctx.provider.id, providerId: ctx.provider.id, outcome };
  }));

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      const { providerId, outcome } = s.value;
      attempts.push(outcome.record);
      if (outcome.record.status === 'success' || outcome.record.status === 'partial') {
        allResults.push(...outcome.results);
        successful.push(providerId);
      }
    }
  }

  if (allResults.length === 0) {
    throw createProviderError({
      providerId: 'all', code: 'all_exhausted',
      message: `All ${ctxs.length} route(s) failed in aggregate mode.`,
      retryable: false, shouldBreakerTrip: false,
    });
  }

  const ordered = providerPath.map((rid) => attempts.find((a) => a.routeId === rid)).filter(Boolean) as AttemptRecord[];
  return buildResult(allResults, successful.join('+'), providerPath, ordered, startTime,
    successful.length < ctxs.length ? 'partial' : 'success');
}

// ═══════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════

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

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
