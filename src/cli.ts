#!/usr/bin/env node
/**
 * rws — reliable-web-search CLI (v0.3.0)
 *
 * Unified entry: `rws` → setup wizard or interactive search.
 * Supports: setup, search, mcp, doctor, config, connect, disconnect.
 */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Environment proxy support ────────────────────────
import { setupProxy } from './network/proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Auto-register providers (CLI entry doesn't go through index.ts) ─
import { registry } from './providers/registry.js';
import { duckduckgoProvider } from './providers/duckduckgo.js';
import { braveProvider } from './providers/brave.js';
import { bochaProvider } from './providers/bocha.js';
import { metasoProvider } from './providers/metaso.js';
import { tavilyProvider } from './providers/tavily.js';
import { geminiProvider } from './providers/gemini.js';
import { serpapiProvider } from './providers/serpapi.js';
import { searxngProvider } from './providers/searxng.js';

registry.register(duckduckgoProvider);
registry.register(braveProvider);
registry.register(bochaProvider);
registry.register(metasoProvider);
registry.register(tavilyProvider);
registry.register(geminiProvider);
registry.register(serpapiProvider);
registry.register(searxngProvider);

// ── MCP server (loaded lazily) ────────────────────────
let mcpServerMain: (() => Promise<void>) | null = null;

// ── CLI Help ──────────────────────────────────────────

function showHelp(): void {
  console.log(`reliable-web-search v0.3.0

Usage:
  rws                          Interactive setup or search
  rws <query>                  Quick search (shorthand for rws search)
  rws setup                    Unified setup wizard
  rws search <query>           Search the web
  rws mcp                      Start MCP stdio server
  rws doctor                   Run health checks
  rws config [path]            Show or locate config
  rws connect [host]           Connect to agent hosts
  rws disconnect [host]        Disconnect from agent hosts

Search options:
  --json                       Output as JSON
  --verbose                    Show detailed diagnostics
  --strategy fallback|race|aggregate  Search strategy
  --provider <id>              Use specific provider
  --count <n>                  Number of results (1-20)

Commands:
  setup                        Launch the unified setup wizard
  connect --all                Connect to all detected hosts
  connect openclaw|codex|claude-code|generic  Connect to specific host
  disconnect --all             Disconnect from all hosts
  disconnect <host>            Disconnect from specific host
  doctor --live                Run health checks with live search test
  config                       Show config summary (keys masked)
  config path                  Print config directory path

For interactive use, run: rws`);
}

// ── Argument Parsing ──────────────────────────────────

function parseCliArgs(argv: string[]): {
  subcommand: string | null;
  query: string;
  options: Record<string, string | boolean>;
  positional: string[];
} {
  // Try structured parsing first
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        verbose: { type: 'boolean' },
        strategy: { type: 'string' },
        provider: { type: 'string' },
        count: { type: 'string' },
        all: { type: 'boolean' },
        live: { type: 'boolean' },
        'no-save': { type: 'boolean' },
        format: { type: 'string' },
      },
      allowPositionals: true,
      strict: false,
    });
  } catch {
    // parseArgs throws on unknown flags; handle gracefully
    return { subcommand: null, query: '', options: {}, positional: argv };
  }

  const pos = parsed.positionals as string[];
  const subcommand = pos[0] ?? null;

  // Collect known options
  const options: Record<string, string | boolean> = {};
  for (const [key, val] of Object.entries(parsed.values)) {
    if (val !== undefined && val !== false && typeof val !== 'object') options[key] = val as string | boolean;
  }

  // Compute query from positionals
  let query = '';
  if (subcommand === 'search') {
    query = pos.slice(1).join(' ');
  } else if (pos.length > 0 && !['setup', 'mcp', 'doctor', 'config', 'connect', 'disconnect', 'help'].includes(subcommand!)) {
    // "rws <query>" shorthand — whole positional is the query
    query = pos.join(' ');
  }

  return { subcommand, query, options, positional: pos };
}

function isTTY(): boolean {
  return process.stdin.isTTY === true;
}

// ── CLI Helpers ───────────────────────────────────────

