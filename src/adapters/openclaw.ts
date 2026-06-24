/**
 * adapters/openclaw.ts — OpenClaw Agent Host Adapter.
 *
 * Detects: openclaw --version, openclaw mcp --help
 * Installs via: openclaw mcp add reliable-web-search -- rws mcp
 * Verifies via: openclaw mcp status, openclaw mcp probe
 */
import { spawnSync } from 'node:child_process';
import type {
  AgentHostAdapter, HostDetection, HostInstallInput,
  HostInstallResult, HostInstallationState,
  HostVerificationResult, HostUninstallResult,
} from './interface.js';
import { detectCli, resolveRwsCommand } from './shared.js';

export const openClawAdapter: AgentHostAdapter = {
  id: 'openclaw',
  displayName: 'OpenClaw',

  async detect(): Promise<HostDetection> {
    const info = detectCli('openclaw');
    if (!info.version) {
      return { installed: false, reason: info.error };
    }
    return {
      installed: true,
      command: 'openclaw',
      version: info.version,
    };
  },

  async inspect(): Promise<HostInstallationState> {
    // Check if reliable-web-search is already configured in OpenClaw
    const r = spawnSync('openclaw', ['mcp', 'list'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = (r.stdout ?? '') + (r.stderr ?? '');
    const configured = output.includes('reliable-web-search');

    return {
      configured,
      details: { raw: output },
    };
  },

  async install(input: HostInstallInput): Promise<HostInstallResult> {
    const state = await this.inspect();
    if (state.configured) {
      return { configured: true, configLocation: '(already configured)' };
    }

    const rws = resolveRwsCommand();
    const r = spawnSync('openclaw', ['mcp', 'add', input.serverName, '--', rws.command, ...rws.args], {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (r.status === 0) {
      return { configured: true };
    }

    // Try alternative: mcp set
    const r2 = spawnSync('openclaw', ['mcp', 'set', input.serverName, '--command', rws.command, '--args', rws.args.join(' ')], {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (r2.status === 0) {
      return { configured: true };
    }

    throw new Error(`OpenClaw MCP registration failed: ${r.stderr || r2.stderr || 'unknown error'}`);
  },

  async verify(): Promise<HostVerificationResult> {
    const issues: string[] = [];

    const probe = spawnSync('openclaw', ['mcp', 'probe', 'reliable-web-search'], {
      encoding: 'utf-8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (probe.status !== 0) {
      issues.push(`MCP probe failed: ${probe.stderr || probe.stdout}`);
    }

    return {
      verified: issues.length === 0,
      issues,
    };
  },

  async uninstall(): Promise<HostUninstallResult> {
    const r = spawnSync('openclaw', ['mcp', 'remove', 'reliable-web-search'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (r.status === 0) {
      return { removed: true, details: 'OpenClaw MCP server removed' };
    }

    // Try mcp delete as fallback
    const r2 = spawnSync('openclaw', ['mcp', 'delete', 'reliable-web-search'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return {
      removed: r2.status === 0,
      details: r2.status === 0 ? 'OpenClaw MCP server removed' : `Failed: ${r2.stderr || r.stderr || 'unknown error'}`,
    };
  },
};
