/**
 * ============================================================
 *  SearXNG Provider — Self-hosted meta-search
 * ============================================================
 *  Requires: SEARXNG_BASE_URL environment variable
 *  Setup: https://docs.searxng.org
 *
 *  SearXNG aggregates results from Google, Bing, DuckDuckGo,
 *  Baidu, and more. Privacy-respecting, zero external API key
 *  required. You host it, you control it.
 *
 *  Default endpoint: http://localhost:8080 (if SEARXNG_BASE_URL unset)
 */

import type { ProviderExecutionContext, 
  SearchProvider,
  SearchParams,
  ProviderSearchResult,
  UnifiedSearchResult,
} from '../types.js';

interface SearXNGResult {
  title: string;
  url: string;
  content?: string;
  snippet?: string;
  publishedDate?: string | null;
  engine?: string;
}

interface SearXNGResponse {
  results?: SearXNGResult[];
  errors?: string[];
}

export const searxngProvider: SearchProvider = {
  id: 'searxng',
  name: 'SearXNG',
  // `requiresKey: false` means SearXNG is always available in auto-detect,
  // even without SEARXNG_BASE_URL set (it defaults to localhost:8080).
  // The envVar is a config URL, not an API key.
  requiresKey: false,
  envVars: ['SEARXNG_BASE_URL'],
  priority: 50,  // self-hosted, medium priority
  capabilities: {
    fullWebSearch: true,
    aiGenerated: false,
    maxResults: 30,
    freshnessSupport: true,
  },
  isConfigured(): boolean {
    const url = process.env.SEARXNG_BASE_URL;
    return typeof url === 'string' && url.trim().length > 0;
  },

  async search(params: SearchParams, ctx?: ProviderExecutionContext): Promise<ProviderSearchResult> {
    const baseUrl = process.env.SEARXNG_BASE_URL;
    if (!baseUrl || !baseUrl.trim()) {
      throw new Error('missing_api_key: SearXNG requires SEARXNG_BASE_URL environment variable pointing to your instance.');
    }
    const url = new URL('/search', baseUrl);
    url.searchParams.set('q', params.query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', 'general');
    url.searchParams.set('pageno', '1');
    if (params.language) url.searchParams.set('language', params.language);
    // SearXNG time_range: day, week, month, year
    if (params.freshness) url.searchParams.set('time_range', params.freshness);

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: params.signal,
    });

    if (!res.ok) {
      throw new Error(
        `SearXNG returned HTTP ${res.status}. ` +
        `Make sure SearXNG is running at ${baseUrl} and /search is enabled in settings.yml`
      );
    }

    const data = (await res.json()) as SearXNGResponse;
    if (data.errors?.length) {
      throw new Error(`SearXNG errors: ${data.errors.join(', ')}`);
    }

    const searxResults = data.results ?? [];
    return {
      results: searxResults.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content ?? r.snippet ?? '',
        publishedAt: r.publishedDate ?? undefined,
      })),
    };
  },

  normalize(raw: ProviderSearchResult, _query: string): UnifiedSearchResult[] {
    return raw.results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      provider: 'searxng',
      publishedAt: item.publishedAt,
    }));
  },
};