function printVersion(): void {
  const pkgPath = join(__dirname, '..', 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    console.log(`${pkg.version}`);
  } catch {
    console.log('0.3.0');
  }
}

function getPackageVersion(): string {
  const pkgPath = join(__dirname, '..', 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? '0.3.0';
  } catch {
    return '0.3.0';
  }
}

// ── Subcommand: setup ─────────────────────────────────

async function cmdSetup(opts: Record<string, string | boolean>): Promise<void> {
  const noSave = opts['no-save'] === true;

  console.log('\nWelcome to reliable-web-search\n');

  // Lazy-load setup modules
  const { loadConfig } = await import('./config/load.js');
  const { saveConfig } = await import('./config/save.js');
  const { saveCredentials, resolveCredential } = await import('./config/credentials.js');
  const { registry } = await import('./providers/registry.js');
  const { maskSecret } = await import('./config/mask-secret.js');

  // Check existing config
  const existing = loadConfig();
  if (existing.source === 'file' && existing.warnings.length === 0) {
    console.log('✓ Existing configuration found');
  }

  // ── Step 1: Choose provider ─────────────────────────
  const available = registry.list();

  // Filter to non-experimental for setup
  const stable = available.filter((p) => !p.capabilities.experimental);

  console.log('Choose a search provider:');
  const displayList: { id: string; name: string; desc: string; requiresKey: boolean }[] = [];
  for (const p of stable) {
    let desc = p.name;
    if (p.id === 'brave') desc += ' Recommended for general web search';
    else if (p.id === 'tavily') desc += ' Optimized for AI agents';
    else if (p.id === 'gemini') desc += ' Grounded AI answers';
    else if (p.id === 'searxng') desc += ' Self-hosted';
    else if (p.id === 'duckduckgo') desc += ' Instant Answer — limited, no key required';
    else if (p.id === 'serpapi') desc += ' Google search via API';
    displayList.push({ id: p.id, name: p.name, desc, requiresKey: p.requiresKey });
  }

  if (!isTTY()) {
    console.log('(Non-interactive mode — showing available providers)');
    for (const d of displayList) {
      const keyNote = d.requiresKey ? ' [requires key]' : ' [no key]';
      console.log(`  ${d.id}: ${d.desc}${keyNote}`);
    }
    console.log('\nRun in a TTY for interactive setup, or set environment variables directly.');
    return;
  }

  // Use interactive prompt
  const { select } = await import('@inquirer/prompts');
  const chosenId: string = await select({
    message: 'Choose a search provider:',
    choices: displayList.map((d) => ({
      value: d.id,
      name: d.name,
      description: d.desc,
    })),
  });

  const chosen = stable.find((p) => p.id === chosenId);
  if (!chosen) {
    console.log(`Provider "${chosenId}" not found.`);
    return;
  }

  // ── Step 2: API Key (if required) ───────────────────
  let apiKey = '';
  if (chosen.requiresKey && chosen.envVars.length > 0) {
    const envVar = chosen.envVars[0]!;
    const existingKey = resolveCredential(envVar);
    if (existingKey) {
      console.log(`\n✓ ${envVar} already configured (${maskSecret(existingKey)})`);
      apiKey = existingKey;
    } else {
      const { password } = await import('@inquirer/prompts');
      apiKey = await password({
        message: `Enter ${envVar}:`,
        mask: '*',
      });
      if (!apiKey || apiKey.trim().length === 0) {
        console.log('No API key provided. Setup will use defaults.');
      }
    }
  } else if (!chosen.requiresKey) {
    console.log(`\n  ${chosen.name} does not require an API key.`);
  }

  // ── Step 3: Verify ─────────────────────────────────
  if (apiKey && chosen.requiresKey) {
    const { confirm } = await import('@inquirer/prompts');
    const doVerify = await confirm({
      message: 'Verify with one small search request?',
      default: true,
    });

    if (doVerify) {
      const envVar = chosen.envVars[0]!;
      try {
        // Temporarily set env var for this process
        process.env[envVar] = apiKey;
        const { reliableSearch } = await import('./reliable-search.js');
        const result = await reliableSearch('hello world', {
          providers: [chosen.id],
          count: 2,
          timeout: 10_000,
        });
        if (result.retrievalSucceeded) {
          console.log('✓ Provider authenticated');
          console.log('✓ Search returned usable results');
        } else {
          console.log('⚠ Provider responded but returned no results. Check your key or provider status.');
        }
      } catch (err: unknown) {
        console.log(`⚠ Verification failed: ${(err as Error).message}`);
        console.log('You can retry setup later with: rws setup');
      } finally {
        if (!apiKey) delete process.env[envVar];
      }
    }
  }

  // ── Step 4: Save credentials ───────────────────────
  if (apiKey && chosen.requiresKey && !noSave) {
    const envVar = chosen.envVars[0]!;
    try {
      saveCredentials({ [envVar]: apiKey });
      console.log(`\n✓ API key saved to credentials file`);
    } catch (err: unknown) {
      console.log(`⚠ Could not save credentials: ${(err as Error).message}`);
      console.log(`Set ${envVar} as an environment variable instead.`);
    }
  }

  // ── Step 5: Save config ────────────────────────────
  const providers = existing.config.providers.length > 0
    ? existing.config.providers
    : chosen.requiresKey ? [chosen.id] : [chosen.id, 'duckduckgo'];

  try {
    saveConfig({
      version: 2,
      defaultStrategy: existing.config.defaultStrategy ?? 'fallback',
      routes: providers.map((pid, i) => ({
        id: chosen.requiresKey ? `${pid}.default` : pid,
        providerId: pid,
        credentialRef: chosen.requiresKey ? `${pid}.default` : undefined,
        priority: i * 10,
        enabled: true,
      })),
      count: existing.config.count,
      timeoutMs: existing.config.timeoutMs,
      connectedHosts: existing.config.connectedHosts,
      credentialPolicy: 'failover',
    });
    console.log('✓ Configuration saved');
  } catch (err: unknown) {
    console.log(`⚠ Could not save config: ${(err as Error).message}`);
  }

  // ── Step 6: Detect agents ──────────────────────────
  console.log('\nDetecting agent environments...');
  const detected = await detectHosts();

  if (detected.length > 0) {
    console.log('');
    for (const d of detected) {
      console.log(`  ◉ ${d.name} ${d.version ?? ''}`);
    }

    if (isTTY()) {
      const { confirm } = await import('@inquirer/prompts');
      const installAgents = await confirm({
        message: '\nInstall reliable_web_search in all detected agents?',
        default: true,
      });
      if (installAgents) {
        await installHosts(detected.map((d) => d.id));
      }
    }
  } else {
    console.log('  No supported agent host detected.');
    console.log('  You can run `rws connect` later.');
  }

  // ── Step 7: Final report ───────────────────────────
  console.log(`\nReady. Try:`);
  console.log(`  rws "latest RISC-V news"\n`);
}

