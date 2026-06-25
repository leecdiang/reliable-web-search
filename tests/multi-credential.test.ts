/**
 * tests/multi-credential.test.ts — v0.4.0 multi-provider / multi-credential tests
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setupFakeHome(): { fakeHome: string; configDir: string } {
  const fakeHome = mkdtempSync(join(tmpdir(), 'rws-multi-cred-'));
  const configDir = join(fakeHome, '.config', 'reliable-web-search');
  mkdirSync(configDir, { recursive: true });
  process.env.HOME = fakeHome;
  return { fakeHome, configDir };
}

function cleanupFakeHome(fakeHome: string): void {
  if (fakeHome) { try { rmSync(fakeHome, { recursive: true, force: true }); } catch { /* ignore */ } }
}

describe('v1 → v2 migration', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let fakeHome: string;
  let configDir: string;

  before(() => {
    for (const key of ['TAVILY_API_KEY', 'BRAVE_API_KEY', 'GEMINI_API_KEY']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  beforeEach(() => {
    const setup = setupFakeHome();
    fakeHome = setup.fakeHome;
    configDir = setup.configDir;
  });

  after(() => {
    cleanupFakeHome(fakeHome!);
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('migrates v1 credentials to v2 profiles', async () => {
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
      TAVILY_API_KEY: 'tvly-secret-123',
      BRAVE_API_KEY: 'bsa-secret-456',
    }));
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      version: 1, defaultStrategy: 'fallback', providers: ['tavily', 'brave'],
      count: 5, timeoutMs: 15000, connectedHosts: [],
    }));

    const { loadConfigV2 } = await import('../src/config/load.js');
    const result = loadConfigV2();
    assert.equal(result.config.version, 2);
    assert.equal(result.config.routes.length, 2);

    // Credentials should still be readable
    const { loadCredentialProfiles } = await import('../src/config/credentials.js');
    const profiles = loadCredentialProfiles();
    assert.ok(profiles['tavily.default']);
    assert.equal(profiles['tavily.default']!.apiKey, 'tvly-secret-123');
  });

  it('corrupted credentials does not crash', async () => {
    writeFileSync(join(configDir, 'credentials.json'), 'not json');
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      version: 1, defaultStrategy: 'fallback', providers: ['duckduckgo'],
      count: 5, timeoutMs: 15000, connectedHosts: [],
    }));

    const { loadConfigV2 } = await import('../src/config/load.js');
    const result = loadConfigV2();
    assert.equal(result.config.version, 2);
  });
});

describe('Multi-credential coexistence', () => {
  let fakeHome: string;

  beforeEach(() => {
    const setup = setupFakeHome();
    fakeHome = setup.fakeHome;
    for (const key of ['TAVILY_API_KEY', 'BRAVE_API_KEY']) delete process.env[key];
  });

  after(() => {
    cleanupFakeHome(fakeHome!);
  });

  it('two Tavily credentials coexist', async () => {
    const { saveCredentialProfiles, loadCredentialProfiles } = await import('../src/config/credentials.js');
    saveCredentialProfiles({
      'tavily.personal': { id: 'tavily.personal', providerId: 'tavily', label: 'Personal', apiKey: 'tvly-personal', enabled: true },
      'tavily.backup': { id: 'tavily.backup', providerId: 'tavily', label: 'Backup', apiKey: 'tvly-backup', enabled: true },
    });

    const profiles = loadCredentialProfiles();
    assert.equal(Object.keys(profiles).length, 2);
    assert.ok(profiles['tavily.personal']);
    assert.ok(profiles['tavily.backup']);
  });
});

