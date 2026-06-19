/**
 * ============================================================
 *  Gemini Search Provider — Google Search Grounding
 * ============================================================
 *  Requires: GEMINI_API_KEY environment variable
 *  Get key: https://aistudio.google.com/apikey
 *
 *  Uses Gemini's Google Search grounding to return AI-
 *  synthesized answers with citations. Not traditional search;
 *  returns one comprehensive answer with source links.
 */

import type {
  SearchProvider,
  SearchParams,
  ProviderSearchResult,
  UnifiedSearchResult,
} from '../types.js';
import { apiKeyMissing, apiKeyInvalid } from './shared.js';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: {
          uri?: string;
          title?: string;
        };
      }>;
    };
  }>;
}

export const geminiProvider: SearchProvider = {
  id: 'gemini',
  name: 'Gemini (Google)',
  requiresKey: true,
  envVars: ['GEMINI_API_KEY'],

  async search(params: SearchParams): Promise<ProviderSearchResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(apiKeyMissing('gemini'));
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // Map freshness to Gemini's grounding time range
    let timeRange: string | undefined;
    if (params.freshness) {
      const map: Record<string, string> = {
        day: '1d', week: '1w', month: '1m', year: '1y',
      };
      timeRange = map[params.freshness];
    }

    const tools: Record<string, unknown>[] = [{
      google_search: {},
    }];

    const body: Record<string, unknown> = {
      contents: [{
        parts: [{ text: params.query }],
      }],
      tools,
      generationConfig: {
        temperature: 0,
      },
    };

    if (timeRange) {
      body.groundingConfig = { timeRange };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(apiKeyInvalid('gemini'));
    }
    if (res.status === 429) {
      throw new Error(`Gemini rate limited (HTTP 429)`);
    }
    if (!res.ok) {
      throw new Error(`Gemini returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text ?? '';
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];

    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // Add AI answer as first "result"
    if (text) {
      results.push({
        title: 'AI Answer',
        url: `https://www.google.com/search?q=${encodeURIComponent(params.query)}`,
        snippet: text.slice(0, 2000),
      });
    }

    // Add source citations as individual results
    for (const chunk of chunks) {
      if (chunk.web?.uri && chunk.web?.title) {
        results.push({
          title: chunk.web.title,
          url: chunk.web.uri,
          snippet: '',
        });
      }
    }

    return { results };
  },

  normalize(raw: ProviderSearchResult, _query: string): UnifiedSearchResult[] {
    return raw.results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      provider: 'gemini',
    }));
  },
};
