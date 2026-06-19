/**
 * ============================================================
 *  Brave Search Provider
 * ============================================================
 *  Requires: BRAVE_API_KEY environment variable
 *  Free tier: 2000 queries/month
 *  Sign up: https://brave.com/search/api/
 *
 *  Supports country, language, freshness, and search_lang.
 */

import type {
  SearchProvider,
  SearchParams,
  ProviderSearchResult,
  UnifiedSearchResult,
} from '../types.js';
import { apiKeyMissing, apiKeyInvalid } from './shared.js';

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

interface BraveResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

export const braveProvider: SearchProvider = {
  id: 'brave',
  name: 'Brave Search',
  requiresKey: true,
  envVars: ['BRAVE_API_KEY'],
  priority: 10,  // premium — full web search with free tier
  capabilities: {
    fullWebSearch: true,
    aiGenerated: false,
    maxResults: 20,
    freshnessSupport: true,
  },

  async search(params: SearchParams): Promise<ProviderSearchResult> {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      throw new Error(apiKeyMissing('brave'));
    }

    const url = buildUrl(params);
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: params.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(apiKeyInvalid('brave'));
    }
    if (res.status === 429) {
      throw new Error(`Brave Search rate limited (HTTP 429)`);
    }
    if (!res.ok) {
      throw new Error(`Brave Search returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as BraveResponse;
    const webResults = data.web?.results ?? [];

    return {
      results: webResults.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
        publishedAt: r.age,
      })),
    };
  },

  normalize(raw: ProviderSearchResult, _query: string): UnifiedSearchResult[] {
    return raw.results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      provider: 'brave',
      publishedAt: item.publishedAt,
    }));
  },
};

function buildUrl(params: SearchParams): string {
  const u = new URL('https://api.search.brave.com/res/v1/web/search');
  u.searchParams.set('q', params.query);
  u.searchParams.set('count', String(Math.min(params.count, 20)));

  if (params.country) u.searchParams.set('country', params.country);
  if (params.language) u.searchParams.set('search_lang', params.language);
  if (params.freshness) {
    // Brave freshness format: pd (past day), pw (past week), pm (past month), py (past year)
    const map: Record<string, string> = {
      day: 'pd', week: 'pw', month: 'pm', year: 'py',
    };
    u.searchParams.set('freshness', map[params.freshness] ?? 'pm');
  }
  // Use extra_snippets for richer results
  u.searchParams.set('extra_snippets', 'true');

  return u.toString();
}
