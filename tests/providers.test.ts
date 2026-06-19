/**
 * ============================================================
 *  Provider Tests — validates each provider's structure
 *  (no real API calls, just structural conformance)
 * ============================================================
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { duckduckgoProvider } from '../src/providers/duckduckgo.js';
import { braveProvider } from '../src/providers/brave.js';
import { bochaProvider } from '../src/providers/bocha.js';
import { metasoProvider } from '../src/providers/metaso.js';
import { tavilyProvider } from '../src/providers/tavily.js';
import { geminiProvider } from '../src/providers/gemini.js';
import { serpapiProvider } from '../src/providers/serpapi.js';
import { searxngProvider } from '../src/providers/searxng.js';
import type { SearchProvider } from '../src/types.js';

const allProviders: SearchProvider[] = [
  duckduckgoProvider,
  braveProvider,
  bochaProvider,
  metasoProvider,
  tavilyProvider,
  geminiProvider,
  serpapiProvider,
  searxngProvider,
];

describe('Provider interface conformance', () => {
  for (const p of allProviders) {
    describe(p.id, () => {
      it('has a string id', () => {
        assert.equal(typeof p.id, 'string');
        assert.ok(p.id.length > 0);
      });

      it('has a string name', () => {
        assert.equal(typeof p.name, 'string');
        assert.ok(p.name.length > 0);
      });

      it('has requiresKey boolean', () => {
        assert.equal(typeof p.requiresKey, 'boolean');
      });

      it('has envVars array', () => {
        assert.ok(Array.isArray(p.envVars));
      });

      it('has search method', () => {
        assert.equal(typeof p.search, 'function');
      });

      it('has normalize method', () => {
        assert.equal(typeof p.normalize, 'function');
      });

      it(`requiresKey matches envVars: ${p.id}`, () => {
        if (p.requiresKey) {
          assert.ok(p.envVars.length > 0, `${p.id} requires key but has no envVars`);
        }
      });

      it('has a numeric priority', () => {
        assert.equal(typeof p.priority, 'number');
      });

      it('has capabilities object', () => {
        assert.equal(typeof p.capabilities, 'object');
        assert.equal(typeof p.capabilities.fullWebSearch, 'boolean');
        assert.equal(typeof p.capabilities.aiGenerated, 'boolean');
      });

      it('has unique id', () => {
        const others = allProviders.filter((o) => o !== p);
        for (const o of others) {
          assert.notEqual(p.id, o.id, `duplicate id: ${p.id}`);
        }
      });
    });
  }
});

describe('DuckDuckGo specific', () => {
  it('requires no API key', () => {
    assert.equal(duckduckgoProvider.requiresKey, false);
  });

  it('has empty envVars', () => {
    assert.equal(duckduckgoProvider.envVars.length, 0);
  });
});

describe('Normalize produces valid results', () => {
  const raw = {
    results: [{ title: 'T', url: 'https://x.com', snippet: 'desc' }],
  };

  for (const p of allProviders) {
    it(`${p.id}.normalize returns UnifiedSearchResult[] with provider field`, () => {
      const results = p.normalize(raw, 'test');
      assert.ok(results.length > 0);
      for (const r of results) {
        assert.equal(typeof r.title, 'string');
        assert.equal(typeof r.url, 'string');
        assert.equal(typeof r.snippet, 'string');
        assert.equal(r.provider, p.id);
      }
    });
  }
});
