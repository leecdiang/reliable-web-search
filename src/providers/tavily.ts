/**
 * ============================================================
 *  Tavily Search Provider — AI-optimized Web Search
 * ============================================================
 *  Requires: TAVILY_API_KEY environment variable
 *  Free tier: 1000 queries/month
 *  Sign up: https://tavily.com
 *
 *  Tailored for AI agents and RAG applications.
 *  Supports search depth and topic filtering.
 */

import type {
  SearchProvider,
  SearchParams,
  ProviderSearchResult,
  UnifiedSearchResult,
} from '../types.js';
import { apiKeyMissing, apiKeyInvalid } from './shared.js';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
  answer?: string;
}

export const tavilyProvider: SearchProvider = {
  id: 'tavily',
  name: 'Tavily',
  requiresKey: true,
  envVars: ['TAVILY_API_KEY'],
  priority: 11,  // premium — AI-optimized web search
  capabilities: {
    fullWebSearch: true,
    aiGenerated: false,
    maxResults: 20,
    freshnessSupport: false,
  },

  async search(params: SearchParams): Promise<ProviderSearchResult> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error(apiKeyMissing('tavily'));
    }

    const url = 'https://api.tavily.com/search';
    const body: Record<string, unknown> = {
      api_key: apiKey,
      query: params.query,
      max_results: Math.min(params.count, 20),
      search_depth: 'basic',
      include_answer: false,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(apiKeyInvalid('tavily'));
    }
    if (res.status === 429) {
      throw new Error(`Tavily rate limited (HTTP 429)`);
    }
    if (!res.ok) {
      throw new Error(`Tavily returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as TavilyResponse;
    const tavilyResults = data.results ?? [];
    return {
      results: tavilyResults.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
        publishedAt: r.published_date,
      })),
    };
  },

  normalize(raw: ProviderSearchResult, _query: string): UnifiedSearchResult[] {
    return raw.results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      provider: 'tavily',
      publishedAt: item.publishedAt,
    }));
  },
};
