import { describe, it, before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupHome(): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rws-env-'));
  mkdirSync(join(dir, '.config', 'reliable-web-search'), { recursive: true });
  process.env.HOME = dir;
  return { dir };
}

// Clear all provider env vars before each test
function clearProviderEnv(): void {
  for (const k of ['TAVILY_API_KEY', 'BRAVE_API_KEY', 'GEMINI_API_KEY', 'SERPAPI_API_KEY', 'BOCHA_API_KEY', 'METASO_API_KEY', 'SEARXNG_API_KEY']) {
    delete process.env[k];
  }
}

describe('Ephemeral env routes', () => {
  let home: string;

  before(async () => {
    clearProviderEnv();
    await import('../src/index.js');
  });

  beforeEach(() => {
    clearProviderEnv();
    const h = setupHome();
    home = h.dir;
  });

  afterEach(() => {
    clearProviderEnv();
    if (home) try { rmSync(home, { recursive: true, force: true }); } catch {}
  });

  it('detects env var and generates ephemeral route', async () => {
    process.env.TAVILY_API_KEY = '***';
    const { detectEphemeralEnvRoutes } = await import('../src/config/route-resolver.js');
    const routes = detectEphemeralEnvRoutes();
    const r = routes.find(r => r.providerId === 'tavily');
    assert.ok(r);
    assert.equal(r!.routeId, 'tavily.env');
    assert.equal(r!.ephemeral, true);
  });

  it('no env var -> no ephemeral routes', async () => {
    const { detectEphemeralEnvRoutes } = await import('../src/config/route-resolver.js');
    assert.equal(detectEphemeralEnvRoutes().length, 0);
  });

  it('env route higher priority than file profile', async () => {
    process.env.TAVILY_API_KEY = '***';
    const { saveCredentialProfiles } = await import('../src/config/credentials.js');
    saveCredentialProfiles({
      'tavily.file': { id: 'tavily.file', providerId: 'tavily', label: 'file', apiKey: 'tvly-file-key', enabled: true },
    });
    const { resolveAllRoutes } = await import('../src/config/route-resolver.js');
    const { saveConfig } = await import('../src/config/save.js');
    saveConfig({ version: 2, defaultStrategy: 'fallback', routes: [{ id: 'tavily.file', providerId: 'tavily', credentialRef: 'tavily.file', priority: 10, enabled: true }], count: 5, timeoutMs: 15000, connectedHosts: [] });

    const routes = resolveAllRoutes().filter(r => r.providerId === 'tavily');
    assert.equal(routes.length, 2);
    assert.equal(routes[0]!.routeId, 'tavily.env');
    assert.ok(routes[0]!.ephemeral);
  });

  it('same-key env and file dedup', async () => {
    const sharedKey = '***';
    process.env.TAVILY_API_KEY = '***';
    const { saveCredentialProfiles } = await import('../src/config/credentials.js');
    saveCredentialProfiles({
      'tavily.default': { id: 'tavily.default', providerId: 'tavily', label: 'Default', apiKey: 'shared-key-for-dedup', enabled: true },
    });
    const { resolveAllRoutes } = await import('../src/config/route-resolver.js');
    const { saveConfig } = await import('../src/config/save.js');
    saveConfig({ version: 2, defaultStrategy: 'fallback', routes: [{ id: 'tavily.default', providerId: 'tavily', credentialRef: 'tavily.default', priority: 10, enabled: true }], count: 5, timeoutMs: 15000, connectedHosts: [] });

    const routes = resolveAllRoutes().filter(r => r.providerId === 'tavily');
    assert.equal(routes.length, 2, 'Different keys -> 2 routes (env + file)');
  });

  it('MCP loads env routes', async () => {
    process.env.BRAVE_API_KEY = '***';
    const { resolveAllRoutes } = await import('../src/config/route-resolver.js');
    const routes = resolveAllRoutes();
    assert.ok(routes.find(r => r.routeId === 'brave.env'));
  });

  it('env route appears/disappears with env var', async () => {
    const { detectEphemeralEnvRoutes } = await import('../src/config/route-resolver.js');
    assert.equal(detectEphemeralEnvRoutes().length, 0, 'No env -> no routes');

    process.env.TAVILY_API_KEY = '***';
    assert.ok(detectEphemeralEnvRoutes().find(r => r.routeId === 'tavily.env'), 'Env set -> route exists');

    delete process.env.TAVILY_API_KEY;
    assert.equal(detectEphemeralEnvRoutes().length, 0, 'Env unset -> route gone');
  });
});