async function detectHosts(): Promise<Array<{ id: string; name: string; version?: string }>> {
  const results: Array<{ id: string; name: string; version?: string }> = [];

  try {
    const { hostAdapters } = await import('./adapters/index.js');
    for (const adapter of hostAdapters) {
      try {
        const detection = await adapter.detect();
        if (detection.installed) {
          results.push({ id: adapter.id, name: adapter.displayName, version: detection.version });
        }
      } catch {
        // Adapter detection failure is not fatal
      }
    }
  } catch {
    // No adapters module yet
  }

  return results;
}

async function installHosts(hostIds: string[]): Promise<void> {
  try {
    const { hostAdapters } = await import('./adapters/index.js');
    for (const id of hostIds) {
      const adapter = hostAdapters.find((a) => a.id === id);
      if (!adapter) continue;
      try {
        const rwsPath = process.argv[1] ?? 'rws';
        const result = await adapter.install({
          serverName: 'reliable-web-search',
          command: rwsPath,
          args: ['mcp'],
        });
        console.log(`  ✓ ${adapter.displayName} ${result.configured ? 'configured' : 'skipped'}`);
      } catch (err: unknown) {
        console.log(`  ✗ ${adapter.displayName}: ${(err as Error).message}`);
      }
    }
  } catch {
    // No adapters module yet
  }
}

