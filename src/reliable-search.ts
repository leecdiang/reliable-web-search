/**
 * reliable-search.ts — Main Orchestrator (v0.1.1)
 */
import type { SearchProvider, SearchParams, ReliableSearchOptions, ReliableSearchResult } from './types.js';
import { registry } from './providers/registry.js';
import { executeWithFallback, executeWithFallbackRoutes } from './resilience/fallback-chain.js';
import { resolveProviderIdsToRoutes } from './config/route-resolver.js';
import { SearchCache } from './cache.js';

let _cache: SearchCache | null = null;
function cache(): SearchCache { if (!_cache) _cache = new SearchCache(); return _cache; }

export async function reliableSearch(
  query: string,
  options?: ReliableSearchOptions,
): Promise<ReliableSearchResult> {
  const useCache = options?.cache?.enabled !== false;
  if (useCache) {
    const key = SearchCache.key(query, {
      count: options?.count,
      country: options?.country,
      language: options?.language,
      freshness: options?.freshness,
      providers: options?.providers?.join(','),
    });
    const hit = cache().get(key);
    if (hit) {
      return {
        results: hit.results,
        provider: hit.provider,
        providerPath: hit.providerPath,
        fallbackReason: undefined,
        attempts: hit.attempts,
        elapsedMs: 0,
        retrievalSucceeded: hit.results.length > 0,
        usableForReview: hit.results.length > 0,
        resultStatus: hit.results.length > 0 ? 'success' : 'no_results',
        cacheHit: true,
      };
    }
  }

  const searchParams: SearchParams = {
    query: query.trim(),
    count: options?.count ?? 5,
    country: options?.country,
    language: options?.language,
    freshness: options?.freshness,
    signal: options?.signal,
  };

  let raw;
  if (options?.providers && options.providers.length > 0) {
    // v1 style: providers string array — expand to routes
    const routes = resolveProviderIdsToRoutes(options.providers);
    raw = await executeWithFallbackRoutes(routes, searchParams, options);
  } else {
    // Auto-detect: try routes first, fall back to v1 provider list
    const { loadConfigV2 } = await import('./config/load.js');
    const { resolveAllRoutes } = await import('./config/route-resolver.js');
    const { config } = loadConfigV2();
    if (config.routes.length > 0) {
      const routes = resolveAllRoutes();
      raw = await executeWithFallbackRoutes(routes, searchParams, options);
    } else {
      const providers = resolveProviders(options);
      raw = await executeWithFallback(providers, searchParams, options);
    }
  }

  const result: ReliableSearchResult = {
    results: raw.results.slice(0, searchParams.count),
    provider: raw.provider,
    providerPath: raw.providerPath,
    fallbackReason: raw.fallbackReason,
    attempts: raw.attempts,
    elapsedMs: raw.elapsedMs,
    retrievalSucceeded: raw.retrievalSucceeded,
    usableForReview: raw.usableForReview,
    resultStatus: raw.resultStatus,
    cacheHit: false,
  };

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

function resolveProviders(options?: ReliableSearchOptions): SearchProvider[] {
  const all = registry.list();

  if (options?.providers && options.providers.length > 0) {
    const resolved = options.providers
      .map((id) => all.find((p) => p.id === id))
      .filter((p): p is SearchProvider => Boolean(p));

    const requested = new Set(options.providers);
    for (const id of options.providers) {
      if (!all.some((p) => p.id === id)) {
        const suggestions = registry.suggest(id);
        const hint = suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(', ')}?`
          : ` Available: [${all.map((p) => p.id).join(', ')}]`;
        throw new Error(`Unknown provider "${id}".${hint}`);
      }
    }

    if (resolved.length === 0) {
      throw new Error(`No registered providers matched. Available: [${all.map((p) => p.id).join(', ')}]`);
    }
    return resolved;
  }

  const detected = registry.detect();
  if (detected.length > 0) return detected;
  return all;
}
