# Changelog

## [0.4.0] — 2026-06-26

### Added

- **Config v2 and Credentials v2** — `config.json` now uses a `routes[]` array; `credentials.json` uses a `profiles{}` map. Backwards-compatible: old v1 files are read and migrated automatically.
- **Automatic atomic migration** — the first load of a v1 config creates a v2 config and v2 credentials atomically (temp file → fsync → rename). The original files are preserved during migration.
- **Multiple credential profiles for one provider** — you can configure any number of named API keys for the same provider (e.g., `tavily.personal`, `tavily.backup`, `brave.workspace`).
- **Iterative setup wizard** — `rws setup` no longer ends after the first credential. It loops: add a provider → add credentials → manage existing → adjust routes → finish → agent detection.
- **Credential and route management commands** — `rws credentials list|add|remove|enable|disable` and `rws routes list|move|enable|disable`.
- **Credential-level failover** — `rate_limited`, `quota_exhausted`, and `authentication_failure` trigger a switch to the next credential for the same provider (not just the next provider).
- **Route-aware `providerPath` and `AttemptRecord`** — `providerPath` now uses route identifiers (`tavily.personal` → `tavily.backup` → `brave.default`). `AttemptRecord` includes `routeId` and `credentialProfile`.
- **Ephemeral env routes** — setting `TAVILY_API_KEY`, `BRAVE_API_KEY` etc. in the environment automatically generates a `<provider>.env` route at higher priority than file-based credentials. These routes are never written to disk.
- **Route-aware `rws doctor`** — shows per-route configuration, credential profile status, and ephemeral env route detection. `--live --all-credentials` warns and verifies every credential individually.
- **196 core tests and 8 packaged smoke tests** — fallback chain, credential failover, env route lifecycle, CLI management commands, MCP transport. Total: 196 tests, 0 failures.
- **Backwards-compatible `providers: string[]`** — the old SDK API signature still works; provider ids are auto-expanded to default routes.

### Changed

- `rws setup` is now an iterative multi-credential wizard instead of a single-provider flow.
- `rws doctor` shows per-route health (including ephemeral env routes).
- `AttemptRecord` includes `routeId` and `credentialProfile` fields.
- Credential file writes enforce `0600` permissions on Unix.
- The setup wizard moves agent detection to the end, after route confirmation.

### Not Supported

- Round-robin credential rotation (failover only).
- Usage statistics, cloud accounts, or Web UI.
- Automatic provider account creation.

## [0.3.0] — 2026-06-25

### Added

- **Unified CLI (`rws`)** — a single entry point: `npm install --global reliable-web-search && rws`.
- **Interactive setup wizard** — provider selection, hidden API key input, connection verification, agent detection, and multi-host installation in one continuous flow.
- **Subcommands**: `rws setup`, `rws search`, `rws config`, `rws doctor`, `rws connect`, `rws disconnect`.
- **Stdio MCP server (`rws mcp`)** — exposes the `reliable_web_search` tool using the official `@modelcontextprotocol/sdk`.
- **Host adapter system** with `AgentHostAdapter` interface:
  - **OpenClaw** — auto-detect + install via `openclaw mcp add`.
  - **Codex** — auto-detect + install via `codex mcp add`.
  - **Claude Code** — auto-detect + install via `claude mcp add --transport stdio`.
  - **Generic MCP** — standard MCP config output for any MCP client.
- **Local configuration storage** — `config.json` + `credentials.json` in a platform-aware config directory. Environment variables override credential files. Atomic writes using temp file + fsync + rename.
- **Credential file permissions** — `0600` owner-only access enforced on Unix.
- **Key output masking** — API keys displayed as `BSA••••7A9` everywhere (CLI, doctor, logs).
- **`rws doctor`** — health checks for Node.js version, config, credentials, providers, MCP, and agent hosts.
- **Proxy support** — `undici` `EnvHttpProxyAgent` via `setupProxy()` at CLI and MCP entry points. No SDK-level side effects. Proxy status displayed in `rws doctor`.
- **CLI** `--json`, `--verbose`, `--strategy`, `--provider`, `--count`, `--live`, `--no-save` options.
- **Config schema validation** with versioning, runtime checks, and graceful degradation on corrupted files.
- **Packaged CLI/MCP smoke tests** — 8 tests verifying the npm-packaged binary (help, config path, doctor, MCP handshake via stdio).