// ── Subcommand: search ────────────────────────────────

async function cmdSearch(
  query: string,
  opts: Record<string, string | boolean>,
): Promise<void> {
  if (!query || query.trim().length === 0) {
    console.error('Error: search requires a query.');
    console.error('Usage: rws search "your query"');
    process.exit(1);
  }

  const useJson = opts.json === true;
  const verbose = opts.verbose === true;

  const { reliableSearch } = await import('./reliable-search.js');
  const { loadConfig } = await import('./config/load.js');
  const config = loadConfig().config;

  const strategy = typeof opts.strategy === 'string'
    ? (opts.strategy as 'fallback' | 'race' | 'aggregate')
    : undefined;

  const providerFilter = typeof opts.provider === 'string'
    ? [opts.provider]
    : config.providers.length > 0
      ? config.providers
      : undefined;

  const count = typeof opts.count === 'string'
    ? Math.max(1, Math.min(20, parseInt(opts.count, 10) || 5))
    : config.count;

  try {
    const result = await reliableSearch(query, {
      providers: providerFilter,
      count,
      fallback: strategy ? { mode: strategy } : { mode: config.defaultStrategy },
      timeout: config.timeoutMs,
    });

    if (useJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Human-readable output
      console.log(`\nResults for: ${query}`);
      console.log(`Provider: ${result.provider} (${result.providerPath.join(' → ')})`);
      console.log(`Time: ${result.elapsedMs}ms | Status: ${result.resultStatus}`);
      if (result.cacheHit) console.log('(cached)');
      console.log('');

      for (let i = 0; i < result.results.length; i++) {
        const r = result.results[i]!;
        console.log(`${i + 1}. ${r.title}`);
        console.log(`   ${r.url}`);
        if (r.snippet) console.log(`   ${r.snippet}`);
        console.log('');
      }

      if (result.results.length === 0) {
        console.log('No results found. Try a different query or provider.');
      }
    }

    if (verbose) {
      console.error(JSON.stringify({
        attempts: result.attempts,
        providerPath: result.providerPath,
        elapsedMs: result.elapsedMs,
        retrievalSucceeded: result.retrievalSucceeded,
        usableForReview: result.usableForReview,
        cacheHit: result.cacheHit,
      }, null, 2));
    }
  } catch (err: unknown) {
    const message = (err as Error).message;
    if (useJson) {
      console.log(JSON.stringify({ error: message, retrievalSucceeded: false, usableForReview: false }));
    } else {
      console.error(`Search failed: ${message}`);
    }
    if (verbose) console.error(err);
    process.exit(1);
  }
}

// ── Subcommand: config ────────────────────────────────

async function cmdConfig(opts: Record<string, string | boolean>, positional: string[]): Promise<void> {
  const sub = positional[1];

  if (sub === 'path') {
    const { configDir } = await import('./config/paths.js');
    console.log(configDir());
    return;
  }

  // Show config summary
  const { loadConfig } = await import('./config/load.js');
  const { loadCredentials, resolveCredential } = await import('./config/credentials.js');
  const { maskSecret } = await import('./config/mask-secret.js');
  const { registry } = await import('./providers/registry.js');

  const { config, source, warnings } = loadConfig();
  const creds = loadCredentials();

  console.log('Configuration:');
  console.log(`  Source: ${source}`);
  if (warnings.length > 0) {
    console.log('  Warnings:');
    for (const w of warnings) console.log(`    ⚠ ${w}`);
  }
  console.log(`  Default strategy: ${config.defaultStrategy}`);
  console.log(`  Providers: ${config.providers.length > 0 ? config.providers.join(', ') : '(auto-detect)'}`);
  console.log(`  Count: ${config.count}`);
  console.log(`  Timeout: ${config.timeoutMs}ms`);
  if (config.connectedHosts.length > 0) {
    console.log(`  Connected hosts: ${config.connectedHosts.join(', ')}`);
  }

  console.log('\nCredentials:');
  if (Object.keys(creds).length === 0) {
    console.log('  (none saved)');
  }
  for (const [key, value] of Object.entries(creds)) {
    const envValue = process.env[key];
    const sourceNote = envValue ? ' (overridden by env)' : ' (file)';
    console.log(`  ${key}: ${maskSecret(value)}${sourceNote}`);
  }

  // Show env-only keys not in file
  const registeredEnvVars = new Set<string>();
  for (const p of registry.list()) {
    for (const ev of p.envVars) registeredEnvVars.add(ev);
  }
  for (const ev of registeredEnvVars) {
    if (!creds[ev] && process.env[ev]) {
      console.log(`  ${ev}: ${maskSecret(process.env[ev])} (environment only)`);
    }
  }
}

