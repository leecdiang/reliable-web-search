/**
 * ============================================================
 *  SerpAPI Provider — Multi-engine search aggregation
 * ============================================================
 *  Requires: SERPAPI_API_KEY environment variable
 *  Plans start at $25/month (1000 searches)
 *  Sign up: https://serpapi.com
 *
 *  Covers 80+ search engines including Google, Baidu, Bing.
 *  Best used as a fallback for engines without public APIs.
 *
 *  Default engine: google. Override via params.country='cn' to
 *  route to Baidu.
 */

import type {
  SearchProvider,
  SearchParams,
  ProviderSearchResult,
  UnifiedSearchResult,
} from '../types.js';
import { apiKeyMissing, apiKeyInvalid } from './shared.js';

interface SerpApiOrganicResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
}

interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
  error?: string;
}

export const serpapiProvider: SearchProvider = {
  id: 'serpapi',
  name: 'SerpAPI',
  requiresKey: true,
  envVars: ['SERPAPI_API_KEY'],
  priority: 30,  // paid only, advanced users
  capabilities: {
    fullWebSearch: true,
    aiGenerated: false,
    maxResults: 100,
    freshnessSupport: false,
  },

  async search(params: SearchParams): Promise<ProviderSearchResult> {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      throw new Error(apiKeyMissing('serpapi'));
    }

    // Pick engine: Baidu for Chinese queries/country, Google default
    const engine = params.country === 'cn' ? 'baidu' : 'google';
    const url = new URL('https://serpapi.com/search');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('engine', engine);
    url.searchParams.set('q', params.query);
    url.searchParams.set('num', String(Math.min(params.count, 20)));
    if (params.country) url.searchParams.set('gl', params.country.toLowerCase());
    if (params.language) url.searchParams.set('hl', params.language);

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: params.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(apiKeyInvalid('serpapi'));
    }
    if (res.status === 429) {
      throw new Error(`SerpAPI rate limited (HTTP 429)`);
    }
    if (!res.ok) {
      throw new Error(`SerpAPI returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as SerpApiResponse;
    if (data.error) {
      throw new Error(`SerpAPI error: ${data.error}`);
    }

    const organic = data.organic_results ?? [];
    return {
      results: organic.map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet,
        publishedAt: r.date,
      })),
    };
  },

  normalize(raw: ProviderSearchResult, _query: string): UnifiedSearchResult[] {
    return raw.results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      provider: 'serpapi',
      publishedAt: item.publishedAt,
    }));
  },
};
