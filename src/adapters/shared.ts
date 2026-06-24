/**
 * adapters/shared.ts — Shared helpers for host adapters.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CliInfo {
  command: string;
  version?: string;
  hasMcpSupport: boolean;
  error?: string;
}

/**
 * Check if a CLI command exists and supports --version + mcp --help.
 */
export function detectCli(command: string): CliInfo {
  const info: CliInfo = { command, hasMcpSupport: false };

  // Check version
  const v = spawnSync(command, ['--version'], {
    encoding: 'utf-8',
    timeout: 5_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (v.status === 0 && v.stdout?.trim()) {
    info.version = v.stdout.trim();
  } else {
    const v2 = spawnSync(command, ['version'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (v2.status === 0 && v2.stdout?.trim()) {
      info.version = v2.stdout.trim();
    }
  }

  if (!info.version) {
    info.error = `Command '${command}' not found or failed to execute`;
    return info;
  }

  // Check MCP support
  const mcp = spawnSync(command, ['mcp', '--help'], {
    encoding: 'utf-8',
    timeout: 5_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = (mcp.stdout ?? '') + (mcp.stderr ?? '');
  info.hasMcpSupport = output.includes('mcp');

  return info;
}

/**
 * Get the real path of the rws binary to use in host configs.
 */
export function resolveRwsCommand(): { command: string; args: string[] } {
  const rwsPath = process.argv[1] ?? '';

  if (rwsPath.includes('rws') || rwsPath.includes('reliable-web-search') || rwsPath.includes('dist/cli.js')) {
    // We're running as the rws CLI — use process.execPath + script path
    return { command: process.execPath, args: [rwsPath, 'mcp'] };
  }

  // Try to find rws on PATH
  const which = spawnSync('which', ['rws'], { encoding: 'utf-8', timeout: 2_000 });
  if (which.status === 0 && which.stdout?.trim()) {
    return { command: which.stdout.trim(), args: ['mcp'] };
  }

  // Last resort: npx with current version
  const version = getCurrentVersion();
  return { command: 'npx', args: ['-y', `reliable-web-search@${version}`, 'mcp'] };
}

function getCurrentVersion(): string {
  try {
    const pkgPath = join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? '0.3.0';
  } catch {
    return '0.3.0';
  }
}
