/**
 * config/load.ts — Load config.json from disk with validation and v1→v2 migration.
 *
 * Corrupted config: report error, do NOT silently overwrite.
 * Missing config: return defaults (not an error).
 * v1 config: load as-is (migration happens on first write).
 */
import { readFileSync, existsSync, writeFileSync, renameSync, unlinkSync, chmodSync, statSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { configFilePath } from './paths.js';
import { type RwsConfig, type RwsConfigV2, type ProviderRouteData, validate, ConfigValidationError } from './schema.js';
import { loadCredentialProfiles } from './credentials.js';

export interface LoadResult {
  config: RwsConfig;
  source: 'file' | 'default';
  warnings: string[];
}

export interface LoadResultV2 {
  config: RwsConfigV2;
  source: 'file' | 'migrated' | 'default';
  warnings: string[];
}

export function loadConfig(): LoadResult {
  const path = configFilePath();
  const warnings: string[] = [];

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: { ...toV1(defaultConfigV2()) }, source: 'default', warnings: [] };
    }
    warnings.push(`Cannot read config at ${path}: ${(err as Error).message}`);
    return { config: { ...toV1(defaultConfigV2()) }, source: 'default', warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    warnings.push(`Config file at ${path} is not valid JSON: ${(err as Error).message}. Using defaults.`);
    return { config: { ...toV1(defaultConfigV2()) }, source: 'default', warnings };
  }

  try {
    const config = validate(parsed);
    return { config, source: 'file', warnings };
  } catch (err: unknown) {
    if (err instanceof ConfigValidationError) {
      warnings.push(`Config at ${path} failed validation: ${err.message}. Using defaults.`);
      return { config: { ...toV1(defaultConfigV2()) }, source: 'default', warnings };
    }
    throw err;
  }
}

/** Load config and also return routes from v2 if available */
export function loadConfigV2(): LoadResultV2 {
  const path = configFilePath();
  const warnings: string[] = [];

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: { ...defaultConfigV2() }, source: 'default', warnings: [] };
    }
    warnings.push(`Cannot read config at ${path}: ${(err as Error).message}`);
    return { config: { ...defaultConfigV2() }, source: 'default', warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    warnings.push(`Config file at ${path} is not valid JSON. ${(err as Error).message}`);
    return { config: { ...defaultConfigV2() }, source: 'default', warnings };
  }

  const obj = parsed as Record<string, unknown>;

  // Already v2
  if (obj.version === 2 && Array.isArray(obj.routes)) {
    const cfg = parsed as RwsConfigV2;
    // Apply defaults for missing fields
    return {
      config: {
        version: 2,
        defaultStrategy: cfg.defaultStrategy ?? 'fallback',
        routes: cfg.routes,
        count: cfg.count ?? 5,
        timeoutMs: cfg.timeoutMs ?? 15_000,
        connectedHosts: cfg.connectedHosts ?? [],
        credentialPolicy: cfg.credentialPolicy ?? 'failover',
      },
      source: 'file',
      warnings,
    };
  }

  // v1 — migrate silently on load
  if (obj.version === 1) {
    try {
      const v1 = validate(parsed);
      const migrated = migrateV1ToV2(v1);
      // Write the migration back atomically
      writeMigration(path, migrated);
      warnings.push('Config migrated from v1 to v2.');
      return { config: migrated, source: 'migrated', warnings };
    } catch {
      // If v1 is corrupt, return defaults
    }
  }

  return { config: { ...defaultConfigV2() }, source: 'default', warnings };
}

