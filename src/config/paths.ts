/**
 * config/paths.ts — Platform-aware config directory resolution.
 *
 *  Linux:   ${XDG_CONFIG_HOME:-~/.config}/reliable-web-search/
 *  macOS:   ~/.config/reliable-web-search/
 *  Windows: %APPDATA%/reliable-web-search/
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

function xdgConfigHome(): string {
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME;
  return join(homedir(), '.config');
}

function appDataDir(): string {
  if (process.env.APPDATA) return process.env.APPDATA;
  return join(homedir(), 'AppData', 'Roaming');
}

export function configDir(): string {
  if (process.platform === 'win32') {
    return join(appDataDir(), 'reliable-web-search');
  }
  return join(xdgConfigHome(), 'reliable-web-search');
}

export function configFilePath(): string {
  return join(configDir(), 'config.json');
}

export function credentialsFilePath(): string {
  return join(configDir(), 'credentials.json');
}