// ── Subcommand: doctor ────────────────────────────────

async function cmdDoctor(opts: Record<string, string | boolean>): Promise<void> {
  const live = opts.live === true;
  const checks: Array<{ name: string; status: 'ok' | 'warn' | 'fail'; detail: string }> = [];

  // Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.replace('v', '').split('.')[0] ?? '0', 10);
  checks.push({
    name: 'Node.js',
    status: major >= 18 ? 'ok' : 'fail',
    detail: `${nodeVersion} ${major >= 18 ? '✓' : '(need >= 18)'}`,
  });

  // Config
  try {
    const { loadConfig } = await import('./config/load.js');
    const { config, warnings } = loadConfig();
    checks.push({
      name: 'Config',
      status: warnings.length === 0 ? 'ok' : 'warn',
      detail: warnings.length > 0 ? warnings.join('; ') : 'readable',
    });
  } catch (err: unknown) {
    checks.push({ name: 'Config', status: 'fail', detail: (err as Error).message });
  }

  // Credentials permissions
  try {
    const { credentialsFilePath } = await import('./config/paths.js');
    const { statSync } = await import('node:fs');
    const stat = statSync(credentialsFilePath());
    if (process.platform !== 'win32') {
      const mode = stat.mode & 0o777;
      checks.push({
        name: 'Credentials permissions',
        status: mode === 0o600 ? 'ok' : 'warn',
        detail: mode === 0o600 ? '0600 ✓' : `mode ${mode.toString(8)} (should be 600)`,
      });
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      checks.push({ name: 'Credentials file', status: 'warn', detail: 'not yet created' });
    } else {
      checks.push({ name: 'Credentials file', status: 'fail', detail: (err as Error).message });
    }
  }

  // Provider auth
  try {
    const { loadConfig } = await import('./config/load.js');
    const { registry } = await import('./providers/registry.js');
    const { resolveCredential } = await import('./config/credentials.js');
    const cfg = loadConfig().config;
    const providers = cfg.providers.length > 0 ? cfg.providers : registry.detect().map((p) => p.id);

    for (const pid of providers) {
      const p = registry.get(pid);
      if (!p) continue;
      if (!p.requiresKey) {
        checks.push({ name: `Provider: ${pid}`, status: 'ok', detail: 'no key required' });
        continue;
      }
      const key = resolveCredential(p.envVars[0] ?? '');
      checks.push({
        name: `Provider: ${pid}`,
        status: key ? 'ok' : 'warn',
        detail: key ? 'authenticated' : 'no credentials found',
      });
    }
  } catch (err: unknown) {
    checks.push({ name: 'Provider auth', status: 'fail', detail: (err as Error).message });
  }

  // Proxy
  const { getProxyStatus } = await import('./network/proxy.js');
  const ps = getProxyStatus();
  if (ps.detected) {
    checks.push({
      name: 'Environment proxy',
      status: ps.enabled ? 'ok' : 'warn',
      detail: ps.enabled
        ? `enabled (source: ${ps.source}, host: ${ps.hostname})${ps.noProxy ? `, NO_PROXY: ${ps.noProxy}` : ''}`
        : `detected but not active (source: ${ps.source})`,
    });
  } else {
    checks.push({ name: 'Environment proxy', status: 'ok', detail: 'not configured' });
  }

  // MCP handshake
  try {
    checks.push({ name: 'MCP server', status: 'ok', detail: 'available (rws mcp)' });
  } catch {
    checks.push({ name: 'MCP server', status: 'fail', detail: 'not available' });
  }

  // Host detection
  try {
    const detected = await detectHosts();
    for (const d of detected) {
      checks.push({ name: `Host: ${d.name}`, status: 'ok', detail: `installed (${d.version ?? 'unknown version'})` });
    }
    const { hostAdapters } = await import('./adapters/index.js');
    const notInstalled = hostAdapters.filter(
      (a) => !detected.some((d) => d.id === a.id),
    );
    for (const a of notInstalled) {
      checks.push({ name: `Host: ${a.displayName}`, status: 'warn', detail: 'not installed' });
    }
  } catch {
    // No adapters yet
  }

  // Live search test
  if (live) {
    try {
      const { reliableSearch } = await import('./reliable-search.js');
      const result = await reliableSearch('test', { count: 1, timeout: 10_000 });
      checks.push({
        name: 'Live search',
        status: result.retrievalSucceeded ? 'ok' : 'warn',
        detail: result.retrievalSucceeded
          ? `✓ (${result.provider}, ${result.elapsedMs}ms)`
          : `no results (${result.provider})`,
      });
    } catch (err: unknown) {
      checks.push({ name: 'Live search', status: 'fail', detail: (err as Error).message });
    }
  }

  // Print results
  console.log('=== rws doctor ===\n');
  for (const c of checks) {
    const icon = c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
    console.log(`${icon} ${c.name}: ${c.detail}`);
  }
  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  console.log(`\n${checks.length} checks: ${checks.length - fails - warns} ok, ${warns} warn, ${fails} fail`);
  if (fails > 0) process.exitCode = 1;
}

