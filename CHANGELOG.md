# Changelog

## [0.4.0] — 2026-06-25

### Added
- **Multi-Provider / Multi-Credential system** — configure multiple providers and multiple
  credential profiles per provider (e.g., `tavily.personal`, `tavily.backup`, `brave.default`)
- **Config v2** — `config.json` version 2 uses `routes[]` array instead of flat `providers[]` list;
  `credentials.json` version 2 uses `profiles{}` map instead of flat key-value pairs
- **Automatic v1→v2 migration** — existing configs and credentials migrated atomically with backup;
  corrupted files detected and preserved
- **Ephemeral env routes** — `TAVILY_API_KEY`, `BRAVE_API_KEY` etc. automatically generate
  `<provider>.env` route at higher priority than file profiles, without persisting to disk;
  same-key dedup prevents duplicate calls
- **Credential failover** — `rate_limited`/`quota_exhausted`/`authentication_failure` switch to
  next credential for same provider; `network_error`/`timeout`/`server_error` switch to next provider
- **Iterative setup wizard** — loop-based workflow allowing multiple providers and credentials
  before agent detection; route review and confirmation step
- **Management commands**:
  - `rws credentials list|add|remove|enable|disable`
  - `rws routes list|move|enable|disable`
- **Route-aware `rws doctor`** — per-route config completeness check, credential profile status,
  ephemeral env route detection; `--live --all-credentials` warns and checks each credential
- **Route-aware MCP server** — loads v2 routes; `providerPath` uses route identifiers
  (`tavily.personal` → `tavily.backup` → `brave.default`); API keys never exposed
- **`ProviderExecutionContext`** — search providers accept `ctx.apiKey` for injected credentials
- **SDK backward compatibility** — old `providers: string[]` calls auto-expand to default routes

### Changed
- `rws setup` now iterative: after each credential, prompts for next action instead of jumping to agents
- `rws doctor` shows route-level status (each configured route + ephemeral env routes)
- `AttemptRecord` includes `routeId` and `credentialProfile` fields
- `ProviderRoute.id` replaces `providerId` as stable attempt identifier
- Credential file writes enforce 0600 permissions on Unix

### Not Supported
- Round-robin credential rotation
- Usage statistics or cloud accounts
- Automatic provider account creation
- Web UI

## [0.3.0] — 2026-06-24

### Added
- **Unified CLI (`rws`)** — single entry point: `npm install --global reliable-web-search && rws`
- **Interactive setup wizard** — provider selection, hidden API key input, connection verification,
  agent detection, multi-host installation in one continuous flow
- **Subcommands**: `rws setup`, `rws search`, `rws config`, `rws doctor`, `rws connect`, `rws disconnect`
- **MCP stdio server (`rws mcp`)** — exposes `reliable_web_search` tool using
  official `@modelcontextprotocol/sdk`
- **Host adapter system** with `AgentHostAdapter` interface:
  - **OpenClaw** — auto-detect + install via `openclaw mcp add`
  - **Codex** — auto-detect + install via `codex mcp add`
  - **Claude Code** — auto-detect + install via `claude mcp add --transport stdio`
  - **Generic MCP** — standard MCP config output for any MCP client
