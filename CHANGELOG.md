# Changelog

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