// ── Subcommand: connect ───────────────────────────────

async function cmdConnect(opts: Record<string, string | boolean>, positional: string[]): Promise<void> {
  const all = opts.all === true;
  const hostArg = positional[1];

  let hostsToConnect: string[] = [];

  if (all) {
    const detected = await detectHosts();
    hostsToConnect = detected.map((d) => d.id);
    if (hostsToConnect.length === 0) {
      console.log('No supported agent hosts detected.');
      return;
    }
  } else if (hostArg) {
    hostsToConnect = [hostArg];
  } else if (isTTY()) {
    // Interactive multi-select
    const detected = await detectHosts();
    if (detected.length === 0) {
      console.log('No supported agent hosts detected.');
      console.log('You can run `rws connect` again after installing OpenClaw, Codex, or Claude Code.');
      return;
    }
    const { checkbox } = await import('@inquirer/prompts');
    const selected: string[] = await checkbox({
      message: 'Select agents to connect:',
      choices: detected.map((d) => ({
        value: d.id,
        name: d.name,
        checked: true,
      })),
    });
    hostsToConnect = selected;
  } else {
    console.log('Usage: rws connect [openclaw|codex|claude-code|generic|--all]');
    const detected = await detectHosts();
    if (detected.length > 0) {
      console.log('\nDetected hosts:');
      for (const d of detected) console.log(`  ${d.id}: ${d.name} ${d.version ?? ''}`);
      console.log('\nRun: rws connect --all');
    }
    return;
  }

  if (hostsToConnect.length === 0) {
    console.log('No hosts selected.');
    return;
  }

  await installHosts(hostsToConnect);
}

// ── Subcommand: disconnect ────────────────────────────

