/**
 * adapters/codex.ts — Codex Agent Host Adapter.
 *
 * Detects: codex --version, codex mcp --help
 * Installs via: codex mcp add reliable-web-search -- rws mcp
 * Verifies via: codex mcp list, codex mcp get
 */
import { spawnSync } from 'node:child_process';
import type {
  AgentHostAdapter, HostDetection, HostInstallInput,
  HostInstallResult, HostInstallationState,
  HostVerificationResult, HostUninstallResult,
} from './interface.js';
import { detectCli, resolveRwsCommand } from './shared.js';

export const codexAdapter: AgentHostAdapter = {
  id: 'codex',
  displayName: 'Codex',

  async detect(): Promise<HostDetection> {
    const info = detectCli('codex');
    if (!info.version) {
      return { installed: false, reason: info.error };
    }
    return {
      installed: true,
      command: 'codex',
      version: info.version,
    };
  },

  async inspect(): Promise<HostInstallationState> {
    // Check if reliable-web-search is already configured in Codex
    const r = spawnSync('codex', ['mcp', 'list'], {
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
    // Check existing configuration
    const state = await this.inspect();
    if (state.configured) {
      return { configured: true, configLocation: '(already configured)' };
    }

    const rws = resolveRwsCommand();
    const r = spawnSync('codex', ['mcp', 'add', input.serverName, '--', rws.command, ...rws.args], {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (r.status === 0) {
      return { configured: true };
    }

    throw new Error(`Codex MCP registration failed: ${r.stderr || r.stdout || 'unknown error'}`);
  },

  async verify(): Promise<HostVerificationResult> {
    const issues: string[] = [];

    // Verify with mcp list
    const list = spawnSync('codex', ['mcp', 'list'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const output = (list.stdout ?? '') + (list.stderr ?? '');
    if (!output.includes('reliable-web-search')) {
      issues.push('reliable-web-search not found in codex mcp list');
    }

    // Try mcp get
    const get = spawnSync('codex', ['mcp', 'get', 'reliable-web-search'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (get.status !== 0) {
      issues.push(`codex mcp get failed: ${get.stderr || get.stdout}`);
    }

    return {
      verified: issues.length === 0,
      issues,
    };
  },

  async uninstall(): Promise<HostUninstallResult> {
    const r = spawnSync('codex', ['mcp', 'remove', 'reliable-web-search'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (r.status === 0) {
      return { removed: true, details: 'Codex MCP server removed' };
    }

    return {
      removed: false,
      details: `Failed: ${r.stderr || r.stdout || 'unknown error'}`,
    };
  },
};