- **Local configuration storage**:
  - `config.json` + `credentials.json` in platform-aware config directory
  - Environment variable override with priority over credential files
  - Atomic writes (temp file + fsync + rename)
  - Credential file permissions enforced at `0600` on Unix
  - Corrupted config detection (warn, don't overwrite)
- **Key masking** — `BSA••••7A9` display for API keys in all outputs
- **`rws doctor`** — health checks for Node.js, config, credentials, providers, MCP, and agents
- **CLI options**: `--json`, `--verbose`, `--strategy`, `--provider`, `--count`, `--live`, `--no-save`
- **Tool schema validation** via `zod` in MCP server
- **Config schema** with runtime validation and versioning

### Changed
- Build now produces dual entry: `src/index.ts` (SDK) + `src/cli.ts` (CLI)
- `package.json` bin field: `rws` and `reliable-web-search` → `./dist/cli.js`
- README top section: install-first UX (`rws` before SDK code)
- Dependency policy updated: core remains zero-dependency; CLI adds `@modelcontextprotocol/sdk`,
  `zod`, `@inquirer/prompts` for MCP transport and interactive setup

### Test Suite
- **183 tests** (136 original + 47 new):
  - 14 CLI tests (help, non-TTY, query shorthand, JSON output, key masking)
  - 18 config unit tests (masking, validation, load/save, credentials, env override)
  - 11 adapter tests (detect, install, idempotency, multi-adapter independence)
  - 4 MCP integration tests (initialize→listTools→callTool→shutdown, credential safety)
  - 8 smoke tests (packaged CLI help, config path, doctor, MCP handshake)

## [0.2.0] — 2026-06-19

### Added
- **Provider priority system** — explicit `priority` (lower = tried first) and `capabilities` fields on every provider
- **Structured `ProviderError`** — includes `providerId`, `code`, `status`, `retryable`, `shouldBreakerTrip`
- **`AttemptRecord[]` diagnostics** — each attempt records provider, status, timing, error codes, HTTP status
- **Result status machine** — `success` | `partial` | `no_results` | `failed` | `aborted` with `retrievalSucceeded` and `usableForReview`
- **`cacheHit` field** on `ReliableSearchResult` — distinguishes cached from live results
- **Typo suggestions** — misspelled provider names throw errors with Levenshtein-based suggestions
- **Provider `isConfigured()` gate** — SearXNG requires explicit `SEARXNG_BASE_URL` before activation
- **`experimental` capability flag** — Bocha and Metaso marked experimental until API contracts verified
- **Dual ESM/CJS build** via tsup — works with both `import` and `require`
- **Published package smoke tests** — ESM import, CJS require, priority ordering verification

### Changed
- **`fallback`/`race`/`aggregate` mode names** — replaces `sequential`/`parallel`/`best-effort` (old names still work)
- **True `AbortController`-based timeout** — provider fetch receives a signal that aborts on timeout (not just `Promise.race`)
- **Race mode uses `Promise.allSettled` + independent controllers** — winner aborts losers immediately; attempts are immutable and deterministic
- **Circuit breaker config passthrough** — per-call `failureThreshold`/`recoveryTimeout`/`halfOpenMaxRequests` reach breaker instances
- **Unified `runProviderAttempt` primitive** — fallback, race, and aggregate share breaker check, timeout, retry, normalization, and error classification
- **DuckDuckGo empty results trigger fallback** — no more fake "No results" placeholder blocking downstream providers
- **Registry `detect()` respects `isConfigured()` + priority ordering** — keyless providers without configuration are excluded
- **Attempts moved from `Record<string, number>` to `AttemptRecord[]`** — richer, immutable per-call diagnostics

### Fixed
- Cache hits now return complete `ReliableSearchResult` shape (not a partial stub)
- `lastHttpStatus` properly extracted from error objects
- Removed unused `ProviderError` local variable in fallback executor
- SearXNG no longer defaults to `localhost:8080` — requires explicit `SEARXNG_BASE_URL`
- Bocha response schema updated to official `webPages.value` structure

### Changed (Docs)
- README rewritten: honest DDG disclaimer (Instant Answer API, not full search), removed unverified claims
- Provider table includes priority, type, and experimental status

## [0.1.0] — 2026-06-19

### Added
- Initial release
- 8 built-in search providers: DuckDuckGo, Brave, Bocha (博查), Metaso (秘塔), Tavily, Gemini, SerpAPI, SearXNG
- Sequential fallback chain with automatic provider failover
- Circuit breaker with three states (closed / open / half-open)
- Error classification system (8 categories)
- TTL-based LRU result cache (15 min default)
- Three fallback modes: sequential, parallel, best-effort
- Zero-config auto-detection from environment variables
- Custom provider registration API
- Expressive retry with exponential backoff
- Per-provider timeout support
- Full TypeScript type definitions with strict mode
- Comprehensive test suite (105 tests, 0 failures)
- Zero runtime dependencies
- MIT license
