/**
 * ============================================================
 *  reliable-web-search — Core Types (v0.1.1)
 * ============================================================
 */

// ─── Unified Result ────────────────────────────────────────

export interface UnifiedSearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  publishedAt?: string;
  raw?: unknown;
}

// ─── Result Status ─────────────────────────────────────────

export type ResultStatus =
  | 'success'       // provider returned usable results
  | 'partial'       // provider returned some results but below quality threshold
  | 'no_results'    // provider returned zero results (should trigger fallback)
  | 'failed'        // provider threw an error
  | 'aborted';      // request was cancelled (timeout, user AbortSignal, etc.)

// ─── Provider Error (structured) ───────────────────────────

export interface ProviderError extends Error {
  name: 'ProviderError';
  providerId: string;
  code: string;
  status?: number;          // HTTP status if applicable
  statusText?: string;
  retryable: boolean;
  shouldBreakerTrip: boolean;
  retryAfter?: number;      // seconds, from Retry-After header
  cause?: unknown;
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof Error && (e as ProviderError).name === 'ProviderError';
}

export function createProviderError(opts: {
  providerId: string;
  code: string;
  message: string;
  status?: number;
  retryable?: boolean;
  shouldBreakerTrip?: boolean;
  retryAfter?: number;
  cause?: unknown;
}): ProviderError {
  const err = new Error(opts.message) as ProviderError;
  err.name = 'ProviderError';
  err.providerId = opts.providerId;
  err.code = opts.code;
  err.status = opts.status;
  err.retryable = opts.retryable ?? false;
  err.shouldBreakerTrip = opts.shouldBreakerTrip ?? true;
  err.retryAfter = opts.retryAfter;
  err.cause = opts.cause;
  return err;
}

// ─── Provider Interface ────────────────────────────────────

export interface SearchParams {
  query: string;
  count: number;
  country?: string;
  language?: string;
  freshness?: SearchFreshness;
  signal?: AbortSignal;
}

export type SearchFreshness = 'day' | 'week' | 'month' | 'year';

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
 * Capabilities that a provider declares, used to rank providers
 * during auto-detection and to decide fallback strategy.
 */
export interface ProviderCapabilities {
  /** Whether this provider does full web search (not just instant answers) */
  fullWebSearch: boolean;
  /** Whether this provider returns AI-synthesized answers vs raw web results */
  aiGenerated: boolean;
  /** Max results this provider can return per call */
  maxResults: number;
  /** Supported freshness/date filters */
  freshnessSupport: boolean;
  /** True when the provider's API contract is not yet verified against real responses */
  experimental?: boolean;
}