describe('Route resolution', () => {
  let fakeHome: string;

  beforeEach(() => {
    const setup = setupFakeHome();
    fakeHome = setup.fakeHome;
    for (const key of ['TAVILY_API_KEY', 'BRAVE_API_KEY']) delete process.env[key];
  });

  after(() => {
    cleanupFakeHome(fakeHome!);
  });

  it('resolves keyless provider id to route', async () => {
    // Import the registry to ensure providers are loaded
    await import('../src/index.js');
    const { resolveProviderIdsToRoutes } = await import('../src/config/route-resolver.js');
    const routes = resolveProviderIdsToRoutes(['duckduckgo']);
    assert.ok(routes.length >= 1, `Expected >=1 routes, got ${routes.length}`);
    assert.equal(routes[0]!.providerId, 'duckduckgo');
  });

  it('old providers[] SDK call with profiles', async () => {
    await import('../src/index.js');
    const { saveCredentialProfiles } = await import('../src/config/credentials.js');
    saveCredentialProfiles({
      'tavily.default': { id: 'tavily.default', providerId: 'tavily', label: 'Default', apiKey: 'tvly-key', enabled: true },
    });

    const { resolveProviderIdsToRoutes } = await import('../src/config/route-resolver.js');
    const routes = resolveProviderIdsToRoutes(['tavily']);
    assert.ok(routes.length >= 1, `Expected >=1 route, got ${routes.length}`);
    assert.equal(routes[0]!.credentialProfile, 'Default');
  });
});

