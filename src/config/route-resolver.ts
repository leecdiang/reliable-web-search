/**
 * config/route-resolver.ts — Resolve routes into executable provider attempts.
 *
 * Given v2 routes + credential profiles, produces an ordered list of
 * (provider, apiKey?) pairs that the fallback chain can execute.
 *
 * Also handles v1 backward compat: simple provider ids expand to default routes.
 */
import type { SearchProvider, ProviderRoute, CredentialProfile, ProviderExecutionContext } from '../types.js';
import { registry } from '../providers/registry.js';
import { loadCredentialProfiles } from './credentials.js';
import { loadConfigV2 } from './load.js';
import type { RwsConfigV2, ProviderRouteData } from './schema.js';

export interface RouteAttempt {
  routeId: string;
  provider: SearchProvider;
  providerId: string;
  apiKey?: string;
  credentialProfile?: string;
  credentialProfileId?: string;
}

/**
 * Resolve a list of provider ids (v1 style) into a flat list of RouteAttempts.
 * Used for backward-compat SDK calls.
 */
export function resolveProviderIdsToRoutes(providerIds: string[]): RouteAttempt[] {
  const profiles = loadCredentialProfiles();
  const routes: RouteAttempt[] = [];
  const used = new Set<string>();

  for (const pid of providerIds) {
    // Check for matching credential profiles
    const matching = Object.values(profiles).filter((p) => p.providerId === pid && p.enabled);
    if (matching.length > 0) {
      for (const profile of matching) {
        const key = profile.apiKey;
        if (!used.has(key)) {
          used.add(key);
          routes.push({
            routeId: profile.id,
            provider: registry.get(pid)!,
            providerId: pid,
            apiKey: profile.apiKey,
            credentialProfile: profile.label,
            credentialProfileId: profile.id,
          });
        }
      }
    } else {
      // Keyless provider or env-only
      const provider = registry.get(pid);
      if (provider) {
        // Check for env key
        const envKey = resolveEnvKey(pid);
        routes.push({
          routeId: `${pid}.${envKey ? 'env' : 'keyless'}`,
          provider,
          providerId: pid,
          apiKey: envKey,
          credentialProfile: envKey ? 'env' : undefined,
          credentialProfileId: envKey ? `${pid}.env` : undefined,
        });
      }
    }
  }

  return routes;
}

/**
 * Load v2 config and resolve all enabled routes into RouteAttempts.
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

  const sorted = [...routeDatas]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rd of sorted) {
    const provider = registry.get(rd.providerId);
    if (!provider) continue;

    // Credential reference specified
    if (rd.credentialRef) {
      const profile = profiles[rd.credentialRef];
      if (profile && profile.enabled) {
        // Deduplicate by API key (constant-time comparison via set membership)
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
          continue;
        }
      }
      // Fallback: check env var
      const envKey = resolveEnvKey(rd.providerId);
      if (envKey && !usedKeys.has(envKey)) {
        usedKeys.add(envKey);
        routes.push({
          routeId: `${rd.providerId}.env`,
          provider,
          providerId: rd.providerId,
          apiKey: envKey,
          credentialProfile: 'env',
          credentialProfileId: `${rd.providerId}.env`,
        });
        continue;
      }
    }

    // No credential ref — keyless provider or env-only
    if (!provider.requiresKey) {
      routes.push({
        routeId: rd.id,
        provider,
        providerId: rd.providerId,
      });
    } else {
      // Requires key — check env
      const envKey = resolveEnvKey(rd.providerId);
      if (envKey && !usedKeys.has(envKey)) {
        usedKeys.add(envKey);
        routes.push({
          routeId: `${rd.providerId}.env`,
          provider,
          providerId: rd.providerId,
          apiKey: envKey,
          credentialProfile: 'env',
          credentialProfileId: `${rd.providerId}.env`,
        });
      }
    }
  }

  return routes;
}

function resolveEnvKey(providerId: string): string | undefined {
  const envVar = `${providerId.toUpperCase()}_API_KEY`;
  const val = process.env[envVar];
  if (val && val.trim().length > 0) return val;
  return undefined;
}

export { resolveRoutesFromData };
