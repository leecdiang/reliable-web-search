/**
 * ============================================================
 *  Cache Tests
 * ============================================================
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SearchCache } from '../src/cache.js';

describe('SearchCache', () => {
  it('stores and retrieves entries', () => {
    const cache = new SearchCache();
    const results = [{ title: 'Test', url: 'https://example.com', snippet: 'test', provider: 'test' }];
    cache.set('key1', { results, provider: 'test', providerPath: ['test'], attempts: { test: 1 } });
    const hit = cache.get('key1');
    assert.ok(hit);
    assert.equal(hit?.results[0]?.title, 'Test');
  });

  it('returns undefined for missing keys', () => {
    const cache = new SearchCache();
    assert.equal(cache.get('nonexistent'), undefined);
  });

  it('generates consistent keys', () => {
    const a = SearchCache.key('hello', { count: 5 });
    const b = SearchCache.key('hello', { count: 5 });
    assert.equal(a, b);
  });

  it('generates different keys for different queries', () => {
    const a = SearchCache.key('hello', { count: 5 });
    const b = SearchCache.key('world', { count: 5 });
    assert.notEqual(a, b);
  });
});