export interface SearchProvider {
  readonly id: string;
  readonly name: string;
  readonly requiresKey: boolean;
  readonly envVars: readonly string[];
  /**
   * Priority for auto-detection ordering. Lower = tried first.
   * Defaults: 10 (keyed, full web search), 50 (keyed, AI search),
   * 90 (keyless), 100 (DuckDuckGo last resort)
   */
  readonly priority: number;
  /** Declared capabilities used for ranking and quality decisions */
  readonly capabilities: ProviderCapabilities;
  /** Quick check: is this provider currently configured/usable? */
  isConfigured?(): boolean;
  healthCheck?(): Promise<HealthStatus>;
  /**
   * Execute a search.  If `ctx.apiKey` is provided it MUST be used
   * instead of reading from environment variables (multi-credential support).
   */
  search(params: SearchParams, ctx?: ProviderExecutionContext): Promise<ProviderSearchResult>;
  normalize(raw: ProviderSearchResult, query: string): UnifiedSearchResult[];
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

// ═══════════════════════════════════════════════════════════
//  v0.4.0 — Multi-Provider / Multi-Credential types
// ═══════════════════════════════════════════════════════════

/**
 * A single credential profile — a named API key for a provider.
 * Stored inside credentials.json (version 2).
 */
export interface CredentialProfile {
  id: string;             // unique within the file, e.g. "tavily.personal"
  providerId: string;     // e.g. "tavily"
  label: string;          // human-readable, e.g. "Personal"
  apiKey: string;
  enabled: boolean;
  createdAt?: string;     // ISO-8601
}

/**
 * A single search route — mapping a provider + optional credential
 * onto the ordered execution list.
 */
export interface ProviderRoute {
  id: string;             // unique, e.g. "tavily.personal"
  providerId: string;     // e.g. "tavily"
  credentialRef?: string; // reference into credential profiles, optional for keyless providers
  label?: string;         // optional display label
  priority: number;       // execution order, lower = first
  enabled: boolean;
}

/**
 * Credential failover policy.
 * Currently only 'failover' is supported.
 */
export type CredentialPolicy = 'failover';

/**
 * Provider execution context — passed into search() calls.
 */
export interface ProviderExecutionContext {
  signal?: AbortSignal;
  apiKey?: string;
  credentialProfileId?: string;
}

/**
 * v2 Credentials file format.
 */
export interface CredentialsFileV2 {
  version: number;
  profiles: Record<string, CredentialProfile>;
}

/**
 * v2 Config file format.
 */
export interface RwsConfigV2 {
  version: number;
  defaultStrategy: 'fallback' | 'race' | 'aggregate';
  routes: ProviderRoute[];
  count: number;
  timeoutMs: number;
  connectedHosts: string[];
  credentialPolicy?: CredentialPolicy;
}

// ─── Main API Options ──────────────────────────────────────

export interface ReliableSearchOptions {
  providers?: string[];
  count?: number;
  country?: string;
  language?: string;
  freshness?: SearchFreshness;
  fallback?: FallbackConfig;
  cache?: CacheConfig;
  timeout?: number;
  signal?: AbortSignal;
  /** Minimum results to consider a provider "successful". Default 1. */
  minResults?: number;
  /** Fallback policies: which result states trigger fallthrough */
  fallbackOn?: ResultStatus[];
}

export interface FallbackConfig {
  mode?: 'fallback' | 'race' | 'aggregate';
  /** @deprecated kept for backward compat, use mode: 'fallback' */
  sequential?: never;
  /** @deprecated kept for backward compat, use mode: 'race' */
  parallel?: never;
  /** @deprecated kept for backward compat, use mode: 'aggregate' */
  'best-effort'?: never;
  maxRetries?: number;
  circuitBreaker?: CircuitBreakerConfig | false;
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  recoveryTimeout?: number;
  halfOpenMaxRequests?: number;
}

export interface CacheConfig {
  enabled?: boolean;
  ttl?: number;
  maxSize?: number;
}

// ─── Main API Result ───────────────────────────────────────

export interface ReliableSearchResult {
  results: UnifiedSearchResult[];
  provider: string;
  providerPath: string[];
  fallbackReason?: string;
  attempts: AttemptRecord[];
  elapsedMs: number;
  retrievalSucceeded: boolean;
  usableForReview: boolean;
  resultStatus: ResultStatus;
  /** True when this result came from the in-memory cache */
  cacheHit: boolean;
}

export interface AttemptRecord {
  providerId: string;
  attempt: number;
  status: ResultStatus;
  resultCount: number;
  elapsedMs: number;
  errorCode?: string;
  httpStatus?: number;
  /** v0.4.0: route identifier for multi-credential execution */
  routeId?: string;
  /** v0.4.0: credential profile label (NOT the key) */
  credentialProfile?: string;
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
  | 'no_results'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  shouldFallback: boolean;
  shouldBreakerTrip: boolean;
  original: unknown;
}

// ─── Provider Registration ─────────────────────────────────

export interface ProviderRegistry {
  register(provider: SearchProvider): void;
  unregister(id: string): boolean;
  get(id: string): SearchProvider | undefined;
  list(): SearchProvider[];
  detect(): SearchProvider[];
  /** Suggest corrections for a misspelled provider id */
  suggest(candidate: string): string[];
}
