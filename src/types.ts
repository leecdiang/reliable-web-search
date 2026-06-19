/**
 * ============================================================
 *  reliable-web-search — Core Types
 * ============================================================
 *  All public types for the package.
 *  Provider authors: implement {@link SearchProvider} to add a new engine.
 */

// ─── Unified Result ────────────────────────────────────────

export interface UnifiedSearchResult {
  /** Result title */
  title: string;
  /** Result URL */
  url: string;
  /** Content snippet */
  snippet: string;
  /** Source provider id */
  provider: string;
  /** ISO-8601 publish date (if available) */
  publishedAt?: string;
  /** Provider-specific raw data (opt-in for advanced users) */
  raw?: unknown;
}

// ─── Provider Interface ────────────────────────────────────

export interface SearchParams {
  /** Search query string */
  query: string;
  /** Desired result count (1–20) */
  count: number;
  /** ISO 3166-1 alpha-2 country code */
  country?: string;
  /** ISO 639-1 language code */
  language?: string;
  /** Time filter */
  freshness?: SearchFreshness;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

export type SearchFreshness = 'day' | 'week' | 'month' | 'year';

/** Raw result from a provider, before normalization */
export interface ProviderSearchResult {
  results: RawSearchItem[];
}

export interface RawSearchItem {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

/**
 * Every search provider must implement this interface.
 *
 * ## Quick start for new providers
 * 1. Copy `src/providers/duckduckgo.ts` as a template
 * 2. Implement `search()` and `normalize()`
 * 3. Call `registerProvider()` in your entry point
 * 4. Send a PR!
 */
export interface SearchProvider {
  /** Unique identifier, e.g. `'brave'`, `'bocha'` */
  readonly id: string;
  /** Human-readable name, e.g. `'Brave Search'` */
  readonly name: string;
  /** Whether this provider requires an API key */
  readonly requiresKey: boolean;
  /**
   * Environment variable names to auto-detect credentials.
   * Listed in priority order. First one found wins.
   */
  readonly envVars: readonly string[];
  /** Quick health check (optional). Called before fallback decisions. */
  healthCheck?(): Promise<HealthStatus>;
  /** Execute a search. Throws on failure. */
  search(params: SearchParams): Promise<ProviderSearchResult>;
  /** Normalize raw provider result into the unified format */
  normalize(raw: ProviderSearchResult, query: string): UnifiedSearchResult[];
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

// ─── Main API Options ──────────────────────────────────────

export interface ReliableSearchOptions {
  /**
   * Ordered provider priority list.
   * If omitted, auto-detects from environment variables + built-in defaults.
   */
  providers?: string[];

  /** Max results to return (1–20, default 5) */
  count?: number;

  /** ISO 3166-1 alpha-2 country filter */
  country?: string;

  /** ISO 639-1 language filter */
  language?: string;

  /** Time freshness filter */
  freshness?: SearchFreshness;

  // ─── Resilience Config ──────────────────────────────────

  /** Fallback strategy configuration */
  fallback?: FallbackConfig;

  /** Result cache configuration */
  cache?: CacheConfig;

  /** Per-provider timeout in ms (default 15000) */
  timeout?: number;

  /** AbortSignal for cancellation of the entire search */
  signal?: AbortSignal;
}

export interface FallbackConfig {
  /**
   * Fallback mode:
   * - `'sequential'` (default): try providers in order, stop on first success
   * - `'parallel'`: query all at once, return fastest success
   * - `'best-effort'`: query all, merge all successful results
   */
  mode?: 'sequential' | 'parallel' | 'best-effort';

  /** Max retries per provider (default 1) */
  maxRetries?: number;

  /** Circuit breaker config (default enabled) */
  circuitBreaker?: CircuitBreakerConfig | false;
}

export interface CircuitBreakerConfig {
  /** Consecutive failures to trip (default 3) */
  failureThreshold?: number;
  /** Recovery timeout ms before half-open (default 60000) */
  recoveryTimeout?: number;
  /** Max trial requests in half-open state (default 1) */
  halfOpenMaxRequests?: number;
}

export interface CacheConfig {
  /** Enable result caching (default true) */
  enabled?: boolean;
  /** Cache TTL in ms (default 900000 = 15 min) */
  ttl?: number;
  /** Max cache entries (default 500) */
  maxSize?: number;
}

// ─── Main API Result ───────────────────────────────────────

export interface ReliableSearchResult {
  /** Normalized search results */
  results: UnifiedSearchResult[];
  /** Provider that ultimately served the response */
  provider: string;
  /**
   * Full provider call chain for debugging.
   * e.g. `['gemini', 'tavily', 'duckduckgo']` means Gemini failed, Tavily failed, DDG succeeded.
   */
  providerPath: string[];
  /** Why the primary provider wasn't used (if applicable) */
  fallbackReason?: string;
  /** Attempt counts per provider */
  attempts: Record<string, number>;
  /** Total elapsed ms */
  elapsedMs: number;
}

// ─── Error Categories ──────────────────────────────────────

export type ErrorCategory =
  | 'missing_credentials'
  | 'auth_failed'
  | 'rate_limited'
  | 'timeout'
  | 'server_error'
  | 'network_error'
  | 'parse_error'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  /** Whether this error is worth retrying */
  retryable: boolean;
  /** Whether to fall through to the next provider */
  shouldFallback: boolean;
  /** Original error for logging */
  original: unknown;
}

// ─── Provider Registration ─────────────────────────────────

export interface ProviderRegistry {
  register(provider: SearchProvider): void;
  unregister(id: string): boolean;
  get(id: string): SearchProvider | undefined;
  list(): SearchProvider[];
  /** Auto-detect providers with available credentials from env vars */
  detect(): SearchProvider[];
}