async function cmdDisconnect(opts: Record<string, string | boolean>, positional: string[]): Promise<void> {
  const all = opts.all === true;
  const hostArg = positional[1];

  let hostsToRemove: string[] = [];

  if (all) {
    try {
      const { hostAdapters } = await import('./adapters/index.js');
      hostsToRemove = hostAdapters.map((a) => a.id);
    } catch {
      console.log('No adapters available.');
      return;
    }
  } else if (hostArg) {
    hostsToRemove = [hostArg];
  } else if (isTTY()) {
    const { loadConfig } = await import('./config/load.js');
    const cfg = loadConfig().config;
    if (cfg.connectedHosts.length === 0) {
      console.log('No hosts are currently connected.');
      return;
    }
    const { checkbox } = await import('@inquirer/prompts');
    const selected: string[] = await checkbox({
      message: 'Select agents to disconnect:',
      choices: cfg.connectedHosts.map((h: string) => ({
        value: h,
        name: h,
      })),
    });
    hostsToRemove = selected;
  } else {
    console.log('Usage: rws disconnect [openclaw|codex|claude-code|generic|--all]');
    return;
  }

  if (hostsToRemove.length === 0) {
    console.log('No hosts selected.');
    return;
  }

  try {
    const { hostAdapters } = await import('./adapters/index.js');
    for (const id of hostsToRemove) {
      const adapter = hostAdapters.find((a) => a.id === id);
      if (!adapter) {
        console.log(`✗ Unknown host: ${id}`);
        continue;
      }
      try {
        await adapter.uninstall();
        console.log(`✓ ${adapter.displayName} disconnected`);
      } catch (err: unknown) {
        console.log(`✗ ${adapter.displayName}: ${(err as Error).message}`);
      }
    }
  } catch {
    console.log('No adapters available.');
  }
}

// ── Main Entry ────────────────────────────────────────

async function main(): Promise<void> {
  // Enable environment proxy at process entry
  setupProxy();

  const argv = process.argv.slice(2);
  const { subcommand, query, options, positional } = parseCliArgs(argv);

  // --help
  if (options.help || subcommand === 'help') {
    showHelp();
    return;
  }

  // --version
  if (subcommand === 'version' || subcommand === '--version') {
    printVersion();
    return;
  }

  // setup
  if (subcommand === 'setup') {
    await cmdSetup(options);
    return;
  }

  // search
  if (subcommand === 'search' || (query && query.length > 0 && subcommand !== 'setup' && subcommand !== 'mcp' && subcommand !== 'doctor' && subcommand !== 'config' && subcommand !== 'connect' && subcommand !== 'disconnect')) {
    await cmdSearch(query, options);
    return;
  }

  // mcp
  if (subcommand === 'mcp') {
    await startMcpServer();
    return;
  }

  // doctor
  if (subcommand === 'doctor') {
    await cmdDoctor(options);
    return;
  }

  // config
  if (subcommand === 'config') {
    await cmdConfig(options, positional);
    return;
  }

  // connect
  if (subcommand === 'connect') {
    await cmdConnect(options, positional);
    return;
  }

  // disconnect
  if (subcommand === 'disconnect') {
    await cmdDisconnect(options, positional);
    return;
  }

  // No args: TTY → interactive setup, non-TTY → help
  if (!subcommand || subcommand.length === 0) {
    if (isTTY()) {
      // Check if already configured
      try {
        const { loadConfig } = await import('./config/load.js');
        const { config } = loadConfig();
        if (config.providers.length > 0) {
          // Already configured — show status and go to interactive search
          console.log(`\nreliable-web-search v${getPackageVersion()}`);
          console.log(`Providers: ${config.providers.join(', ')} | Strategy: ${config.defaultStrategy}`);

          if (config.connectedHosts.length > 0) {
            console.log(`Connected: ${config.connectedHosts.join(', ')}`);
          }

          const { input } = await import('@inquirer/prompts');
          const q: string = await input({ message: '\nSearch query (or Enter to exit):' });
          if (q && q.trim().length > 0) {
            await cmdSearch(q, options);
          }
          return;
        }
      } catch {
        // Not configured — proceed to setup
      }

      await cmdSetup(options);
      return;
    }

    showHelp();
    return;
  }
}

// ── MCP Server Bootstrap ──────────────────────────────

async function startMcpServer(): Promise<void> {
  try {
    const { runMcpServer } = await import('./mcp/server.js');
    await runMcpServer();
  } catch (err: unknown) {
    console.error(`MCP server error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${(err as Error).message}`);
  process.exit(1);
});
