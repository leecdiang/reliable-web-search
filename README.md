# reliable-web-search

**Multi-provider web search with automatic fallback, circuit breaking, and zero-config defaults.**

[![npm version](https://img.shields.io/npm/v/reliable-web-search)](https://www.npmjs.com/package/reliable-web-search)
[![license](https://img.shields.io/npm/l/reliable-web-search)](LICENSE)
[![node](https://img.shields.io/node/v/reliable-web-search)](package.json)

---

## Why

Every web search API fails sometimes — rate limits, auth expiry, network hiccups. `reliable-web-search` handles this for you:

- **Try providers in order** — first one fails? Next one takes over
- **Circuit breaker** — stops calling a failing provider for 60s
- **Zero-config start** — DuckDuckGo works out of the box
- **Auto-detect credentials** — set env vars, the best provider is picked automatically
- **Unified results** — all providers return the same clean format

## Quick Start

```bash
npm install reliable-web-search
```

```ts
import { reliableSearch } from 'reliable-web-search';

// Zero config — uses DuckDuckGo (no API key needed)
const result = await reliableSearch('quantum computing');

console.log(result.results);
// [
//   { title: '...', url: 'https://...', snippet: '...', provider: 'duckduckgo' },
//   ...
// ]

console.log(result.provider);    // 'duckduckgo'
console.log(result.elapsedMs);   // 342
```

## Add API Keys (better results, still automatic)

```bash
# Set one or more API keys as environment variables
export BRAVE_API_KEY="your-key"     # https://brave.com/search/api/
export BOCHA_API_KEY="your-key"     # https://open.bochaai.com
export METASO_API_KEY="your-key"    # https://metaso.cn
export TAVILY_API_KEY="your-key"    # https://tavily.com
export GEMINI_API_KEY="your-key"    # https://aistudio.google.com/apikey
export SERPAPI_API_KEY="your-key"   # https://serpapi.com
export SEARXNG_BASE_URL="http://localhost:8080"  # Self-hosted SearXNG
```

```ts
// No code changes needed — auto-detects which providers have credentials
const result = await reliableSearch('RISC-V vector extension');
// Uses Brave → Tavily → DuckDuckGo (whatever has keys set)
```

## Explicit Provider Chain

```ts
const result = await reliableSearch('量子计算', {
  providers: ['bocha', 'metaso', 'duckduckgo'],
  count: 10,
  language: 'zh',
  freshness: 'month',
});
```

## API

### `reliableSearch(query, options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `query` | `string` | *(required)* | Search query |
| `providers` | `string[]` | auto-detect | Ordered provider priority list |
| `count` | `number` | `5` | Max results (1–20) |
| `country` | `string` | — | ISO 3166-1 alpha-2 country code |
| `language` | `string` | — | ISO 639-1 language code |
| `freshness` | `'day' \| 'week' \| 'month' \| 'year'` | — | Time filter |
| `timeout` | `number` | `15000` | Per-provider timeout (ms) |
| `signal` | `AbortSignal` | — | Cancel the search |
| `fallback` | `FallbackConfig` | sequential | Fallback strategy |
| `cache` | `CacheConfig` | enabled | Result caching |

### `ReliableSearchResult`

```ts
interface ReliableSearchResult {
  results: UnifiedSearchResult[];
  provider: string;           // e.g. 'brave'
  providerPath: string[];      // e.g. ['brave', 'tavily', 'duckduckgo']
  fallbackReason?: string;     // e.g. 'brave: rate_limited'
  attempts: Record<string, number>;
  elapsedMs: number;
}

interface UnifiedSearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  publishedAt?: string;
}
```

## Fallback Modes

| Mode | Behavior |
|------|----------|
| `sequential` (default) | Try one by one, stop on first success |
| `parallel` | Fire all at once, return fastest |
| `best-effort` | Fire all, merge all successful results |

```ts
await reliableSearch('query', {
  fallback: { mode: 'parallel' },
});
```

## Providers

| Provider | ID | Requires Key | Best For |
|----------|----|-------------|----------|
| DuckDuckGo | `duckduckgo` | No | Zero-config default |
| Brave | `brave` | `BRAVE_API_KEY` | English web |
| Bocha (博查) | `bocha` | `BOCHA_API_KEY` | Chinese web |
| Metaso (秘塔) | `metaso` | `METASO_API_KEY` | Chinese AI search |
| Tavily | `tavily` | `TAVILY_API_KEY` | AI / RAG |
| Gemini | `gemini` | `GEMINI_API_KEY` | Google grounding |
| SerpAPI | `serpapi` | `SERPAPI_API_KEY` | Multi-engine (Baidu, Google…) |
| SearXNG | `searxng` | `SEARXNG_BASE_URL` | Self-hosted privacy |

## Custom Providers

```ts
import { registry } from 'reliable-web-search';
import type { SearchProvider } from 'reliable-web-search';

const myProvider: SearchProvider = {
  id: 'my-search',
  name: 'My Search Engine',
  requiresKey: true,
  envVars: ['MY_SEARCH_API_KEY'],

  async search(params) {
    const key = process.env.MY_SEARCH_API_KEY;
    const res = await fetch(`https://api.example.com/search?q=${params.query}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await res.json();
    return { results: data.items };
  },

  normalize(raw, query) {
    return raw.results.map(r => ({
      title: r.title, url: r.url, snippet: r.desc, provider: 'my-search',
    }));
  },
};

registry.register(myProvider);
```

## Zero Runtime Dependencies

`reliable-web-search` has **no runtime dependencies** — it uses only `fetch` (Node 18+ built-in). The package size is under 20 KB min+gzipped.

## License

MIT
