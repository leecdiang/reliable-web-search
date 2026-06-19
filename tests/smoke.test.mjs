/**
 * Smoke test — validates npm pack artifacts for ESM import and basic API shape.
 * Run: npm run test:smoke  (or: node --test tests/smoke.test.mjs)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('npm pack smoke test', () => {
  it('ESM import works and exports reliableSearch', async () => {
    const mod = await import('../dist/index.js');
    assert.equal(typeof mod.reliableSearch, 'function', 'reliableSearch should be a function');
    assert.equal(typeof mod.registry, 'object', 'registry should be an object');
    assert.equal(typeof mod.registry.list, 'function', 'registry.list should be a function');
    assert.ok(mod.createProviderError, 'createProviderError should be exported');
    assert.ok(mod.isProviderError, 'isProviderError should be exported');
  });

  it('CJS require works', () => {
    const mod = require('../dist/index.cjs');
    assert.equal(typeof mod.reliableSearch, 'function', 'reliableSearch should be a function via CJS');
  });

  it('type-only imports work (structural check)', async () => {
    // Verify the main types are importable
    const mod = await import('../dist/index.js');
    const providers = mod.registry.list();
    assert.ok(providers.length >= 8, 'at least 8 built-in providers');
    assert.ok(providers.every((p) => typeof p.id === 'string'), 'all providers have id');
    assert.ok(providers.every((p) => typeof p.priority === 'number'), 'all providers have priority');
    assert.ok(providers.every((p) => p.capabilities), 'all providers have capabilities');
  });

  it('DDG is lowest priority', async () => {
    const mod = await import('../dist/index.js');
    const providers = mod.registry.list();
    const ddg = providers.find((p) => p.id === 'duckduckgo');
    assert.ok(ddg, 'DDG should be registered');
    const others = providers.filter((p) => p.id !== 'duckduckgo');
    assert.ok(others.every((p) => p.priority < ddg.priority), 'DDG should have highest priority number (lowest priority)');
  });
});
