# reliable-web-search

**Multi-provider web search with automatic fallback, circuit breaking, credential failover, and unified MCP agent setup.**

[English](README.md) | [简体中文](README.zh-CN.md)

[![version](https://img.shields.io/github/v/release/leecdiang/reliable-web-search)](https://github.com/leecdiang/reliable-web-search/releases)
[![license](https://img.shields.io/github/license/leecdiang/reliable-web-search)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

---

## Why reliable-web-search

Search is fundamental to AI agents and applications, but production-grade search has a critical gap: **no single provider is always available**. Rate limits, API outages, authentication failures, and content gaps mean every search request needs a safety net — if one provider fails, another should step in transparently.

`reliable-web-search` solves this by treating search as a **resilient routing problem**. You configure multiple providers and credential profiles, declare the fallback order, and the library handles the rest: failover, circuit breaking, retry with backoff, credential rotation, and MCP-based agent integration.

It is not a meta-search engine, a web scraper, or a search aggregator. It is a **reliability layer** for existing search APIs.

---

## Highlights

- **Multi-provider, multi-credential** — multiple API keys per provider, multiple providers in a search route
- **Credential failover** — `rate_limited` / `quota_exhausted` / `auth_failure` → next credential for same provider
- **Provider fallback** — `network_error` / `timeout` / `no_results` → next provider in route
- **Circuit breaking** — per-provider failure tracking, half-open recovery
- **MCP native** — exposes a single `reliable_web_search` tool for AI agents (OpenClaw, Codex, Claude Code, Generic MCP)
- **202+ tests** — fallback chain, credential failover, MCP transport, packaged CLI smoke tests, env route lifecycle
- **ESM + CJS dual build**
- **CLI setup wizard** — interactive multi-credential configuration with route preview

---

## Installation

```bash
npm install --global reliable-web-search
rws setup
```

If your global npm prefix requires root (typical on macOS/Linux with the default prefix), install safely without `sudo`:

```bash
npm install --global \
  --prefix "$HOME/.local" \
  reliable-web-search
```

Then add `$HOME/.local/bin` to your `PATH`. After that, `rws` commands will be available.

### Upgrading from 0.3.x

If you have an existing v1 config from a previous version, upgrade is automatic and safe:

```bash
npm install --global reliable-web-search@0.4.0
rws setup
```

Your existing `config.json` and `credentials.json` will be atomically migrated to the new v2 format. A backup file is created automatically. No data is lost.

---

## 30-second Quick Start

```bash
rws "latest RISC-V news"
```

With no configuration, this uses DuckDuckGo Instant Answer (no API key needed, but limited results). For production-quality results, run the setup wizard once:

```bash
rws setup
```

Then:

```bash
rws "latest RISC-V news"
```

The `rws` CLI is a full interactive search prompt when run with no arguments and a TTY.

---

## Interactive Setup

`rws setup` runs an **iterative wizard** that lets you configure multiple providers and multiple credential profiles before reaching agent detection.

1. Select a provider (Brave, Tavily, Gemini, SerpAPI, DuckDuckGo, SearXNG, Bocha, Metaso)
2. Enter the API key (hidden input, never echoed)
3. Optionally verify with a small live request
4. Assign a label (e.g., `personal`) — the first credential defaults to `default`
5. Choose what to do next:
   - **Add another provider**
   - **Add credentials / manage existing** — add a backup key, replace or disable a credential
   - **Review and adjust search route** — reorder, enable or disable routes
   - **Finish provider setup**
6. Once you finish, the wizard detects OpenClaw, Codex, Claude Code, and Generic MCP hosts, and offers to install the `reliable_web_search` tool.

### After setup

```bash
rws doctor
```

This shows route-level health: configured credentials, env routes, disabled routes, and agent connections.

---

## Agent Integrations

The setup wizard auto-detects installed agents and can register the `reliable_web_search` MCP tool in each one. Each agent receives the same command:

```json
{
  "command": "/path/to/rws",
  "args": ["mcp"]
}
```

All API keys stay in your local `credentials.json` — they are never written into agent host configurations.

| Host          | Detection | Installation                  | Status           |
|---------------|-----------|-------------------------------|------------------|
| OpenClaw      | Auto      | `openclaw mcp add`            | ✅ Verified      |
| Generic MCP   | Manual    | Standard MCP config file      | 🔧 Standard MCP  |
| Codex         | Auto      | `codex mcp add`               | ⚠️ Beta          |
| Claude Code   | Auto      | `claude mcp add --transport stdio` | ⚠️ Beta      |

---

## Multiple Providers and Credentials

You can configure multiple **credential profiles** for the same provider and multiple **providers** in a single search route.

### Example route

```
 1. tavily.default        (highest priority)
 2. tavily.backup-2       (same provider, backup key)
 3. gemini.default
 4. duckduckgo            (keyless fallback)
```

### Example setup commands

```bash
rws credentials add tavily --label personal
rws credentials add tavily --label backup-2
rws credentials add gemini --label default

rws routes list
rws routes move tavily.backup-2 --before gemini.default
rws routes disable duckduckgo
```

**Important**: Multiple accounts are useful for legitimate use cases like team workspaces, key rotation, or backup credentials. Always comply with each provider's Terms of Service.

---

## Routing and Failover Semantics

The search route is an ordered list of `(provider, credential)` pairs. Execution follows a **two-layer failover model**:

### Layer 1: Credential failover (same provider, next key)

| Error                          | Action                                          |
|--------------------------------|--------------------------------------------------|
| `rate_limited`                 | Try next credential for the same provider        |
| `quota_exhausted`              | Try next credential for the same provider        |
| `authentication_failure`       | Mark credential unavailable, try next             |

### Layer 2: Provider fallback (next provider)

| Error                          | Action                                          |
|--------------------------------|--------------------------------------------------|
| `network_error`                | Retry (with backoff), then next provider         |
| `timeout`                      | Retry (with backoff), then next provider         |
| `server_error`                 | Circuit breaker trip, then next provider         |
| `provider_overloaded`          | Circuit breaker trip, then next provider         |
| `no_results`                   | Next provider directly (no retry)                |
| `unusable_results`             | Next provider directly (no retry)                |

### User cancellation

If the user provides an `AbortSignal` and it fires, **all execution stops immediately** — no credential retry, no provider fallback.

### Search modes

| Mode        | Behavior                                                          |
|-------------|-------------------------------------------------------------------|
| `fallback`  | Try routes in priority order, skip on empty/fail                  |
| `race`      | Fire all routes, first success wins, losers aborted immediately   |
| `aggregate` | Fire all routes, merge all successful results                     |

> The current credential policy supports `failover` only. Round-robin, weighted, or health-score-based credential selection is not implemented.

---

## CLI Reference

### Global options

| Flag                 | Description                                    |
|----------------------|------------------------------------------------|
| `--json`             | Output as JSON                                 |
| `--verbose`          | Show detailed diagnostics                      |
| `--strategy`         | `fallback` \| `race` \| `aggregate`            |
| `--provider <id>`    | Use specific provider                          |
| `--count <n>`        | Number of results (1–20)                       |

### Commands

```bash
rws setup                              # Iterative setup wizard
rws search <query>                     # Search (or "rws <query>" as shorthand)

rws doctor                             # Route-aware health check
rws doctor --live                      # Verify first credential per provider
rws doctor --live --all-credentials    # ⚠ Verify every credential (makes real requests)

rws credentials list                   # List all credential profiles (keys masked)
rws credentials add <provider> [--label <name>]  # Add a credential
rws credentials remove <profile-id>    # Remove credential + associated routes
rws credentials enable <profile-id>    # Re-enable
rws credentials disable <profile-id>   # Disable without deleting

rws routes list                        # Show search order
rws routes move <route-id> --before <other-route-id>  # Reorder
rws routes enable <route-id>           # Enable a route
rws routes disable <route-id>          # Disable without deleting

rws config                             # Show config summary (keys masked)
rws config path                        # Print config directory path

rws connect --all                      # Connect to all detected agent hosts
rws connect openclaw                   # Connect to a specific host
rws disconnect --all                   # Disconnect from all hosts
rws mcp                                # Start MCP stdio server
```

---

## MCP Usage and Result Metadata

The MCP server provides a single `reliable_web_search` tool.

### Tool input

```json
{
  "query": "RISC-V vector extension",
  "count": 5,
  "strategy": "fallback",
  "freshness": "month"
}
```

### Tool output (truncated)

```json
{
  "results": [
    {
      "title": "RISC-V Vector Extension Overview",
      "url": "https://...",
      "snippet": "...",
      "provider": "tavily"
    }
  ],
  "provider": "tavily",
  "providerPath": ["tavily.default"],
  "attempts": [
    {
      "providerId": "tavily",
      "routeId": "tavily.default",
      "credentialProfile": "default",
      "status": "success",
      "elapsedMs": 340,
      "resultCount": 5
    }
  ],
  "resultStatus": "success",
  "retrievalSucceeded": true,
  "usableForReview": true,
  "elapsedMs": 340,
  "cacheHit": false
}
```

The tool description tells AI agents:

> Use this tool for current or externally verifiable information. A failed retrieval is not evidence that a claim is false. Only treat results as reviewable when `usableForReview` is true.

**No API keys appear** in the tool response, attempts, error messages, or MCP logs.

---

## TypeScript SDK

```bash
npm install reliable-web-search
```

```ts
import { reliableSearch } from 'reliable-web-search';

const result = await reliableSearch('RISC-V vector extension');

console.log(result.results);
console.log(`Served by: ${result.provider}`);
console.log(`Route: ${result.providerPath.join(' → ')}`);

// Explicit providers (backward-compatible — expands to default routes)
const explicit = await reliableSearch('quantum computing', {
  providers: ['tavily', 'brave'],
  count: 10,
  timeout: 10_000,
  fallback: { mode: 'fallback' },
});
```

### `reliableSearch(query, options?)`

| Option                        | Type                                        | Default      | Description                     |
|-------------------------------|---------------------------------------------|--------------|---------------------------------|
| `query`                       | `string`                                    | *(required)* | Search query                    |
| `providers`                   | `string[]`                                  | auto-detect  | Provider id list (v1 compat)    |
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
  provider: string;              // Winning provider id
  providerPath: string[];        // Ordered route ids tried
  fallbackReason?: string;
  attempts: AttemptRecord[];     // Each attempt with routeId, credentialProfile
  elapsedMs: number;
  retrievalSucceeded: boolean;
  usableForReview: boolean;
  resultStatus: ResultStatus;
  cacheHit: boolean;
}
```

---

## Providers

| Provider        | ID           | Requires Key | Type             | Status         | Priority* |
|-----------------|--------------|-------------|-------------------|----------------|-----------|
| Brave           | `brave`      | Yes         | Full web search   | ✅ Verified     | 10        |
| Tavily          | `tavily`     | Yes         | AI-optimized      | ✅ Verified     | 11        |
| Gemini          | `gemini`     | Yes         | Grounded AI       | ✅ Verified     | 12        |
| SerpAPI         | `serpapi`    | Yes         | Multi-engine      | ✅ Verified     | 13        |
| SearXNG         | `searxng`    | Config†     | Self-hosted       | ✅ Verified     | 14        |
| DuckDuckGo      | `duckduckgo` | No          | Instant Answer‡   | ✅ Verified     | 100       |
| Bocha (博查)    | `bocha`      | Yes         | Full web search   | ⚠️ Experimental | 90        |
| Metaso (秘塔)   | `metaso`     | Yes         | AI search         | ⚠️ Experimental | 91        |

\* Lower priority = tried first. Setup reorders based on your route configuration.
† SearXNG does not use an API key; it requires `SEARXNG_BASE_URL`.
‡ DuckDuckGo uses the Instant Answer API (encyclopedia-style topic summaries), not full web search.
  It is a configuration-free fallback, not suitable for production search volume.

### Setting API keys

```bash
# Recommended: use the setup wizard
rws setup

# Or set environment variables
export BRAVE_API_KEY="***"
export TAVILY_API_KEY="***"
export GEMINI_API_KEY="***"
export SERPAPI_API_KEY="***"
export BOCHA_API_KEY="***"
export METASO_API_KEY="***"

# SearXNG needs a base URL instead of an API key
export SEARXNG_BASE_URL="https://your-instance.example.com"
```

---

## Credentials and Security

- **API keys are stored only in `credentials.json`** — never in `config.json`, MCP host configs, stdout, stderr, or logs.
- **File permissions**: `credentials.json` is created with `0600` (owner read/write only) on Unix.
- **Output masking**: The CLI displays keys as `BSA••••7A9` (first 3 + last 3 characters). Full keys never appear in terminal output, doctor reports, or MCP responses.
- **Environment variables take priority** over file credentials. If `TAVILY_API_KEY` is set, it is used before any file-based key for the same provider.
- **v1→v2 migration**: When upgrading from 0.3.x, your existing credentials are atomically converted to the v2 profile format. The original v1 file is not automatically deleted — a backup is created.
- **Corrupted file safety**: If `credentials.json` or `config.json` is unreadable or malformed, the tool reports the error, uses defaults, and **does not overwrite** your file.

---

## Environment Variable Routes

Setting an environment variable like `TAVILY_API_KEY="..."` automatically creates an **ephemeral route** at runtime:

```
 1. tavily.env             [env]   (auto-generated, highest priority)
 2. tavily.default          [file]  (from credentials.json)
 3. duckduckgo
```

### Ephemeral route rules

- **Not persisted** — never written to `config.json` or `credentials.json`.
- **Auto-detected** — generated fresh each time the process starts.
- **Higher priority** — always appears before file-based routes in execution order.
- **Same-key dedup** — if the env var key matches a file-based profile key, only one route (the file route) is generated.
- **Disappears when unset** — run `unset TAVILY_API_KEY` and the route is gone.
- **Visible in `routes list`** — tagged `[env]`.
- **Cannot be deleted via `credentials remove`** — you must unset the environment variable.

---

## Proxy Support

`reliable-web-search` uses `undici`'s `EnvHttpProxyAgent` for proxy support.

Set `HTTPS_PROXY`, `HTTP_PROXY`, or their lowercase variants in your environment:

```bash
export HTTPS_PROXY=http://proxy.example.com:8080
export NO_PROXY=localhost,127.0.0.1
```

When detected, proxy support is activated at CLI and MCP entry points. The URL is sanitized for logging (credentials stripped). Proxy status is visible in `rws doctor`.

---

## Configuration Migration

### v1 → v2 (automatic)

| Aspect            | v1 (0.3.x)                          | v2 (0.4.0)                              |
|-------------------|--------------------------------------|------------------------------------------|
| `config.json`     | Flat `providers: string[]`           | `routes[]` with id, providerId, priority |
| `credentials.json` | Flat `{ TAVILY_API_KEY: "..." }`    | `{ version: 2, profiles: { ... } }`     |
| Migration         | —                                    | Automatic on first load, a→tomic backup  |

The first time you run `rws` or `rws setup` with a v1 config, it is automatically migrated:

1. Your v1 `config.json` is rewritten to v2 format (routes extracted from the flat provider list).
2. Your v1 `credentials.json` is rewritten to v2 profiles format.
3. Both operations are atomic (temp file → fsync → rename).
4. Corrupted files are left untouched; an error is reported and defaults are used.

---

## Troubleshooting

```bash
# Check all systems
rws doctor

# Verify a provider is working (requires API keys)
rws doctor --live

# Check every credential individually (makes one request per credential)
rws doctor --live --all-credentials

# See your search route order
rws routes list

# List credential profiles (keys masked)
rws credentials list
```

### Common issues

| Symptom                          | Likely cause                                    |
|----------------------------------|-------------------------------------------------|
| `All 0 route(s) exhausted`        | No providers configured or detected             |
| `auth_failed`                     | API key is missing, wrong, or expired           |
| `network_error`                   | No internet access or proxy misconfiguration    |
| Setup "finish" option is disabled | No routes configured yet                         |
| Config not found                  | First run — run `rws setup`                      |
| DuckDuckGo returns no results     | DDG Instant Answer API has limited coverage      |

---

## Development

```bash
git clone https://github.com/leecdiang/reliable-web-search
cd reliable-web-search
npm install
npm run typecheck
npm test
npm run build
npm run test:smoke
```

### Project structure

```
├── src/
│   ├── index.ts              # SDK entry, exports + auto-registration
│   ├── cli.ts                # CLI entry (rws command)
│   ├── reliable-search.ts    # Core orchestrator
│   ├── config/               # Config, credentials, route resolver
│   ├── providers/            # Provider adapters (tavily, brave, ...)
│   ├── resilience/           # Fallback chain, circuit breaker, error classify
│   ├── mcp/                  # MCP stdio server
│   ├── adapters/             # Agent host adapters
│   ├── network/              # Proxy support
│   └── setup/                # Interactive setup wizard
├── tests/                    # 196+ tests (fallback, config, providers, MCP, CLI, env routes)
└── dist/                     # Build output (ESM + CJS)
```

### Testing

```bash
npm test                # Full test suite
npm run test:smoke      # Packaged CLI / MCP smoke tests
```

---

## License

MIT

---

## NPM Dependencies

The package has runtime dependencies for its CLI and MCP components:

| Dependency                       | Used by      | Purpose                              |
|----------------------------------|-------------|---------------------------------------|
| `undici`                         | Core + CLI  | HTTP proxy agent (EnvHttpProxyAgent)  |
| `@inquirer/prompts`              | CLI         | Interactive setup prompts             |
| `@modelcontextprotocol/sdk`      | MCP server  | MCP protocol transport                |
| `zod`                            | MCP server  | Tool input schema validation           |

The SDK entry (`src/index.ts`) does not import these directly; lazy loading ensures that SDK-only consumers do not pay the CLI/MCP dependency cost. The `undici` dependency is used only when proxy detection is active.
