/**
 * config/route-resolver.ts — Resolve routes into executable provider attempts.
 *
 * v0.4.0 behavior:
 * - Env vars ({PROVIDER}_API_KEY) generate ephemeral <provider>.env routes
 *   that are higher priority than configured file-based routes.
 * - Ephemeral env routes are NOT persisted in config.json or credentials.json.
 * - Same-key dedup: if env key == file key, only one route is generated.
 */
import type { SearchProvider, CredentialProfile } from '../types.js';
import { registry } from '../providers/registry.js';
import { loadCredentialProfiles } from './credentials.js';
import { loadConfigV2 } from './load.js';
import type { ProviderRouteData } from './schema.js';

export interface RouteAttempt {
  routeId: string;
  provider: SearchProvider;
  providerId: string;
  apiKey?: string;
  credentialProfile?: string;
  credentialProfileId?: string;
  /** True when this route comes from env vars, not config/credentials files */
  ephemeral?: boolean;
}

// ── Known env-var providers (non-experimental, requiresKey) ──────

const ENV_PROVIDERS = ['tavily', 'brave', 'gemini', 'serpapi', 'bocha', 'metaso', 'searxng'] as const;

export function resolveEnvKey(providerId: string): string | undefined {
  const envVar = `${providerId.toUpperCase()}_API_KEY`;
  const val = process.env[envVar];
  if (val && val.trim().length > 0) return val;
  return undefined;
}

/**
 * Detect all ephemeral env-var routes.
 * Returns them in registry priority order.
 */
export function detectEphemeralEnvRoutes(): RouteAttempt[] {
  const routes: RouteAttempt[] = [];
  const usedKeys = new Set<string>();
  let priority = 0;

  const all = registry.list();
  for (const provider of all) {
    if (!provider.requiresKey) continue;
    const envKey = resolveEnvKey(provider.id);
    if (envKey && !usedKeys.has(envKey)) {
      usedKeys.add(envKey);
      routes.push({
        routeId: `${provider.id}.env`,
        provider,
        providerId: provider.id,
        apiKey: envKey,
        credentialProfile: "env",
        credentialProfileId: `${provider.id}.env`,
        ephemeral: true,
      });
      priority++;
    }
  }

  return routes;
}

/**
 * Resolve a list of provider ids (v1 style) into a flat list of RouteAttempts.
 * Includes ephemeral env routes at higher priority.
 */
export function resolveProviderIdsToRoutes(providerIds: string[]): RouteAttempt[] {
  const profiles = loadCredentialProfiles();
  const routes: RouteAttempt[] = [];
  const usedKeys = new Set<string>();
  let priority = 0;

  // 1. Ephemeral env routes first
  for (const pid of providerIds) {
    const provider = registry.get(pid);
    if (!provider || !provider.requiresKey) continue;
    const envKey = resolveEnvKey(pid);
    if (envKey && !usedKeys.has(envKey)) {
      usedKeys.add(envKey);
      routes.push({
        routeId: `${pid}.env`,
        provider,
        providerId: pid,
        apiKey: envKey,
        credentialProfile: "env",
        credentialProfileId: `${pid}.env`,
        ephemeral: true,
      });
      priority++;
    }
  }

  // 2. File-based credential profiles
  for (const pid of providerIds) {
    const provider = registry.get(pid);
    if (!provider) continue;
    const matching = Object.values(profiles).filter((p) => p.providerId === pid && p.enabled);
    if (matching.length > 0) {
      for (const profile of matching) {
        if (!usedKeys.has(profile.apiKey)) {
          usedKeys.add(profile.apiKey);
          routes.push({
            routeId: profile.id,
            provider,
            providerId: pid,
            apiKey: profile.apiKey,
            credentialProfile: profile.label,
            credentialProfileId: profile.id,
          });
          priority++;
        }
      }
    } else if (!provider.requiresKey) {
      routes.push({
        routeId: pid,
        provider,
        providerId: pid,
      });
    }
  }

  return routes;
}

/**
 * Load v2 config and resolve all routes into RouteAttempts.
 * Ephemeral env routes are inserted at higher priority than file routes.
 */
export function resolveAllRoutes(): RouteAttempt[] {
  const { config } = loadConfigV2();
  const profiles = loadCredentialProfiles();

  return resolveRoutesFromData(config.routes, profiles);
}

function resolveRoutesFromData(
  routeDatas: ProviderRouteData[],
  profiles: Record<string, CredentialProfile>,
): RouteAttempt[] {
  const routes: RouteAttempt[] = [];
  const usedKeys = new Set<string>();

  // 1. Detect ephemeral env routes — highest priority
  //    Scan all providers that have env vars set
  const envScanned = new Set<string>();
  for (const provider of registry.list()) {
    if (!provider.requiresKey || envScanned.has(provider.id)) continue;
    envScanned.add(provider.id);

    const envKey = resolveEnvKey(provider.id);
    if (!envKey) continue;

    // Skip if any route in the config also uses this same key (dedup)
    const matchingProfile = Object.values(profiles).find(
      (p) => p.providerId === provider.id && p.apiKey === envKey && p.enabled,
    );
    if (matchingProfile) {
      // File profile has the same key — skip ephemeral; file route will pick it up
      continue;
    }

    if (!usedKeys.has(envKey)) {
      usedKeys.add(envKey);
      routes.push({
        routeId: `${provider.id}.env`,
        provider,
        providerId: provider.id,
        apiKey: envKey,
        credentialProfile: "env",
        credentialProfileId: `${provider.id}.env`,
        ephemeral: true,
      });
    }
  }

  // 2. Config-based routes (sorted by priority)
  const sorted = [...routeDatas]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rd of sorted) {
    const provider = registry.get(rd.providerId);
    if (!provider) continue;

    // Keyless provider
    if (!provider.requiresKey) {
      routes.push({ routeId: rd.id, provider, providerId: rd.providerId });
      continue;
    }

    // Credential reference
    if (rd.credentialRef) {
      const profile = profiles[rd.credentialRef];
      if (profile && profile.enabled) {
        if (!usedKeys.has(profile.apiKey)) {
          usedKeys.add(profile.apiKey);
          routes.push({
            routeId: rd.id,
            provider,
            providerId: rd.providerId,
            apiKey: profile.apiKey,
            credentialProfile: profile.label,
            credentialProfileId: rd.credentialRef,
          });
        }
      }
    } else {
      // No credential ref — check env (already handled by ephemeral step 1)
      // Also check for any file profile for this provider
      const anyProfile = Object.values(profiles).find(
        (p) => p.providerId === rd.providerId && p.enabled,
      );
      if (anyProfile && !usedKeys.has(anyProfile.apiKey)) {
        usedKeys.add(anyProfile.apiKey);
        routes.push({
          routeId: anyProfile.id,
          provider,
          providerId: rd.providerId,
          apiKey: anyProfile.apiKey,
          credentialProfile: anyProfile.label,
          credentialProfileId: anyProfile.id,
        });
      } else if (!resolveEnvKey(rd.providerId) && !anyProfile) {
        // No env, no profile — add keyless placeholder (will fail with clear error)
        routes.push({ routeId: rd.id, provider, providerId: rd.providerId });
      }
    }
  }

  return routes;
}

export { resolveRoutesFromData };
