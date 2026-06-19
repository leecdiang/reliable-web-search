/**
 * ============================================================
 *  Provider Interface — canonical contract for all providers
 * ============================================================
 *  Re-exports the SearchProvider type and documents the
 *  contract that every provider adapter must fulfill.
 *
 *  To add a new provider:
 *  1. Create `src/providers/<id>.ts`
 *  2. Export a `const` implementing SearchProvider
 *  3. Register it via `registry.register(yourProvider)`
 */

export type {
  SearchProvider,
  SearchParams,
  ProviderSearchResult,
  RawSearchItem,
  UnifiedSearchResult,
  HealthStatus,
} from '../types.js';
