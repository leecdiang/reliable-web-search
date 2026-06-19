# Changelog

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