function writeMigration(path: string, config: RwsConfigV2): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

  const tmp = `${path}.migrate.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, encoding: 'utf-8' });
    renameSync(tmp, path);
  } catch {
    try { unlinkSync(tmp); } catch { /* best effort */ }
  }
}

let _migratedCredentials = false;

/** Migrate credentials from v1 (flat) to v2 (profiles) */
export function migrateCredentialsV1ToV2(): boolean {
  if (_migratedCredentials) return false;

  const { loadCredentials, saveCredentialProfiles, loadCredentialProfiles } = require('./credentials.js');

  // Check if already v2
  const existing = loadCredentialProfiles();
  if (Object.keys(existing).length > 0) {
    _migratedCredentials = true;
    return false;
  }

  const flat = loadCredentials();
  if (Object.keys(flat).length === 0) {
    _migratedCredentials = true;
    return false;
  }

  const profiles: Record<string, { id: string; providerId: string; label: string; apiKey: string; enabled: boolean; createdAt: string }> = {};
  for (const [key, value] of Object.entries(flat)) {
    const providerId = key.replace(/_API_KEY$/i, '').toLowerCase();
    if (providerId && providerId !== key && typeof value === 'string') {
      profiles[`${providerId}.default`] = {
        id: `${providerId}.default`,
        providerId,
        label: 'Default',
        apiKey: value,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
    }
  }

  if (Object.keys(profiles).length > 0) {
    saveCredentialProfiles(profiles);
  }

  _migratedCredentials = true;
  return true;
}

// ── Migration logic ─────────────────────────────────

function migrateV1ToV2(v1: RwsConfig): RwsConfigV2 {
  const profiles = loadCredentialProfiles();
  const routes: ProviderRouteData[] = [];
  const seen = new Set<string>();
  let lastPriority = 0;
  let hasDuckDuckGo = false;

  // Build routes from v1 providers list
  for (const pid of v1.providers) {
    const existingProfiles = Object.values(profiles).filter((p) => p.providerId === pid);
    if (existingProfiles.length > 0) {
      for (const p of existingProfiles) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          routes.push({ id: p.id, providerId: pid, credentialRef: p.id, label: p.label, priority: lastPriority++, enabled: true });
        }
      }
    } else if (!seen.has(pid)) {
      // Keyless provider (DuckDuckGo)
      seen.add(pid);
      routes.push({ id: pid, providerId: pid, priority: lastPriority++, enabled: true });
      if (pid === 'duckduckgo') hasDuckDuckGo = true;
    }
  }

  // Detect env-keyed providers
  const envProviders = ['tavily', 'brave', 'gemini', 'serpapi', 'bocha', 'metaso'];
  for (const pid of envProviders) {
    const envVar = `${pid.toUpperCase()}_API_KEY`;
    if (process.env[envVar] && !seen.has(pid)) {
      seen.add(pid);
      routes.push({ id: `${pid}.env`, providerId: pid, credentialRef: `${pid}.env`, label: 'env', priority: lastPriority++, enabled: true });
    }
  }

  // Add DuckDuckGo as lowest-priority catch-all if no providers configured
  if (routes.length === 0) {
    routes.push({ id: 'duckduckgo', providerId: 'duckduckgo', priority: 100, enabled: true });
  }

  return {
    version: 2,
    defaultStrategy: v1.defaultStrategy,
    routes,
    count: v1.count,
    timeoutMs: v1.timeoutMs,
    connectedHosts: v1.connectedHosts,
    credentialPolicy: 'failover',
  };
}

function toV1(v2: RwsConfigV2): RwsConfig {
  return {
    version: 1,
    defaultStrategy: v2.defaultStrategy,
    providers: v2.routes.filter((r) => r.enabled).map((r) => r.providerId),
    count: v2.count,
    timeoutMs: v2.timeoutMs,
    connectedHosts: v2.connectedHosts,
  };
}

function defaultConfigV2(): RwsConfigV2 {
  return {
    version: 2,
    defaultStrategy: 'fallback',
    routes: [{ id: 'duckduckgo', providerId: 'duckduckgo', priority: 100, enabled: true }],
    count: 5,
    timeoutMs: 15_000,
    connectedHosts: [],
    credentialPolicy: 'failover',
  };
}
