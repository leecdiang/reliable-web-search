/**
 * config/management.ts — Credential and route management commands (v0.4.0)
 */
import { loadCredentialProfiles, upsertCredentialProfile, removeCredentialProfile, saveCredentialProfiles } from './credentials.js';
import { loadConfigV2 } from './load.js';
import { saveConfig } from './save.js';
import { maskSecret } from './mask-secret.js';
import { registry } from '../providers/registry.js';
import { select, input, confirm } from '@inquirer/prompts';
import { isTTY } from '../is-tty.js';

// ── List credentials ─────────────────────────────────

export function listCredentials(): void {
  const profiles = loadCredentialProfiles();
  console.log('Credential profiles:\n');

  if (Object.keys(profiles).length === 0) {
    console.log('  (none configured)');
    return;
  }

  const sorted = Object.values(profiles).sort((a, b) => {
    if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
    return a.label.localeCompare(b.label);
  });

  for (const p of sorted) {
    const status = p.enabled ? '' : ' [disabled]';
    console.log(`  ${p.id}: ${p.providerId} / ${p.label} (${maskSecret(p.apiKey)})${status}`);
  }
}

// ── Add credential ───────────────────────────────────

export async function addCredential(providerId: string, labelArg?: string): Promise<void> {
  const provider = registry.get(providerId);
  if (!provider) {
    console.log(`Unknown provider "${providerId}".`);
    const suggestions = registry.suggest(providerId);
    if (suggestions.length > 0) console.log(`Did you mean: ${suggestions.join(', ')}?`);
    process.exit(1);
  }

  if (!provider.requiresKey) {
    console.log(`${provider.name} does not require an API key.`);
    return;
  }

  const profiles = Object.values(loadCredentialProfiles()).filter(p => p.providerId === providerId);
  let label = labelArg || (profiles.length === 0 ? 'default' : `backup-${profiles.length + 1}`);

  if (!labelArg && isTTY()) {
    label = await input({ message: 'Label for this credential:', default: label });
  } else if (!labelArg) {
    label = `cli-${Date.now()}`;
  }

  const profileId = `${providerId}.${label}`;

  // Check for existing
  const existing = loadCredentialProfiles();
  if (existing[profileId]) {
    console.log(`Credential "${profileId}" already exists. Use a different label or remove it first.`);
    return;
  }

  let apiKey = '';

  if (isTTY()) {
    const { password } = await import('@inquirer/prompts');
    apiKey = await password({
      message: `Enter API key for ${provider.name} "${label}":`,
      mask: '*',
    });
  } else {
    // Non-TTY: read from stdin or env
    apiKey = process.env[`${providerId.toUpperCase()}_CLI_KEY`] || '';
  }

  if (!apiKey || apiKey.trim().length === 0) {
    console.log('No API key provided.');
    process.exit(1);
  }

  upsertCredentialProfile({
    id: profileId,
    providerId,
    label,
    apiKey: apiKey.trim(),
    enabled: true,
    createdAt: new Date().toISOString(),
  });

  console.log(`✓ Credential "${profileId}" saved`);
}

// ── Remove credential ────────────────────────────────

export async function removeCredential(profileId: string, opts?: { yes?: boolean }): Promise<void> {
  const profiles = loadCredentialProfiles();
  const profile = profiles[profileId];
  if (!profile) {
    console.log(`Credential "${profileId}" not found.`);
    return;
  }

  // Check if any route references this credential
  const { config } = loadConfigV2();
  const referencingRoutes = config.routes.filter(r => r.credentialRef === profileId);

  if (referencingRoutes.length > 0) {
    console.log(`Credential "${profileId}" is referenced by ${referencingRoutes.length} route(s).`);

    let proceed = opts?.yes === true;
    if (!proceed && isTTY()) {
      proceed = await confirm({
        message: `Delete ${referencingRoutes.length} associated route(s) along with the credential?`,
        default: true,
      });
    } else if (!proceed) {
      proceed = process.argv.includes('--yes');
    }

    if (!proceed) {
      console.log('Credential not removed.');
      return;
    }

    // Remove referencing routes
    const remainingRoutes = config.routes.filter(r => r.credentialRef !== profileId);
    saveConfig({
      ...config,
      routes: remainingRoutes,
    });
    console.log(`✓ Removed ${referencingRoutes.length} associated route(s)`);
  }

  removeCredentialProfile(profileId);
  console.log(`✓ Credential "${profileId}" removed`);
}

// ── Disable / Enable credential ──────────────────────

export function toggleCredential(profileId: string, enabled: boolean): void {
  const profiles = loadCredentialProfiles();
  const profile = profiles[profileId];
  if (!profile) {
    console.log(`Credential "${profileId}" not found.`);
    return;
  }
  upsertCredentialProfile({ ...profile, enabled });
  console.log(`✓ Credential "${profileId}" ${enabled ? 'enabled' : 'disabled'}`);
}

// ── List routes ──────────────────────────────────────

export function listRoutes(): void {
  const { config } = loadConfigV2();

  if (config.routes.length === 0) {
    console.log('No routes configured.');
    return;
  }

  console.log('Search routes (in execution order):\n');

  const sorted = [...config.routes].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.priority - b.priority;
  });

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!;
    const label = r.label ? `${r.label}` : r.id;
    const status = r.enabled ? '' : ' [disabled]';
    console.log(`  ${i + 1}. ${r.providerId} / ${label} (pri: ${r.priority})${status}`);
  }
}

// ── Move route ───────────────────────────────────────

export function moveRoute(routeId: string, beforeRouteId?: string): void {
  const { config } = loadConfigV2();
  const route = config.routes.find(r => r.id === routeId);
  if (!route) {
    console.log(`Route "${routeId}" not found.`);
    return;
  }

  let routes = [...config.routes];
  const without = routes.filter(r => r.id !== routeId);

  if (beforeRouteId) {
    const target = without.find(r => r.id === beforeRouteId);
    if (!target) {
      console.log(`Target route "${beforeRouteId}" not found.`);
      return;
    }
    // Recalculate priorities
    const moved = routes.find(r => r.id === routeId)!;
    let result: typeof routes = [];
    let nextPri = 10;

    for (const r of without.sort((a, b) => a.priority - b.priority)) {
      if (r.id === beforeRouteId) {
        moved.priority = target.priority - 5;
        result.push(moved);
        nextPri = moved.priority + 10;
        r.priority = nextPri;
        result.push(r);
      } else {
        r.priority = nextPri;
        result.push(r);
      }
      nextPri += 10;
    }

    saveConfig({ ...config, routes: result });
    console.log(`✓ Route "${routeId}" moved before "${beforeRouteId}"`);
  } else {
    console.log(`Usage: rws routes move <route-id> --before <other-route-id>`);
  }
}

// ── Toggle route enabled ─────────────────────────────

export function toggleRoute(routeId: string, enabled: boolean): void {
  const { config } = loadConfigV2();
  const route = config.routes.find(r => r.id === routeId);
  if (!route) {
    console.log(`Route "${routeId}" not found.`);
    return;
  }

  const updated = config.routes.map(r => r.id === routeId ? { ...r, enabled } : r);
  saveConfig({ ...config, routes: updated });
  console.log(`✓ Route "${routeId}" ${enabled ? 'enabled' : 'disabled'}`);
}
