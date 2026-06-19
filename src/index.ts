/**
 * ============================================================
 *  reliable-web-search — Main Entry Point
 * ============================================================
 *
 *  Multi-provider web search with automatic fallback,
 *  circuit breaking, and zero-config defaults.
 *
 *  @example
 *  ```ts
 *  import { reliableSearch } from 'reliable-web-search';
 *
 *  // Zero-config (uses DuckDuckGo)
 *  const result = await reliableSearch('RISC-V vector extension');
 *  console.log(result.results);
 *  console.log(`Served by: ${result.provider}`);
 *  ```
 *
 *  @example
 *  ```ts
 *  // Set API keys as env vars for better results:
 *  //   export BRAVE_API_KEY="xxx"
 *  //   export BOCHA_API_KEY="yyy"
 *  // Auto-detection picks the best available provider.
 *  const result = await reliableSearch('量子计算');
 *  ```
 */

// ── Main API ──────────────────────────────────────────
export { reliableSearch } from './reliable-search.js';

// ── Types ─────────────────────────────────────────────
export type {
  // Main types
  ReliableSearchOptions,
  ReliableSearchResult,
  UnifiedSearchResult,

  // Provider contract (for custom providers)
  SearchProvider,
  SearchParams,
  ProviderSearchResult,
  RawSearchItem,
  HealthStatus,

  // Config
  FallbackConfig,
  CircuitBreakerConfig,
  CacheConfig,
  SearchFreshness,

  // Error system
  ErrorCategory,
  ClassifiedError,
} from './types.js';

// ── Provider Registry ─────────────────────────────────
export { registry } from './providers/registry.js';

// ── Built-in Providers ────────────────────────────────
// Users import these to register them explicitly or
// to customize the provider order.
export { duckduckgoProvider } from './providers/duckduckgo.js';
export { braveProvider } from './providers/brave.js';
export { bochaProvider } from './providers/bocha.js';
export { metasoProvider } from './providers/metaso.js';
export { tavilyProvider } from './providers/tavily.js';
export { geminiProvider } from './providers/gemini.js';
export { serpapiProvider } from './providers/serpapi.js';
export { searxngProvider } from './providers/searxng.js';

// ── Resilience (advanced users) ───────────────────────
export { CircuitBreaker, BreakerRegistry } from './resilience/circuit-breaker.js';
export { classifyError } from './resilience/error-classify.js';
export { SearchCache } from './cache.js';

// ── Auto-register built-in providers ──────────────────
import { registry } from './providers/registry.js';
import { duckduckgoProvider } from './providers/duckduckgo.js';
import { braveProvider } from './providers/brave.js';
import { bochaProvider } from './providers/bocha.js';
import { metasoProvider } from './providers/metaso.js';
import { tavilyProvider } from './providers/tavily.js';
import { geminiProvider } from './providers/gemini.js';
import { serpapiProvider } from './providers/serpapi.js';
import { searxngProvider } from './providers/searxng.js';

// Register all built-in providers on import.
// DuckDuckGo first (highest priority default), then key-based ones.
// Auto-detection will reorder based on credential presence.
registry.register(duckduckgoProvider);
registry.register(braveProvider);
registry.register(bochaProvider);
registry.register(metasoProvider);
registry.register(tavilyProvider);
registry.register(geminiProvider);
registry.register(serpapiProvider);
registry.register(searxngProvider);
