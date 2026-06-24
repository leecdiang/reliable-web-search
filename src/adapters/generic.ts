/**
 * adapters/generic.ts — Generic MCP Adapter for unknown hosts.
 *
 * Outputs standard MCP server config that any MCP-compatible client can use.
 * Does not claim auto-detection or automatic installation.
 */
import type {
  AgentHostAdapter, HostDetection, HostInstallInput,
  HostInstallResult, HostInstallationState,
  HostVerificationResult, HostUninstallResult,
} from './interface.js';
import { resolveRwsCommand } from './shared.js';

export const genericMcpAdapter: AgentHostAdapter = {
  id: 'generic',
  displayName: 'Generic MCP',

  async detect(): Promise<HostDetection> {
    // Generic adapter is always "installed" in the sense that it's always available
    return {
      installed: true,
      command: undefined,
      version: 'standard MCP',
    };
  },

  async inspect(): Promise<HostInstallationState> {
    return { configured: false };
  },

  async install(input: HostInstallInput): Promise<HostInstallResult> {
    const rws = resolveRwsCommand();
    const config = {
      command: rws.command,
      args: rws.args,
    };

    // Output the config for the user
    console.log(JSON.stringify(config, null, 2));

    return { configured: false, configLocation: '(manual — see output above)' };
  },

  async verify(): Promise<HostVerificationResult> {
    return { verified: true, issues: [] };
  },

  async uninstall(): Promise<HostUninstallResult> {
    return { removed: false, details: 'Manual removal required' };
  },
};
