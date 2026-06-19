/**
 * ============================================================
 *  reliable-search.ts — Main Orchestrator
 * ============================================================
 *  The public API entry point. Handles:
 *  - Provider resolution (explicit → env-var auto-detect → default)
 *  - Cache lookup/miss
 *  - Fallback chain execution
 *  - Result caching
 */

import type {
  SearchProvider,
  SearchParams,
  ReliableSearchOptions,
  ReliableSearchResult,
  UnifiedSearchResult,
} from './types.js';
import { registry } from './providers/registry.js';
import { executeWithFallback } from './resilience/fallback-chain.js';
import { SearchCache } from './cache.js';

/** Shared global cache */
let _cache: SearchCache | null = null;

function cache(): SearchCache {
  if (!_cache) _cache = new SearchCache();
  return _cache;
}

/**
 * Perform a reliable web search with automatic provider fallback.
 *
 * ## Zero-config usage:
 * ```ts
 * const result = await reliableSearch('your query');
 * // Uses DuckDuckGo by default (no API key needed)
 * ```
 *
 * ## With API keys set as env vars:
 * ```bash
 * export BRAVE_API_KEY="xxx"
 * export BOCHA_API_KEY="yyy"
 * ```
 * ```ts
 * const result = await reliableSearch('your query');
 * // Auto-detects Brave → Bocha → DuckDuckGo
 * ```
 *
 * ## Explicit provider chain:
 * ```ts
 * const result = await reliableSearch('your query', {
 *   providers: ['gemini', 'tavily', 'duckduckgo'],
 * });
 * ```
 */
export async function reliableSearch(
  query: string,
  options?: ReliableSearchOptions,
): Promise<ReliableSearchResult> {
  // ── Cache check ─────────────────────────────────────
  const cacheCfg = options?.cache;
  const useCache = cacheCfg?.enabled !== false;
  if (useCache) {
    const key = SearchCache.key(query, {
      count: options?.count,
      country: options?.country,
      language: options?.language,
      freshness: options?.freshness,
      providers: options?.providers?.join(','),
    });
    const hit = options?.cache?.enabled !== false ? cache().get(key) : undefined;
    if (hit) {
      return {
        results: hit.results,
        provider: hit.provider,
        providerPath: hit.providerPath,
        attempts: hit.attempts,
        elapsedMs: 0, // cached
      };
    }
  }

  // ── Resolve providers ───────────────────────────────
  const providers = resolveProviders(options);

  // ── Build search params ─────────────────────────────
  const searchParams: SearchParams = {
    query: query.trim(),
    count: options?.count ?? 5,
    country: options?.country,
    language: options?.language,
    freshness: options?.freshness,
    signal: options?.signal,
  };

  // ── Execute with fallback ───────────────────────────
  const raw = await executeWithFallback(providers, searchParams, options);

  const result: ReliableSearchResult = {
    results: raw.results.slice(0, searchParams.count),
    provider: raw.provider,
    providerPath: raw.providerPath,
    fallbackReason: raw.fallbackReason,
    attempts: raw.attempts,
    elapsedMs: raw.elapsedMs,
  };

  // ── Cache store ─────────────────────────────────────
  if (useCache) {
    const key = SearchCache.key(query, {
      count: options?.count,
      country: options?.country,
      language: options?.language,
      freshness: options?.freshness,
      providers: options?.providers?.join(','),
    });
    cache().set(key, {
      results: result.results,
      provider: result.provider,
      providerPath: result.providerPath,
      attempts: result.attempts,
    });
  }

  return result;
}

/**
 * Resolve the ordered list of providers to use.
 * Priority: explicit list → env-var auto-detect → all registered
 */
function resolveProviders(options?: ReliableSearchOptions): SearchProvider[] {
  const all = registry.list();

  if (options?.providers && options.providers.length > 0) {
    // Explicit provider list — look them up by id
    const ordered = options.providers
      .map((id) => all.find((p) => p.id === id))
      .filter((p): p is SearchProvider => Boolean(p));

    if (ordered.length === 0) {
      throw new Error(
        `No registered providers matched: [${options.providers.join(', ')}]. ` +
        `Available: [${all.map((p) => p.id).join(', ')}]`
      );
    }

    return ordered;
  }

  // Auto-detect: providers with credentials → keyless providers
  const detected = registry.detect();
  if (detected.length > 0) return detected;

  // Shouldn't happen if DuckDuckGo is registered, but be safe
  return all;
}
