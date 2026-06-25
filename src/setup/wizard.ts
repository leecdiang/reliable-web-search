/**
 * setup/wizard.ts — Iterative multi-provider / multi-credential setup wizard (v0.4.0)
 */
import { select, input, password, confirm } from '@inquirer/prompts';
import { registry } from '../providers/registry.js';
import { loadConfigV2 } from '../config/load.js';
import { saveConfig } from '../config/save.js';
import { loadCredentialProfiles, upsertCredentialProfile, removeCredentialProfile, saveCredentialProfiles } from '../config/credentials.js';
import { maskSecret } from '../config/mask-secret.js';
import type { RwsConfigV2, ProviderRouteData } from '../config/schema.js';
import type { RouteAttempt } from '../config/route-resolver.js';

let _cachedWarnings: string[] = [];

export function getWarnings(): string[] { return _cachedWarnings; }

/**
 * Run the iterative setup wizard.
 * Returns the final config without agents — caller handles agent detection.
 */
export async function runSetupWizard(): Promise<RwsConfigV2> {
  _cachedWarnings = [];
  console.log('\nWelcome to reliable-web-search v0.4.0\n');

  // Load existing (or default) config
  const { config: existingConfig, warnings, source } = loadConfigV2();
  if (warnings.length > 0) {
    for (const w of warnings) console.log(`  ⚠ ${w}`);
    _cachedWarnings = warnings;
  }

  if (source === 'file') {
    console.log('✓ Existing configuration found');
  }

  // Build initial routes from existing config
  let routes = [...existingConfig.routes];

  // Main loop
  let finished = false;
  while (!finished) {
    const choice = await mainMenu(routes);
    switch (choice) {
      case 'add-provider':
        routes = await addProviderHandler(routes);
        break;
      case 'manage-existing':
        routes = await manageExistingProvider(routes);
        break;
      case 'review-routes':
        routes = await reviewAndAdjustRoutes(routes);
        break;
      case 'finish':
        finished = true;
        break;
    }
  }

  // Save final config
  const finalConfig: RwsConfigV2 = {
    version: 2,
    defaultStrategy: existingConfig.defaultStrategy ?? 'fallback',
    routes,
    count: existingConfig.count ?? 5,
    timeoutMs: existingConfig.timeoutMs ?? 15_000,
    connectedHosts: existingConfig.connectedHosts ?? [],
    credentialPolicy: 'failover',
  };

  try {
    saveConfig(finalConfig);
    console.log('✓ Configuration saved');
  } catch (err: unknown) {
    console.log(`⚠ Could not save config: ${(err as Error).message}`);
  }

  console.log('\n' + renderRouteSummary(routes));
  return finalConfig;
}

async function mainMenu(routes: ProviderRouteData[], message?: string): Promise<'add-provider' | 'manage-existing' | 'review-routes' | 'finish'> {
  const choices: Array<{ value: string; name: string }> = [
    { value: 'add-provider', name: 'Add another provider' },
  ];

  // Check if any existing provider can have additional credentials
  if (routes.length > 0) {
    choices.push({ value: 'manage-existing', name: 'Add credentials / manage existing' });
    choices.push({ value: 'review-routes', name: 'Review and adjust search route' });
  }

  choices.push({ value: 'finish', name: 'Finish provider setup' });

  return select({
    message: message ?? 'What would you like to do next?',
    choices,
  }) as Promise<'add-provider' | 'manage-existing' | 'review-routes' | 'finish'>;
}

