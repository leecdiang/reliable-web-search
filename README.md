# reliable-web-search

**Multi-provider web search with automatic fallback, circuit breaking, and unified agent setup.**

[![version](https://img.shields.io/github/v/release/leecdiang/reliable-web-search)](https://github.com/leecdiang/reliable-web-search/releases)
[![license](https://img.shields.io/github/license/leecdiang/reliable-web-search)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

---

## Install

```bash
npm install --global reliable-web-search
rws
```

The setup wizard (v0.4.0) guides you through an **iterative multi-provider, multi-credential** workflow:

1. Choose a search provider (Brave, Tavily, Gemini, DuckDuckGo, SerpAPI, SearXNG, Bocha, Metaso)
2. Enter API key(s) — one per credential profile (e.g., `tavily.personal`, `tavily.backup`)
3. Verify each credential with a small live test
4. Continue adding more providers, add additional credentials to the same provider, adjust route order
5. Review the ordered route list and confirm
6. Detect OpenClaw, Codex, and Claude Code; install the MCP tool

After setup:

```bash
rws "latest RISC-V news"
```

### Credential Management

```bash
rws credentials list                                  # List all credential profiles (keys masked)
rws credentials add tavily --label personal           # Add a new credential
rws credentials remove tavily.backup                   # Remove credential (and routes referencing it)
rws credentials enable tavily.personal                # Re-enable a credential
rws credentials disable tavily.backup                 # Disable without deleting
```

### Route Management

```bash
rws routes list                                       # Show search order
rws routes move tavily.backup --before brave.default   # Reorder route
rws routes enable|disable <route-id>                   # Toggle without deleting
```

### Other Commands

```bash
rws doctor                            # Route-aware health check (per-route config, credential status)
rws doctor --live                     # Verify first credential for each provider
rws doctor --live --all-credentials   # ⚠ Verify every credential (makes one real request each)
rws setup                             # Re-run the iterative setup wizard
rws connect                           # Connect to detected agent hosts
rws disconnect                        # Remove MCP registrations
```

Agent integrations:

| Host          | Detection | Installation                  | Status           |
|---------------|-----------|-------------------------------|------------------|
| OpenClaw      | Auto      | `openclaw mcp add`            | ✅ Verified      |
| Codex         | Auto      | `codex mcp add`               | ⚠️ Beta          |
| Claude Code   | Auto      | `claude mcp add --transport stdio` | ⚠️ Beta      |
| Generic MCP   | Manual    | Standard MCP config           | 🔧 Standard MCP  |

## Quick Start (SDK)

```bash
npm install reliable-web-search
```

```ts
import { reliableSearch } from 'reliable-web-search';

// Zero config uses DuckDuckGo Instant Answer (limited, no key needed)
const result = await reliableSearch('RISC-V vector extension');

console.log(result.provider);      // 'duckduckgo'
console.log(result.resultStatus);  // 'success' | 'no_results' | ...
console.log(result.results);
```

```bash
# Set API keys for better results — auto-detected in priority order
export BRAVE_API_KEY="***"       # https://brave.com/search/api/
export TAVILY_API_KEY="***"      # https://tavily.com
export GEMINI_API_KEY="***"      # https://aistudio.google.com/apikey
export SEARXNG_BASE_URL="https://your-instance.example.com"
```

## Providers

| Provider        | ID           | Requires Key | Type             | Status         |
|-----------------|--------------|-------------|-------------------|----------------|
| Brave           | `brave`      | Yes         | Full web search   | ✅ Verified     |
| Tavily          | `tavily`     | Yes         | AI-optimized      | ✅ Verified     |
| Gemini          | `gemini`     | Yes         | Grounded AI       | ✅ Verified     |
| SerpAPI         | `serpapi`    | Yes         | Multi-engine      | ✅ Verified     |
| DuckDuckGo      | `duckduckgo` | No          | Instant Answer*   | ✅ Verified     |
| SearXNG         | `searxng`    | Config      | Self-hosted       | ✅ Verified     |
| Bocha (博查)    | `bocha`      | Yes         | Full web search   | ⚠️ Experimental |
| Metaso (秘塔)   | `metaso`     | Yes         | AI search         | ⚠️ Experimental |

**\*DuckDuckGo uses the Instant Answer API, not full web search.** It returns encyclopedia-style topic summaries, not a comprehensive web results page. It is a lowest-priority fallback — useful for zero-config prototyping, not production search.

## MCP Tool — `reliable_web_search`

The MCP server exposes a single tool for AI agents:

```ts
// Tool input schema
{
  query: string;                                          // required
  count?: number;                                         // 1–20
  strategy?: 'fallback' | 'race' | 'aggregate';
  providers?: string[];
  freshness?: 'day' | 'week' | 'month' | 'year';
}
```

The tool description tells agents:

> Use this tool for current or externally verifiable information. A failed retrieval is not evidence that a claim is false. Only treat results as reviewable when `usableForReview` is true.

## API

### `reliableSearch(query, options?)`

| Option                        | Type                                        | Default      | Description                     |
|-------------------------------|---------------------------------------------|--------------|---------------------------------|
| `query`                       | `string`                                    | *(required)* | Search query                    |
| `providers`                   | `string[]`                                  | auto-detect  | Provider priority list by id    |
| `count`                       | `number`                                    | `5`          | Results to return (1–20)        |
| `country`                     | `string`                                    | —            | ISO 3166-1 alpha-2              |
| `language`                    | `string`                                    | —            | ISO 639-1                       |
| `freshness`                   | `'day'\|'week'\|'month'\|'year'`             | —            | Time filter                     |
| `timeout`                     | `number`                                    | `15000`      | Per-provider timeout (ms)       |
| `minResults`                  | `number`                                    | `1`          | Min results for success         |
| `fallback.mode`               | `'fallback'\|'race'\|'aggregate'`            | `'fallback'` | Strategy                        |
| `fallback.maxRetries`         | `number`                                    | `1`          | Retries per provider            |
| `fallback.circuitBreaker`     | `CircuitBreakerConfig\|false`                | enabled      | Breaker config                  |
| `cache`                       | `CacheConfig`                               | enabled      | TTL cache                       |
| `signal`                      | `AbortSignal`                               | —            | Cancel entire search            |

### `ReliableSearchResult`

```ts
interface ReliableSearchResult {
  results: UnifiedSearchResult[];
  provider: string;
  providerPath: string[];
  fallbackReason?: string;
  attempts: AttemptRecord[];
  elapsedMs: number;
  retrievalSucceeded: boolean;
  usableForReview: boolean;
  resultStatus: ResultStatus;
  cacheHit: boolean;
}
```

## Fallback Modes

| Mode        | Behavior                                                          |
|-------------|-------------------------------------------------------------------|
| `fallback`  | Try providers in priority order, skip on empty/fail               |
| `race`      | Fire all, first success wins, losers aborted via AbortController  |
| `aggregate` | Fire all, merge all successful results                            |

## Configuration

The CLI stores user config in:

- **Linux**: `${XDG_CONFIG_HOME:-~/.config}/reliable-web-search/`
- **macOS**: `~/.config/reliable-web-search/`
- **Windows**: `%APPDATA%/reliable-web-search/`

Files:

- `config.json` — providers, strategy, timeout, connected hosts
- `credentials.json` — API keys (permissions restricted to `0600` on Unix)

Environment variables take priority over credential files. API keys are never written into agent host configs — hosts start `rws mcp` which reads credentials locally.

> **Security note**: Credentials are stored as plaintext protected by file permissions, not the OS keychain. Use environment variables if you need stronger protection.

## Custom Providers

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

## Architecture

- **Core SDK** — zero runtime dependencies (uses `fetch` in Node 18+)
- **CLI** — adds `@modelcontextprotocol/sdk`, `zod`, `@inquirer/prompts` for interactive setup and MCP transport
- **ESM + CJS dual output** — works with both `import` and `require`
- **Typed ProviderError** — includes providerId, status code, retryability, and breaker impact

The search core remains lightweight. The CLI adds small dependencies for interactive setup and MCP transport.

## License

MIT
