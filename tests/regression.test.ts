/**
 * ============================================================
 *  Regression Tests — P0 issues to fix
 * ============================================================
 *  These tests currently FAIL by design. Phase 1-9 fixes them.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { SearchProvider, SearchParams, ProviderSearchResult, UnifiedSearchResult } from '../src/types.js';
import { executeWithFallback, breakerRegistry } from '../src/resilience/fallback-chain.js';
import { CircuitBreaker } from '../src/resilience/circuit-breaker.js';

// ── Helpers ──────────────────────────────────────────

function makeProvider(
  id: string,
  opts: {
    behavior?: 'success' | 'fail' | 'missing_key' | 'rate_limit' | 'empty_results';
    results?: UnifiedSearchResult[];
    delayMs?: number;
    abortSignalCapture?: { signal: AbortSignal | null };
  } = {},
): SearchProvider {
  return {
    id,
    name: id.toUpperCase(),
    requiresKey: id !== 'duckduckgo',
    envVars: id !== 'duckduckgo' ? [`${id.toUpperCase()}_API_KEY`] : [],
    async search(params: SearchParams): Promise<ProviderSearchResult> {
      opts.abortSignalCapture && (opts.abortSignalCapture.signal = params.signal ?? null);
      
      if (opts.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, opts.delayMs);
          params.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      
      if (opts.behavior === 'fail') throw new Error(`${id} internal error`);
      if (opts.behavior === 'missing_key') throw new Error(`missing_api_key: ${id} requires an API key`);
      if (opts.behavior === 'rate_limit') throw new Error(`${id} rate limited (HTTP 429)`);
      if (opts.behavior === 'empty_results') {
        return { results: [] }; // ⬅️ Real empty results, not fake "No results"
      }
      
      const r = opts.results ?? [{
        title: `${id} result`, url: `https://${id}.example.com`,
        snippet: `Result from ${id}`, provider: id,
      }];
      return { results: r.map((item) => ({ title: item.title, url: item.url, snippet: item.snippet })) };
    },
    normalize(raw: ProviderSearchResult): UnifiedSearchResult[] {
      return raw.results.map((item) => ({ ...item, provider: id }));
    },
  };
}

// ── P0-1: DuckDuckGo empty results MUST trigger fallback ──

describe('REGRESSION: empty results trigger fallback', () => {
  beforeEach(() => breakerRegistry.resetAll());
  
  it('empty results from first provider should fall through to second', async () => {
    const ddg = makeProvider('duckduckgo', { behavior: 'empty_results' });
    const brave = makeProvider('brave', { behavior: 'success' });
    const result = await executeWithFallback([ddg, brave], { query: 'test', count: 5 });
    assert.equal(result.provider, 'brave', 'should fall back to brave when DDG returns empty');
    assert.ok(result.results.length > 0);
  });
});

// ── P0-2: Race mode must truly cancel losers ─────────

describe('REGRESSION: race mode cancels loser requests', () => {
  beforeEach(() => breakerRegistry.resetAll());
  
  it('race mode should cancel slow loser via AbortSignal', async () => {
    const loserSignal = { signal: null as AbortSignal | null };
    const fast = makeProvider('brave', { behavior: 'success' });
    const slow = makeProvider('tavily', { delayMs: 500, abortSignalCapture: loserSignal });
    
    const result = await executeWithFallback([fast, slow], { query: 'test', count: 5 }, {
      fallback: { mode: 'parallel' }, // current name for race
    });
    
    assert.equal(result.provider, 'brave');
    // ⬅️ The loser should have been aborted. Current code does NOT abort it.
    assert.ok(loserSignal.signal, 'slow provider should have received an AbortSignal');
  });
});

// ── P0-3: Breaker config must reach instances ────────

describe('REGRESSION: breaker config reaches instances', () => {
  it('custom failureThreshold should be used', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 2 });
    cb.recordFailure();
    assert.equal(cb.state, 'closed');
    cb.recordFailure();
    assert.equal(cb.state, 'open', 'should trip at threshold=2, not default 3');
  });

  it('custom recoveryTimeout should be used', async () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1, recoveryTimeout: 100 });
    cb.recordFailure();
    assert.equal(cb.state, 'open');
    await new Promise(r => setTimeout(r, 150));
    assert.equal(cb.allowRequest(), true, 'should be half-open after recovery timeout');
    assert.equal(cb.state, 'half_open');
  });
});

// ── P0-4: 401 NOT retryable, NOT breaker failure ─────

describe('REGRESSION: 401/403 should not retry or trip breaker', () => {
  it('HTTP 401 should be classified as auth_failed, not retryable', async () => {
    const { classifyError } = await import('../src/resilience/error-classify.js');
    const result = classifyError({ status: 401, message: 'Unauthorized' }, 'test');
    assert.equal(result.category, 'auth_failed');
    assert.equal(result.retryable, false);
  });
  
  it('HTTP 500 should be classified as server_error, retryable', async () => {
    const { classifyError } = await import('../src/resilience/error-classify.js');
    const result = classifyError({ status: 500, message: 'Internal Server Error' }, 'test');
    assert.equal(result.category, 'server_error');
    assert.equal(result.retryable, true);
  });
  
  it('no_results should not trip circuit breaker', async () => {
    const { classifyError } = await import('../src/resilience/error-classify.js');
    const result = classifyError(new Error('no_results'), 'test');
    assert.equal(result.category, 'no_results', 'empty results should be no_results category');
    assert.equal(result.shouldBreakerTrip, false, 'empty results should NOT trip breaker');
    assert.equal(result.retryable, false);
  });
});