/** Add a new provider + optional credential */
async function addProviderHandler(existingRoutes: ProviderRouteData[]): Promise<ProviderRouteData[]> {
  const routes = [...existingRoutes];
  const chosen = await pickProvider(routes);
  if (!chosen) return routes;

  const existingProviderRoute = routes.find(r => r.providerId === chosen.id);

  if (existingProviderRoute) {
    console.log(`\n${chosen.name} is already configured.`);
    return manageExistingCredentials(routes, chosen.id);
  }

  // New provider
  let apiKey = '';
  if (chosen.requiresKey && chosen.envVars.length > 0) {
    apiKey = await promptForKey(chosen);
  } else {
    console.log(`\n  ${chosen.name} does not require an API key.`);
  }

  // Verify if key was provided
  if (apiKey) {
    const { confirm: cf } = await import('@inquirer/prompts');
    if (await cf({ message: 'Verify with one small search request?', default: true })) {
      apiKey = await verifyProvider(chosen, apiKey) || apiKey;
    }
  }

  // Determine label
  let label = 'default';
  const existingProfiles = Object.values(loadCredentialProfiles()).filter(p => p.providerId === chosen.id);
  if (existingProfiles.length > 0) {
    label = `backup-${existingProfiles.length + 1}`;
    const { input: inp } = await import('@inquirer/prompts');
    label = await inp({ message: `Label for this credential:`, default: label });
  }

  // Save credential
  if (apiKey && chosen.requiresKey) {
    const profileId = `${chosen.id}.${label}`;
    upsertCredentialProfile({
      id: profileId,
      providerId: chosen.id,
      label,
      apiKey,
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    console.log(`✓ Credential "${label}" saved for ${chosen.name}`);
  }

  // Add route
  const priority = routes.length > 0 ? Math.max(...routes.map(r => r.priority)) + 10 : 10;
  const routeId = chosen.requiresKey ? `${chosen.id}.${label}` : chosen.id;
  routes.push({
    id: routeId,
    providerId: chosen.id,
    credentialRef: chosen.requiresKey ? routeId : undefined,
    label,
    priority,
    enabled: true,
  });
  console.log(`✓ Route "${routeId}" added`);

  return routes;
}

/** Manage existing provider's credentials */
async function manageExistingProvider(routes: ProviderRouteData[]): Promise<ProviderRouteData[]> {
  // Pick provider to manage
  const providerIds = [...new Set(routes.filter(r => r.enabled).map(r => r.providerId))];
  if (providerIds.length === 0) return routes;

  const picked = await select({
    message: 'Which provider?',
    choices: providerIds.map(id => {
      const p = registry.get(id);
      return { value: id, name: p?.name ?? id };
    }),
  });

  return manageExistingCredentials(routes, picked);
}

async function manageExistingCredentials(routes: ProviderRouteData[], providerId: string): Promise<ProviderRouteData[]> {
  const provider = registry.get(providerId);
  if (!provider) return routes;

  const profiles = Object.values(loadCredentialProfiles()).filter(p => p.providerId === providerId);
  const existingRoutes = routes.filter(r => r.providerId === providerId && r.enabled);

  console.log(`\n${provider.name}: ${profiles.length} credential(s), ${existingRoutes.length} route(s)`);

  const action = await select({
    message: `Manage ${provider.name}:`,
    choices: [
      { value: 'add', name: 'Add another credential' },
      ...(profiles.length > 0 ? [{ value: 'replace', name: 'Replace an existing credential' } as const] : []),
      ...(profiles.length > 0 ? [{ value: 'disable', name: 'Disable a credential' } as const] : []),
      { value: 'back', name: 'Go back' },
    ],
  });

  switch (action) {
    case 'add': {
      return addCredentialToProvider(routes, provider);
    }
    case 'replace': {
      return replaceCredential(routes, provider, profiles);
    }
    case 'disable': {
      return disableCredential(routes, provider, profiles);
    }
    default:
      return routes;
  }
}

async function promptForKey(provider: { id: string; name: string; envVars: readonly string[] }): Promise<string> {
  const envVar = provider.envVars[0]!;
  const { password } = await import('@inquirer/prompts');
  const key = await password({
    message: `Enter ${envVar} for ${provider.name}:`,
    mask: '*',
  });
  if (!key || key.trim().length === 0) {
    console.log('No key provided.');
    return '';
  }
  return key.trim();
}

async function verifyProvider(provider: { id: string; name: string; envVars: readonly string[] }, apiKey: string): Promise<string | undefined> {
  const envVar = provider.envVars[0]!;
  const original = process.env[envVar];
  process.env[envVar] = apiKey;
  try {
    const { reliableSearch } = await import('../reliable-search.js');
    const result = await reliableSearch('hello', {
      providers: [provider.id],
      count: 2,
      timeout: 10_000,
    });
    if (result.retrievalSucceeded) {
      console.log('✓ Provider authenticated and returned results');
      return apiKey;
    }
    console.log('⚠ Provider responded but no results. Key may still be valid.');
    return apiKey;
  } catch (err: unknown) {
    console.log(`⚠ Verification failed: ${(err as Error).message}`);
    const { confirm: cf } = await import('@inquirer/prompts');
    const retry = await cf({ message: 'Retry with a different key?', default: true });
    if (retry) return undefined; // caller will re-prompt
    const saveAnyway = await cf({ message: 'Save anyway (disabled)?', default: false });
    if (saveAnyway) return apiKey;
    return '';
  } finally {
    process.env[envVar] = original;
    if (!original) delete process.env[envVar];
  }
}

async function addCredentialToProvider(routes: ProviderRouteData[], provider: { id: string; name: string; envVars: readonly string[] }): Promise<ProviderRouteData[]> {
  const existingProfiles = Object.values(loadCredentialProfiles()).filter(p => p.providerId === provider.id);
  const labelNum = existingProfiles.length + 1;
  let label = `backup-${labelNum}`;

  const { input: inp } = await import('@inquirer/prompts');
  label = await inp({ message: `Label for this credential:`, default: label });

  if (!label.trim()) label = `backup-${labelNum}`;
  if (!label.includes(provider.id)) label = `${provider.id}.${label}`;

  const apiKey = await promptForKey(provider);
  if (!apiKey || apiKey.trim().length === 0) {
    console.log('No key entered. Credential not saved.');
    return routes;
  }

  const verifiedKey = await verifyProvider(provider, apiKey.trim());
  if (verifiedKey === undefined) {
    // Retry
    return addCredentialToProvider(routes, provider);
  }
  if (verifiedKey === '') {
    console.log('Credential not saved.');
    return routes;
  }

  const profileId = `${provider.id}.${label.replace(`${provider.id}.`, '')}`;
  upsertCredentialProfile({
    id: profileId,
    providerId: provider.id,
    label: label.replace(`${provider.id}.`, ''),
    apiKey: verifiedKey,
    enabled: true,
    createdAt: new Date().toISOString(),
  });

  const priority = routes.length > 0 ? Math.max(...routes.map(r => r.priority)) + 10 : 10;
  routes.push({
    id: profileId,
    providerId: provider.id,
    credentialRef: profileId,
    label: label.replace(`${provider.id}.`, ''),
    priority,
    enabled: true,
  });

  console.log(`✓ Credential "${label}" added with new route`);
  return routes;
}

async function replaceCredential(routes: ProviderRouteData[], provider: { id: string; name: string; envVars: readonly string[] }, profiles: any[]): Promise<ProviderRouteData[]> {
  if (profiles.length === 0) return routes;

  const picked = await select({
    message: 'Which credential to replace?',
    choices: profiles.map(p => ({ value: p.id, name: `${p.label} (${maskSecret(p.apiKey)})` })),
  });

  const newKey = await promptForKey(provider);
  if (!newKey) return routes;

  upsertCredentialProfile({
    ...profiles.find(p => p.id === picked),
    apiKey: newKey,
    createdAt: new Date().toISOString(),
  });

  console.log(`✓ Credential "${picked}" replaced`);
  return routes;
}

async function disableCredential(routes: ProviderRouteData[], provider: { id: string; name: string }, profiles: any[]): Promise<ProviderRouteData[]> {
  if (profiles.length === 0) return routes;

  const picked = await select({
    message: 'Which credential to disable?',
    choices: profiles.map(p => ({ value: p.id, name: `${p.label} ${p.enabled ? '' : '(already disabled)'}` })),
  });

  upsertCredentialProfile({
    ...profiles.find(p => p.id === picked),
    enabled: false,
  });

  console.log(`✓ Credential "${picked}" disabled`);
  return routes;
}

async function pickProvider(existingRoutes: ProviderRouteData[]): Promise<{ id: string; name: string; requiresKey: boolean; envVars: readonly string[] } | null> {
  const existingProviderIds = new Set(existingRoutes.map(r => r.providerId));
  const available = registry.list().filter(p => !p.capabilities.experimental);

  const choices = available.map(p => ({
    value: p.id,
    name: p.name + (existingProviderIds.has(p.id) ? ' (already configured)' : ''),
    description: p.requiresKey ? `Requires API key` : 'No key required',
    disabled: false as boolean | string | undefined,
  }));

  const pickedId: string = await select({
    message: 'Choose a search provider:',
    choices,
  });

  const p = registry.get(pickedId);
  if (!p) return null;
  return { id: p.id, name: p.name, requiresKey: p.requiresKey, envVars: p.envVars };
}

async function reviewAndAdjustRoutes(routes: ProviderRouteData[]): Promise<ProviderRouteData[]> {
  if (routes.length === 0) return routes;

  console.log('\nCurrent search route order:');
  console.log(renderRouteSummary(routes));

  const action = await select({
    message: 'Adjust route:',
    choices: [
      { value: 'move', name: 'Move a route up or down' },
      { value: 'disable', name: 'Disable a route' },
      { value: 'enable', name: 'Enable a disabled route' },
      { value: 'done', name: 'Route looks good' },
    ],
  });

  switch (action) {
    case 'move': {
      return moveRoute(routes);
    }
    case 'disable': {
      return toggleRouteEnabled(routes, false);
    }
    case 'enable': {
      return toggleRouteEnabled(routes, true);
    }
    default:
      return routes;
  }
}

async function moveRoute(routes: ProviderRouteData[]): Promise<ProviderRouteData[]> {
  const enabled = routes.filter(r => r.enabled).sort((a, b) => a.priority - b.priority);
  if (enabled.length < 2) {
    console.log('Need at least 2 enabled routes to reorder.');
    return routes;
  }

  // Use simplified approach: prompt for route, then where to place it
  const ordered = [...routes].sort((a, b) => a.priority - b.priority);
  const chosenId: string = await select({
    message: 'Which route to move?',
    choices: ordered.map((r, i) => ({ value: r.id, name: `${i + 1}. ${r.providerId}${r.label ? '/' + r.label : ''} [${r.enabled ? 'enabled' : 'disabled'}]` })),
  });

  const targetId: string = await select({
    message: 'Place before which route?',
    choices: ordered
      .filter(r => r.id !== chosenId && r.enabled)
      .map(r => ({ value: r.id, name: `${r.providerId}${r.label ? '/' + r.label : ''}` })),
  });

  // Recalculate priorities
  const without = routes.filter(r => r.id !== chosenId);
  const target = without.find(r => r.id === targetId);
  const moved = routes.find(r => r.id === chosenId)!;

  if (!target) return routes;

  const result: ProviderRouteData[] = [];
  let nextPri = 10;
  const insertAfter = target.priority - 5;

  for (const r of without.sort((a, b) => a.priority - b.priority)) {
    if (r.id === targetId) {
      // Insert moved route before target
      moved.priority = insertAfter;
      result.push(moved);
      nextPri = insertAfter + 10;
      r.priority = nextPri;
      result.push(r);
    } else {
      r.priority = nextPri;
      result.push(r);
    }
    nextPri += 10;
  }

  console.log('✓ Route order updated');
  return result;
}

async function toggleRouteEnabled(routes: ProviderRouteData[], enable: boolean): Promise<ProviderRouteData[]> {
  const target = enable
    ? routes.filter(r => !r.enabled)
    : routes.filter(r => r.enabled);

  if (target.length === 0) {
    console.log(enable ? 'No disabled routes.' : 'No enabled routes to disable.');
    return routes;
  }

  const pickedId: string = await select({
    message: enable ? 'Which route to enable?' : 'Which route to disable?',
    choices: target.map(r => ({ value: r.id, name: `${r.providerId}/${r.label ?? r.id}` })),
  });

  return routes.map(r => r.id === pickedId ? { ...r, enabled: enable } : r);
}

function renderRouteSummary(routes: ProviderRouteData[]): string {
  const sorted = [...routes].sort((a, b) => a.priority - b.priority);
  let output = '';
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!;
    const label = r.label ? ` / ${r.label}` : '';
    const status = r.enabled ? '' : ' [disabled]';
    output += `  ${i + 1}. ${r.providerId}${label}${status}\n`;
  }
  return output.trimEnd();
}

export { renderRouteSummary };