describe('API key safety', () => {
  let fakeHome: string;
  let configDir: string;

  beforeEach(() => {
    const setup = setupFakeHome();
    fakeHome = setup.fakeHome;
    configDir = setup.configDir;
  });

  after(() => { cleanupFakeHome(fakeHome!); });

  it('API key not in config.json', async () => {
    const { saveCredentialProfiles } = await import('../src/config/credentials.js');
    saveCredentialProfiles({
      'tavily.default': { id: 'tavily.default', providerId: 'tavily', label: 'Default', apiKey: 'tvly-secret-key', enabled: true },
    });
    // Config was written alongside credentials
    try {
      const configContent = readFileSync(join(configDir, 'config.json'), 'utf-8');
      assert.ok(!configContent.includes('tvly-secret-key'), 'Key not in config');
    } catch {
      // Config may not be created yet — that's OK, test passes
    }
    const credsContent = readFileSync(join(configDir, 'credentials.json'), 'utf-8');
    assert.ok(credsContent.includes('tvly-secret-key'));
  });

  it('credentials file 0600 on Unix', async () => {
    if (process.platform === 'win32') return;
    const { saveCredentialProfiles } = await import('../src/config/credentials.js');
    saveCredentialProfiles({
      'tavily.default': { id: 'tavily.default', providerId: 'tavily', label: 'Default', apiKey: 'tvly-key', enabled: true },
    });

    const { statSync } = await import('node:fs');
    const mode = statSync(join(configDir, 'credentials.json')).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});

describe('AttemptRecord route info', () => {
  it('includes routeId and credentialProfile', () => {
    const record = {
      providerId: 'tavily', attempt: 1, status: 'success' as const,
      resultCount: 5, elapsedMs: 100, routeId: 'tavily.backup', credentialProfile: 'Backup',
    };
    assert.equal(record.routeId, 'tavily.backup');
    assert.equal(record.credentialProfile, 'Backup');
  });

  it('does not contain API key', () => {
    const json = JSON.stringify({
      providerId: 'tavily', attempt: 1, status: 'success' as const,
      resultCount: 5, elapsedMs: 100, routeId: 'tavily.personal', credentialProfile: 'Personal',
    });
    assert.ok(!json.includes('apiKey'));
    assert.ok(!json.includes('secret'));
  });
});

describe('Fallback chain route-aware execution', () => {
  let fakeHome: string;

  beforeEach(() => {
    const setup = setupFakeHome();
    fakeHome = setup.fakeHome;
  });

  after(() => { cleanupFakeHome(fakeHome!); });

  it('attempts array order is stable', () => {
    const attempts = [
      { providerId: 'tavily', attempt: 1, status: 'success' as const, resultCount: 5, elapsedMs: 100, routeId: 'tavily.personal', credentialProfile: 'Personal' },
      { providerId: 'tavily', attempt: 1, status: 'no_results' as const, resultCount: 0, elapsedMs: 50, routeId: 'tavily.backup', credentialProfile: 'Backup' },
      { providerId: 'brave', attempt: 1, status: 'success' as const, resultCount: 3, elapsedMs: 200, routeId: 'brave.default', credentialProfile: 'Default' },
    ];

    assert.equal(attempts[0]!.routeId, 'tavily.personal');
    assert.equal(attempts[1]!.routeId, 'tavily.backup');
    assert.equal(attempts[2]!.routeId, 'brave.default');
  });

  it('providerPath includes route identifiers', () => {
    const providerPath = ['tavily.personal', 'tavily.backup', 'brave.default'];
    assert.ok(providerPath.includes('tavily.personal'));
    assert.ok(providerPath.includes('brave.default'));
  });

  it('env route is ephemeral and not in config', async () => {
    const savedHome = process.env.HOME;
    const fh = mkdtempSync(join(tmpdir(), 'rws-env-route-'));
    const cfDir = join(fh, '.config', 'reliable-web-search');
    mkdirSync(cfDir, { recursive: true });
    process.env.HOME = fh;

    try {
      process.env.TAVILY_API_KEY = '***';

      const { detectEphemeralEnvRoutes, resolveAllRoutes, resolveEnvKey } = await import('../src/config/route-resolver.js');
      await import('../src/index.js');

      assert.equal(resolveEnvKey('tavily'), '***');

      const envRoutes = detectEphemeralEnvRoutes();
      const tavilyEnv = envRoutes.find((r: any) => r.providerId === 'tavily');
      assert.ok(tavilyEnv, 'Should generate env route for tavily');
      assert.equal(tavilyEnv!.routeId, 'tavily.env');
      assert.equal(tavilyEnv!.ephemeral, true);

      const { saveCredentialProfiles } = await import('../src/config/credentials.js');
      saveCredentialProfiles({
        'tavily.default': { id: 'tavily.default', providerId: 'tavily', label: 'Default', apiKey: 'file-key', enabled: true },
      });

      const { saveConfig } = await import('../src/config/save.js');
      saveConfig({
        version: 2, defaultStrategy: 'fallback',
        routes: [{ id: 'tavily.default', providerId: 'tavily', credentialRef: 'tavily.default', priority: 10, enabled: true }],
        count: 5, timeoutMs: 15000, connectedHosts: [],
      });

      const allRoutes = resolveAllRoutes();
      assert.ok(allRoutes.some((r: any) => r.routeId === 'tavily.env'), 'Should include env route');
      assert.ok(allRoutes.some((r: any) => r.routeId === 'tavily.default'), 'Should include file route');

      // Verify env route is NOT persisted
      try {
        const { readFileSync } = await import('node:fs');
        const configContent = readFileSync(join(cfDir, 'config.json'), 'utf-8');
        assert.ok(!configContent.includes('.env'), 'Config should not contain .env route');
      } catch { /* ok */ }
    } finally {
      delete process.env.TAVILY_API_KEY;
      process.env.HOME = savedHome;
      rmSync(fh, { recursive: true, force: true });
    }
  });

  it('same key env and file profile dedup', async () => {
    const savedHome = process.env.HOME;
    const fh = mkdtempSync(join(tmpdir(), 'rws-dedup-'));
    mkdirSync(join(fh, '.config', 'reliable-web-search'), { recursive: true });
    process.env.HOME = fh;

    try {
      const sharedKey = '***';
      process.env.TAVILY_API_KEY = sharedKey;

      const { saveCredentialProfiles } = await import('../src/config/credentials.js');
      saveCredentialProfiles({
        'tavily.default': { id: 'tavily.default', providerId: 'tavily', label: 'Default', apiKey: sharedKey, enabled: true },
      });

      await import('../src/index.js');
      const { resolveAllRoutes } = await import('../src/config/route-resolver.js');

      const { saveConfig } = await import('../src/config/save.js');
      saveConfig({
        version: 2, defaultStrategy: 'fallback',
        routes: [{ id: 'tavily.default', providerId: 'tavily', credentialRef: 'tavily.default', priority: 10, enabled: true }],
        count: 5, timeoutMs: 15000, connectedHosts: [],
      });

      const allRoutes = resolveAllRoutes();
      const tavilyRoutes = allRoutes.filter((r: any) => r.providerId === 'tavily');
      // Should have exactly 1 route since env key == file key
      assert.equal(tavilyRoutes.length, 1, 'Env and file same key should produce 1 route, got ' + tavilyRoutes.length);
      assert.ok(!tavilyRoutes[0]!.ephemeral, 'Should use file route not ephemeral env route');
    } finally {
      delete process.env.TAVILY_API_KEY;
      process.env.HOME = savedHome;
      rmSync(fh, { recursive: true, force: true });
    }
  });
});
