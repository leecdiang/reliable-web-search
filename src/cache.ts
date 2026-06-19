/**
 * ============================================================
 *  LRU Cache — TTL-based in-memory cache for search results
 * ============================================================
 *  Simple LRU cache with per-entry TTL. No external dependencies.
 *  Used to avoid redundant API calls for identical queries.
 */

import type { UnifiedSearchResult, AttemptRecord } from './types.js';

interface CacheEntry {
  results: UnifiedSearchResult[];
  provider: string;
  providerPath: string[];
  attempts: AttemptRecord[];
  createdAt: number;
}

export interface CacheOptions {
  /** Max entries (default 500) */
  maxSize: number;
  /** Entry TTL in ms (default 900000 = 15 min) */
  ttl: number;
}

export class SearchCache {
  private _cache = new Map<string, CacheEntry>();
  private _maxSize: number;
  private _ttl: number;

  constructor(options?: Partial<CacheOptions>) {
    this._maxSize = options?.maxSize ?? 500;
    this._ttl = options?.ttl ?? 900_000;
  }

  /** Build a cache key from query + params */
  static key(query: string, options?: Record<string, unknown>): string {
    const params = options
      ? Object.entries(options)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join('&')
      : '';
    return `${query}|${params}`;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this._cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.createdAt > this._ttl) {
      this._cache.delete(key);
      return undefined;
    }

    // LRU: move to end
    this._cache.delete(key);
    this._cache.set(key, entry);
    return entry;
  }

  set(key: string, entry: Omit<CacheEntry, 'createdAt'>): void {
    // Evict oldest if at capacity
    if (this._cache.size >= this._maxSize) {
      const oldest = this._cache.keys().next().value;
      if (oldest) this._cache.delete(oldest);
    }

    this._cache.set(key, { ...entry, createdAt: Date.now() });
  }

  clear(): void {
    this._cache.clear();
  }

  get size(): number {
    return this._cache.size;
  }
}
