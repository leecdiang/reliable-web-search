# reliable-web-search

**Policy-driven multi-provider web search runtime for AI agents and resilient applications.**

[![version](https://img.shields.io/github/v/release/leecdiang/reliable-web-search)](https://github.com/leecdiang/reliable-web-search/releases)
[![license](https://img.shields.io/github/license/leecdiang/reliable-web-search)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

---

## What it is

Every web search API fails — rate limits, auth expiry, network hiccups. `reliable-web-search` is a **routing and resilience layer** that sits between your app and multiple search providers. It handles provider selection, failover, result validation, and cancellation so you don't have to.

**This is not a "search everything" aggregator.** It's a policy engine: you define which providers to try, in what order, what counts as success, and what triggers fallback.

## Core capabilities

- **Provider routing** — auto-detects available providers from env vars, falls back in priority order
- **Quality gates** — empty results trigger fallthrough; configurable minimum result thresholds
- **Real cancellation** — race mode aborts losers via AbortController; timeout aborts stuck requests
- **Circuit breaker** — isolates failing providers with three-state health tracking
- **Result validation** — rejects placeholder URLs, empty titles, and search-engine redirect pages
- **Structured diagnostics** — every attempt logged with provider, status, timing, and error classification

## Providers

| Provider | ID | Priority | Type | Status |
|----------|----|----------|------|--------|
| Brave | `brave` | 10 | Full web search | ✅ Verified |
| Tavily | `tavily` | 11 | Full web search | ✅ Verified |
| Bocha (博查) | `bocha` | 12 | Full web search | ⚠️ Experimental |
| Metaso (秘塔) | `metaso` | 15 | AI search | ⚠️ Experimental |
| Gemini | `gemini` | 20 | AI grounding | ✅ Verified |
| SerpAPI | `serpapi` | 30 | Multi-engine | ✅ Verified |
| SearXNG | `searxng` | 50 | Self-hosted | ✅ Verified |
| DuckDuckGo | `duckduckgo` | 100 | Instant Answer* | ✅ Verified |

**\*DuckDuckGo uses the Instant Answer API, not full web search.** It returns encyclopedia-style topic summaries, not a comprehensive web results page. It is a lowest-priority fallback — useful for zero-config prototyping, not production search.

Providers marked **Experimental** have API contracts that need verification against real responses. They are included in the package but may produce parse errors.

## Quick Start

```bash
npm install reliable-web-search
```

```ts
import { reliableSearch } from 'reliable-web-search';

// Zero config uses DuckDuckGo Instant Answer (limited, but no key needed)
const result = await reliableSearch('RISC-V vector extension');

console.log(result.provider);      // 'duckduckgo'
console.log(result.resultStatus);  // 'success' | 'no_results' | ...
console.log(result.results);
```

```bash
# Set API keys for better results — auto-detected in priority order
export BRAVE_API_KEY="***"       # https://brave.com/search/api/
export BOCHA_API_KEY="***"       # https://open.bochaai.com
export TAVILY_API_KEY="***"      # https://tavily.com
export GEMINI_API_KEY="***"      # https://aistudio.google.com/apikey
export SEARXNG_BASE_URL="https://your-instance.example.com"
```

```ts
// Same code, now auto-uses Brave → Tavily → DDG based on what's configured
const result = await reliableSearch('quantum computing');
```

## API

### `reliableSearch(query, options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `query` | `string` | *(required)* | Search query |
| `providers` | `string[]` | auto-detect | Provider priority list by id |
| `count` | `number` | `5` | Results to return (1–20) |
| `country` | `string` | — | ISO 3166-1 alpha-2 |
| `language` | `string` | — | ISO 639-1 |
| `freshness` | `'day'\|'week'\|'month'\|'year'` | — | Time filter |
| `timeout` | `number` | `15000` | Per-provider timeout (ms) |
| `minResults` | `number` | `1` | Minimum results to count as success |
| `fallback.mode` | `'fallback'\|'race'\|'aggregate'` | `'fallback'` | Strategy |
| `fallback.maxRetries` | `number` | `1` | Retries per provider |
| `fallback.circuitBreaker` | `CircuitBreakerConfig\|false` | enabled | Breaker config |
| `cache` | `CacheConfig` | enabled | TTL cache |
| `signal` | `AbortSignal` | — | Cancel entire search |

### `ReliableSearchResult`

```ts
interface ReliableSearchResult {
  results: UnifiedSearchResult[];
  provider: string;              // provider that served the response
  providerPath: string[];        // full call chain e.g. ['brave', 'tavily', 'ddg']
  fallbackReason?: string;
  attempts: AttemptRecord[];     // per-provider attempt diagnostics
  elapsedMs: number;
  retrievalSucceeded: boolean;   // did we get usable results?
  usableForReview: boolean;      // are results ready for downstream consumption?
  resultStatus: ResultStatus;    // 'success' | 'partial' | 'no_results' | 'failed' | 'aborted'
}
```

## Fallback modes

| Mode | Behavior |
|------|----------|
| `fallback` | Try providers in priority order, skip on empty/fail |
| `race` | Fire all, first success wins, losers aborted via AbortController |
| `aggregate` | Fire all, merge all successful results |

## Custom providers

```ts
import { registry } from 'reliable-web-search';
import type { SearchProvider } from 'reliable-web-search';

const myProvider: SearchProvider = {
  id: 'my-search',
  name: 'My Search Engine',
  requiresKey: true,
  envVars: ['MY_API_KEY'],
  priority: 15,
  capabilities: {
    fullWebSearch: true, aiGenerated: false,
    maxResults: 20, freshnessSupport: false,
  },
  async search(params) {
    const key = process.env.MY_API_KEY;
    // ... call your API, return { results: [...] }
  },
  normalize(raw) {
    return raw.results.map(r => ({ ...r, provider: 'my-search' }));
  },
};

registry.register(myProvider);
```

## Architecture decisions

- **Zero runtime dependencies** — uses only `fetch` (Node 18+)
- **ESM + CJS dual output** — works with both `import` and `require`
- **Provider factory pattern** — injectable API key resolver, fetch, and config (env vars are just the default)
- **Typed ProviderError** — includes providerId, status code, retryability, and breaker impact

## License

MIT
