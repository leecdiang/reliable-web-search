/**
 * ============================================================
 *  DuckDuckGo Search Provider (Instant Answer API)
 * ============================================================
 *  Zero-config fallback. Uses DuckDuckGo's Instant Answer API
 *  (no API key required). Supports basic web search with
 *  region and safe-search parameters.
 *
 *  Rate limit: ~20 req/min (unofficial, be respectful)
 *  API docs: https://duckduckgo.com/api
 */

import type {
  SearchProvider,
  SearchParams,
  ProviderSearchResult,
  UnifiedSearchResult,
} from '../types.js';

interface DDGRelatedTopic {
  Text?: string;
  FirstURL?: string;
}

interface DDGResponse {
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Heading?: string;
  RelatedTopics?: (DDGRelatedTopic | { Topics?: DDGRelatedTopic[] })[];
}

export const duckduckgoProvider: SearchProvider = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  requiresKey: false,
  envVars: [],

  async search(params: SearchParams): Promise<ProviderSearchResult> {
    const { query, country } = params;
    const url = buildUrl(query, country);

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: params.signal,
    });

    if (!res.ok) {
      throw new Error(`DuckDuckGo returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as DDGResponse;
    return { results: parseResults(data, query) };
  },

  normalize(raw: ProviderSearchResult, _query: string): UnifiedSearchResult[] {
    return raw.results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      provider: 'duckduckgo',
      publishedAt: item.publishedAt,
    }));
  },
};

function buildUrl(query: string, country?: string): string {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  });
  
  // Region code (ISO 3166-1 alpha-2 → DuckDuckGo region)
  if (country) {
    params.set('kl', `${country.toLowerCase()}-${country.toLowerCase()}`);
  }

  return `https://api.duckduckgo.com/?${params.toString()}`;
}

function parseResults(data: DDGResponse, query: string) {
  const results: { title: string; url: string; snippet: string }[] = [];

  // Main abstract (if available)
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || data.AbstractSource || 'Result',
      url: data.AbstractURL,
      snippet: data.AbstractText,
    });
  }

  // Related topics
  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics) {
      // Nested topics (disambiguation)
      if ('Topics' in topic && topic.Topics) {
        for (const sub of topic.Topics) {
          if (sub.Text && sub.FirstURL) {
            results.push({
              title: sub.Text.split(' - ')[0] ?? sub.Text.slice(0, 80),
              url: sub.FirstURL,
              snippet: sub.Text,
            });
          }
        }
      } else if ('Text' in topic && topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(' - ')[0] ?? topic.Text.slice(0, 80),
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
    }
  }

  return results.length > 0
    ? results
    : [
        {
          title: 'No results',
          url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
          snippet: 'DuckDuckGo returned no results for this query.',
        },
      ];
}
