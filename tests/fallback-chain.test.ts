/**
 * Fallback Chain Tests (v0.1.1 — updated for new attempt/result APIs)
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { SearchProvider, SearchParams, ProviderSearchResult, UnifiedSearchResult } from '../src/types.js';
import { executeWithFallback, breakerRegistry } from '../src/resilience/fallback-chain.js';

function makeProvider(
  id: string,
  behavior: 'success' | 'fail' | 'missing_key' | 'rate_limit' | 'empty_results',
  results?: UnifiedSearchResult[],
): SearchProvider {
  const defaultResults: UnifiedSearchResult[] = results ?? [{
    title: `${id} result`, url: `https://${id}.example.com`,
    snippet: `Result from ${id}`, provider: id,
  }];
  return {
    id, name: id.toUpperCase(),
    requiresKey: id !== 'duckduckgo',
    envVars: id !== 'duckduckgo' ? [`${id.toUpperCase()}_API_KEY`] : [],
    priority: id === 'duckduckgo' ? 100 : 10,
    capabilities: { fullWebSearch: true, aiGenerated: false, maxResults: 20, freshnessSupport: false },
    async search(_params: SearchParams): Promise<ProviderSearchResult> {
      if (behavior === 'fail') throw new Error(`${id} internal error`);
      if (behavior === 'missing_key') throw new Error(`missing_api_key: ${id} requires an API key`);
      if (behavior === 'rate_limit') throw new Error(`${id} rate limited (HTTP 429)`);
      if (behavior === 'empty_results') return { results: [] };
      return { results: defaultResults.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })) };
    },
    normalize(raw: ProviderSearchResult): UnifiedSearchResult[] {
      return raw.results.map((item) => ({ ...item, provider: id }));
    },
  };
}

describe('executeWithFallback — fallback mode', () => {
  beforeEach(() => breakerRegistry.resetAll());

  it('returns first provider result when it succeeds', async () => {
    const p1 = makeProvider('brave', 'success');
    const p2 = makeProvider('tavily', 'success');
    const r = await executeWithFallback([p1, p2], { query: 'test', count: 5 });
    assert.equal(r.provider, 'brave');
    assert.ok(r.results.length > 0);
  });

  it('falls back to second provider when first fails', async () => {
    const p1 = makeProvider('brave', 'fail');
    const p2 = makeProvider('tavily', 'success');
    const r = await executeWithFallback([p1, p2], { query: 'test', count: 5 }, { fallback: { maxRetries: 0 } });
    assert.equal(r.provider, 'tavily');
  });

  it('falls back on missing credentials', async () => {
    const p1 = makeProvider('brave', 'missing_key');
    const p2 = makeProvider('tavily', 'success');
    const r = await executeWithFallback([p1, p2], { query: 'test', count: 5 }, { fallback: { maxRetries: 0 } });
    assert.equal(r.provider, 'tavily');
  });

  it('falls back on empty results', async () => {
    const ddg = makeProvider('duckduckgo', 'empty_results');
    const brave = makeProvider('brave', 'success');
    const r = await executeWithFallback([ddg, brave], { query: 'test', count: 5 });
    assert.equal(r.provider, 'brave', 'should fallback when first provider returns empty');
  });

  it('retries on rate limit then falls back', async () => {
    const p1 = makeProvider('brave', 'rate_limit');
    const p2 = makeProvider('tavily', 'success');
    const r = await executeWithFallback([p1, p2], { query: 'test', count: 5 }, { fallback: { maxRetries: 1 } });
    assert.equal(r.provider, 'tavily');
    // Attempts is now AttemptRecord[]
    const braveAttempts = r.attempts.filter((a) => a.providerId === 'brave');
    assert.equal(braveAttempts.length, 2, 'initial + 1 retry');
  });

  it('throws when all providers fail', async () => {
    const p1 = makeProvider('brave', 'fail');
    const p2 = makeProvider('tavily', 'fail');
    await assert.rejects(
      () => executeWithFallback([p1, p2], { query: 'test', count: 5 }, { fallback: { maxRetries: 0 } }),
      /All 2 route.*exhausted.*brave.*tavily/,
    );
  });

  it('records elapsed time', async () => {
    const p1 = makeProvider('brave-record', 'success');
    const r = await executeWithFallback([p1], { query: 'test', count: 5 });
    assert.ok(r.elapsedMs >= 0);
  });

  it('returns resultStatus=no_results when empty and no fallback available', async () => {
    const p1 = makeProvider('only-provider', 'empty_results');
    await assert.rejects(
      () => executeWithFallback([p1], { query: 'test', count: 5 }, { fallback: { maxRetries: 0 } }),
      /All 1 route.*exhausted/,
    );
  });
});

describe('executeWithFallback — race mode', () => {
  beforeEach(() => breakerRegistry.resetAll());

  it('returns first successful result', async () => {
    const fast = makeProvider('brave', 'success');
    const slowThenFail: SearchProvider = {
      ...makeProvider('tavily', 'success'),
      async search(params: SearchParams) {
        await new Promise((r) => setTimeout(r, 300));
        return makeProvider('tavily', 'success').search(params);
      },
    };
    const r = await executeWithFallback([fast, slowThenFail], { query: 'test', count: 5 }, {
      fallback: { mode: 'race' },
    });
    assert.equal(r.provider, 'brave');
  });
});

describe('executeWithFallback — aggregate mode', () => {
  beforeEach(() => breakerRegistry.resetAll());

  it('collects all successful results', async () => {
    const p1 = makeProvider('brave', 'success');
    const p2 = makeProvider('tavily', 'success');
    const p3 = makeProvider('gemini', 'fail');
    const r = await executeWithFallback([p1, p2, p3], { query: 'test', count: 5 }, {
      fallback: { mode: 'aggregate' },
    });
    assert.ok(r.results.length >= 2);
    assert.equal(r.provider, 'brave+tavily');
  });
});
