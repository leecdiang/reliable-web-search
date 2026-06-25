/**
 * ============================================================
 *  Metaso (秘塔) AI Search Provider — Chinese AI Search
 * ============================================================
 *  Requires: METASO_API_KEY environment variable
 *  Register: https://metaso.cn
 *  API docs: https://metaso.cn/subject/8547516269457154048
 *
 *  Chinese AI-native search engine. Returns AI-synthesized
 *  answers with citations. Excellent for complex Chinese queries.
 */

import type { ProviderExecutionContext, 
  SearchProvider,
  SearchParams,
  ProviderSearchResult,
  UnifiedSearchResult,
} from '../types.js';
import { apiKeyMissing, apiKeyInvalid } from './shared.js';

interface MetasoResponse {
  answer?: string;
  sources?: Array<{
    title: string;
    url: string;
    snippet?: string;
  }>;
}

export const metasoProvider: SearchProvider = {
  id: 'metaso',
  name: 'Metaso (秘塔)',
  requiresKey: true,
  envVars: ['METASO_API_KEY'],
  priority: 15,  // premium — Chinese AI search
  capabilities: {
    fullWebSearch: false,
    aiGenerated: true,
    maxResults: 20,
    freshnessSupport: false,
    experimental: true,  // API contract not yet verified against real responses
  },

  async search(params: SearchParams, ctx?: ProviderExecutionContext): Promise<ProviderSearchResult> {
    const apiKey = ctx?.apiKey ?? process.env.METASO_API_KEY;
    if (!apiKey) {
      throw new Error(apiKeyMissing('metaso'));
    }

    const url = 'https://api.metaso.cn/v1/search';
    const body = {
      query: params.query,
      top_k: params.count,
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
      throw new Error(apiKeyInvalid('metaso'));
    }
    if (res.status === 429) {
      throw new Error(`Metaso rate limited (HTTP 429)`);
    }
    if (!res.ok) {
      throw new Error(`Metaso returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as MetasoResponse;
    const sources = data.sources ?? [];
    return {
      results: sources.map((s) => ({
        title: s.title,
        url: s.url,
        snippet: s.snippet ?? '',
      })),
    };
  },

  normalize(raw: ProviderSearchResult, _query: string): UnifiedSearchResult[] {
    return raw.results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      provider: 'metaso',
    }));
  },
};
