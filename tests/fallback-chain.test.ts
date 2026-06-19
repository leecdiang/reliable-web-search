/**
 * ============================================================
 *  Fallback Chain Tests (mock providers, no real API calls)
 * ============================================================
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { SearchProvider, SearchParams, ProviderSearchResult, UnifiedSearchResult } from '../src/types.js';
import { executeWithFallback, breakerRegistry } from '../src/resilience/fallback-chain.js';

// ── Mock Helpers ─────────────────────────────────────

function makeProvider(
  id: string,
  behavior: 'success' | 'fail' | 'missing_key' | 'rate_limit' | 'slow',
  results?: UnifiedSearchResult[],
): SearchProvider {
  const defaultResults: UnifiedSearchResult[] = results ?? [{
    title: `${id} result`,
    url: `https://${id}.example.com`,
    snippet: `Result from ${id}`,
    provider: id,
  }];

  return {
    id,
    name: id.toUpperCase(),
    requiresKey: id !== 'duckduckgo',
    envVars: id !== 'duckduckgo' ? [`${id.toUpperCase()}_API_KEY`] : [],
    async search(_params: SearchParams): Promise<ProviderSearchResult> {
      if (behavior === 'fail') throw new Error(`${id} internal error`);
      if (behavior === 'missing_key') throw new Error(`missing_api_key: ${id} requires an API key`);
      if (behavior === 'rate_limit') throw new Error(`${id} rate limited (HTTP 429)`);
      if (behavior === 'slow') {
        await new Promise((r) => setTimeout(r, 100));
        throw new Error(`Search timed out after 50ms`);
      }
      return {
        results: defaultResults.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
      };
    },
    normalize(raw: ProviderSearchResult, _query: string): UnifiedSearchResult[] {
      return raw.results.map((item, i) => ({ ...item, provider: this.id }));
    },
  };
}

// ── Tests ────────────────────────────────────────────

describe('executeWithFallback — sequential mode', () => {
  beforeEach(() => {
    breakerRegistry.resetAll();
  });
  it('returns first provider result when it succeeds', async () => {
    const p1 = makeProvider('brave', 'success');
    const p2 = makeProvider('tavily', 'success');
    const result = await executeWithFallback([p1, p2], { query: 'test', count: 5 });
    assert.equal(result.provider, 'brave');
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.provider, 'brave');
    assert.deepEqual(result.providerPath, ['brave']);
  });

  it('falls back to second provider when first fails', async () => {
    const p1 = makeProvider('brave', 'fail');
    const p2 = makeProvider('tavily', 'success');
    const result = await executeWithFallback([p1, p2], { query: 'test', count: 5 }, {
      fallback: { maxRetries: 0 },
    });
    assert.equal(result.provider, 'tavily');
    assert.deepEqual(result.providerPath, ['brave', 'tavily']);
  });

  it('falls back on missing credentials', async () => {
    const p1 = makeProvider('brave', 'missing_key');
    const p2 = makeProvider('tavily', 'success');
    const result = await executeWithFallback([p1, p2], { query: 'test', count: 5 }, {
      fallback: { maxRetries: 0 },
    });
    assert.equal(result.provider, 'tavily');
  });

  it('retries on rate limit then falls back', async () => {
    const p1 = makeProvider('brave', 'rate_limit');
    const p2 = makeProvider('tavily', 'success');
    const result = await executeWithFallback([p1, p2], { query: 'test', count: 5 }, {
      fallback: { maxRetries: 1 },
    });
    assert.equal(result.provider, 'tavily');
    assert.equal(result.attempts['brave'], 2); // initial + 1 retry
  });

  it('throws when all providers fail', async () => {
    const p1 = makeProvider('brave', 'fail');
    const p2 = makeProvider('tavily', 'fail');
    await assert.rejects(
      () => executeWithFallback([p1, p2], { query: 'test', count: 5 }, {
        fallback: { maxRetries: 0 },
      }),
      /All 2 search provider.*exhausted/,
    );
  });

  it('records elapsed time', async () => {
    const p1 = makeProvider('brave-record', 'success');
    const result = await executeWithFallback([p1], { query: 'test', count: 5 });
    assert.ok(result.elapsedMs >= 0);
  });
});

describe('executeWithFallback — parallel mode', () => {
  it('returns first successful result', async () => {
    const fast = makeProvider('brave', 'success');
    const slowThenFail = {
      ...makeProvider('tavily', 'success'),
      async search(params: SearchParams) {
        await new Promise((r) => setTimeout(r, 200));
        return makeProvider('tavily', 'success').search(params);
      },
    };
    const result = await executeWithFallback([fast, slowThenFail], { query: 'test', count: 5 }, {
      fallback: { mode: 'parallel' },
    });
    assert.equal(result.provider, 'brave');
  });
});

describe('executeWithFallback — best-effort mode', () => {
  it('collects all successful results', async () => {
    const p1 = makeProvider('brave', 'success');
    const p2 = makeProvider('tavily', 'success');
    const p3 = makeProvider('gemini', 'fail');
    const result = await executeWithFallback([p1, p2, p3], { query: 'test', count: 5 }, {
      fallback: { mode: 'best-effort' },
    });
    assert.equal(result.results.length, 2); // brave + tavily
    assert.equal(result.provider, 'brave+tavily');
  });
});
