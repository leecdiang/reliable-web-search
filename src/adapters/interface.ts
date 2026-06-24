/**
 * adapters/interface.ts — AgentHostAdapter contract (v0.3.0)
 *
 * Each host adapter (OpenClaw, Codex, Claude Code, Generic MCP)
 * implements this interface.
 */

export interface HostDetection {
  installed: boolean;
  command?: string;
  version?: string;
  reason?: string;
}

export interface HostInstallInput {
  serverName: 'reliable-web-search';
  command: string;
  args: string[];
}

export interface HostInstallResult {
  configured: boolean;
  configLocation?: string;
}

export interface HostInstallationState {
  configured: boolean;
  configLocation?: string;
  details?: Record<string, unknown>;
}

export interface HostVerificationResult {
  verified: boolean;
  issues: string[];
}

export interface HostUninstallResult {
  removed: boolean;
  details: string;
}

export interface AgentHostAdapter {
  readonly id: string;
  readonly displayName: string;

  detect(): Promise<HostDetection>;
  inspect(): Promise<HostInstallationState>;

  install(input: HostInstallInput): Promise<HostInstallResult>;
  verify(): Promise<HostVerificationResult>;
  uninstall(): Promise<HostUninstallResult>;
}