### Changed

- Build produces dual entry: `src/index.ts` (SDK) + `src/cli.ts` (CLI).
- `package.json` `bin` field: `rws` and `reliable-web-search` → `./dist/cli.js`.
- README: install-first UX (`rws` before SDK code), multi-provider introduction.

### Not Included

- Multiple credential profiles per provider (added in 0.4.0).

## [0.2.0] — 2026-06-19

### Added
- Provider priority system — explicit `priority` (lower = tried first) and `capabilities` fields on every provider.
- Structured `ProviderError` — includes `providerId`, `code`, `status`, `retryable`, `shouldBreakerTrip`.
- `AttemptRecord[]` diagnostics — each attempt records provider, status, timing, error codes, HTTP status.
- Result status machine — `success` | `partial` | `no_results` | `failed` | `aborted` with `retrievalSucceeded` and `usableForReview`.
- `cacheHit` field on `ReliableSearchResult` — distinguishes cached from live results.
- Typo suggestions — misspelled provider names throw errors with Levenshtein-based suggestions.
- Provider `isConfigured()` gate — SearXNG requires explicit `SEARXNG_BASE_URL` before activation.
- `experimental` capability flag — Bocha and Metaso marked experimental until API contracts verified.
- Dual ESM/CJS build via tsup — works with both `import` and `require`.
- Published package smoke tests — ESM import, CJS require, priority ordering verification.

### Changed
- `fallback`/`race`/`aggregate` mode names — replaces `sequential`/`parallel`/`best-effort` (old names still work).
- True `AbortController`-based timeout — provider fetch receives a signal that aborts on timeout (not just `Promise.race`).
- Race mode uses `Promise.allSettled` + independent controllers — winner aborts losers immediately; attempts are immutable and deterministic.
- Circuit breaker config passthrough — per-call `failureThreshold`/`recoveryTimeout`/`halfOpenMaxRequests` reach breaker instances.
- Unified `runProviderAttempt` primitive — fallback, race, and aggregate share breaker check, timeout, retry, normalization, and error classification.
- DuckDuckGo empty results trigger fallback — no more fake "No results" placeholder blocking downstream providers.
- Registry `detect()` respects `isConfigured()` + priority ordering — keyless providers without configuration are excluded.
- Attempts moved from `Record<string, number>` to `AttemptRecord[]` — richer, immutable per-call diagnostics.

### Fixed
- Cache hits now return complete `ReliableSearchResult` shape (not a partial stub).
- `lastHttpStatus` properly extracted from error objects.
- Removed unused `ProviderError` local variable in fallback executor.
- SearXNG no longer defaults to `localhost:8080` — requires explicit `SEARXNG_BASE_URL`.
- Bocha response schema updated to official `webPages.value` structure.

### Changed (Docs)
- README rewritten: honest DDG disclaimer (Instant Answer API, not full search), removed unverified claims.
- Provider table includes priority, type, and experimental status.

## [0.1.0] — 2026-06-19

### Added
- Initial release.
- 8 built-in search providers: DuckDuckGo, Brave, Bocha (博查), Metaso (秘塔), Tavily, Gemini, SerpAPI, SearXNG.
- Sequential fallback chain with automatic provider failover.
- Circuit breaker with three states (closed / open / half-open).
- Error classification system (8 categories).
- TTL-based LRU result cache (15 min default).
- Three fallback modes: sequential, parallel, best-effort.
- Zero-config auto-detection from environment variables.
- Custom provider registration API.
- Expressive retry with exponential backoff.
- Per-provider timeout support.
- Full TypeScript type definitions with strict mode.
- Comprehensive test suite (105 tests, 0 failures).
- MIT license.
