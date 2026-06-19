/**
 * ============================================================
 *  Bocha (博查) Search Provider — Chinese Web Search
 * ============================================================
 *  Requires: BOCHA_API_KEY environment variable
 *  Free tier available (register at https://open.bochaai.com)
 *  API docs: https://open.bochaai.com/docs
 *
 *  Best choice for Chinese-language internet search.
 *  Also offers AI Search API and Semantic Reranker via separate endpoints.
 */

import type {
  SearchProvider,
  SearchParams,
  ProviderSearchResult,
  UnifiedSearchResult,
} from '../types.js';
import { apiKeyMissing, apiKeyInvalid } from './shared.js';

interface BochaWebPage {
  title: string;
  url: string;
  summary: string;
  sitename?: string;
  date_last_crawled?: string;
}

interface BochaWebResponse {
  code: number;
  message?: string;
  data?: {
    webPages?: {
      value?: BochaWebPage[];
      totalCount?: number;
    };
  };
}

export const bochaProvider: SearchProvider = {
  id: 'bocha',
  name: 'Bocha (博查)',
  requiresKey: true,
  envVars: ['BOCHA_API_KEY'],
  priority: 12,  // premium — Chinese web search
  capabilities: {
    fullWebSearch: true,
    aiGenerated: false,
    maxResults: 50,
    freshnessSupport: false,
    experimental: true,  // API contract not yet verified against real responses
  },

  async search(params: SearchParams): Promise<ProviderSearchResult> {
    const apiKey = process.env.BOCHA_API_KEY;
    if (!apiKey) {
      throw new Error(apiKeyMissing('bocha'));
    }

    // Bocha Web Search API endpoint
    const url = 'https://api.bochaai.com/v1/web/search';
    const body = {
      query: params.query,
      count: Math.min(params.count, 50),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(apiKeyInvalid('bocha'));
    }
    if (res.status === 429) {
      throw new Error(`Bocha rate limited (HTTP 429)`);
    }
    if (!res.ok) {
      throw new Error(`Bocha returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as BochaWebResponse;
    if (data.code !== 200) {
      throw new Error(`Bocha API error (code ${data.code}): ${data.message ?? 'unknown'}`);
    }

    const bochaResults = data.data?.webPages?.value ?? [];
    return {
      results: bochaResults.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.summary,
        publishedAt: r.date_last_crawled,
      })),
    };
  },

  normalize(raw: ProviderSearchResult, _query: string): UnifiedSearchResult[] {
    return raw.results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      provider: 'bocha',
      publishedAt: item.publishedAt,
    }));
  },
};
