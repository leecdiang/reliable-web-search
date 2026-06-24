/**
 * adapters/claude-code.ts — Claude Code Agent Host Adapter.
 *
 * Detects: claude --version, claude mcp --help
 * Installs via: claude mcp add --transport stdio reliable-web-search -- rws mcp
 * Verifies via: claude mcp list, claude mcp get
 */
import { spawnSync } from 'node:child_process';
import type {
  AgentHostAdapter, HostDetection, HostInstallInput,
  HostInstallResult, HostInstallationState,
  HostVerificationResult, HostUninstallResult,
} from './interface.js';
import { detectCli, resolveRwsCommand } from './shared.js';

export const claudeCodeAdapter: AgentHostAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',

  async detect(): Promise<HostDetection> {
    const info = detectCli('claude');
    if (!info.version) {
      return { installed: false, reason: info.error };
    }
    return {
      installed: true,
      command: 'claude',
      version: info.version,
    };
  },

  async inspect(): Promise<HostInstallationState> {
    // Check if reliable-web-search is already configured in Claude Code
    const r = spawnSync('claude', ['mcp', 'list'], {
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
    // Claude Code uses user scope by default
    const r = spawnSync('claude', [
      'mcp', 'add',
      '--transport', 'stdio',
      input.serverName,
      '--',
      rws.command,
      ...rws.args,
    ], {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (r.status === 0) {
      return { configured: true };
    }

    throw new Error(`Claude Code MCP registration failed: ${r.stderr || r.stdout || 'unknown error'}`);
  },

  async verify(): Promise<HostVerificationResult> {
    const issues: string[] = [];

    // Verify with mcp list
    const list = spawnSync('claude', ['mcp', 'list'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const output = (list.stdout ?? '') + (list.stderr ?? '');
    if (!output.includes('reliable-web-search')) {
      issues.push('reliable-web-search not found in claude mcp list');
    }

    // Try mcp get
    const get = spawnSync('claude', ['mcp', 'get', 'reliable-web-search'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (get.status !== 0) {
      issues.push(`claude mcp get failed: ${get.stderr || get.stdout}`);
    }

    return {
      verified: issues.length === 0,
      issues,
    };
  },

  async uninstall(): Promise<HostUninstallResult> {
    const r = spawnSync('claude', ['mcp', 'remove', 'reliable-web-search'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (r.status === 0) {
      return { removed: true, details: 'Claude Code MCP server removed' };
    }

    return {
      removed: false,
      details: `Failed: ${r.stderr || r.stdout || 'unknown error'}`,
    };
  },
};
