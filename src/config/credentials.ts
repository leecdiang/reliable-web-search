/**
 * config/credentials.ts — v2 Credential profile storage.
 *
 * Separate file from config.json with stricter permissions (0600 on Unix).
 * Version 2 format uses a profiles map instead of flat key-value pairs.
 * Version 1 format (flat map) is supported for reading but not writing.
 */
import { readFileSync, writeFileSync, chmodSync, statSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { credentialsFilePath } from './paths.js';
import type { CredentialProfile, CredentialsFileV2 } from '../types.js';

export type CredentialMap = Record<string, string>;

/** Runtime helper for resolveCredential source tracking */
export interface ResolveSource {
  fileValue?: string;
  from: 'env' | 'file' | 'none' | 'profile';
}

// ── Load ─────────────────────────────────────────────

export function loadCredentials(): CredentialMap {
  const path = credentialsFilePath();

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }

  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Credentials file at ${path} is not a valid JSON object.`);
  }

  // v2 format — profiles map
  if ((parsed as Record<string, unknown>).version === 2) {
    const v2 = parsed as CredentialsFileV2;
    const flat: CredentialMap = {};
    if (v2.profiles) {
      for (const [id, profile] of Object.entries(v2.profiles)) {
        flat[profile.providerId.toUpperCase() + '_API_KEY'] = profile.apiKey;
      }
    }
    return flat;
  }

  // v1 format — flat map
  const result: CredentialMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

// ── v2 Profile API ───────────────────────────────────

export function loadCredentialProfiles(): Record<string, CredentialProfile> {
  const path = credentialsFilePath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return {};

  if ((parsed as Record<string, unknown>).version === 2) {
    return (parsed as CredentialsFileV2).profiles ?? {};
  }

  // v1: convert to profiles
  const profiles: Record<string, CredentialProfile> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    // Map env-var-style keys back to provider+default
    const providerId = key.replace(/_API_KEY$/i, '').toLowerCase();
    if (providerId && providerId !== key) {
      profiles[`${providerId}.default`] = {
        id: `${providerId}.default`,
        providerId,
        label: 'Default',
        apiKey: value,
        enabled: true,
      };
    }
  }
  return profiles;
}

export function saveCredentialProfiles(profiles: Record<string, CredentialProfile>): void {
  const target = credentialsFilePath();
  const dir = dirname(target);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const data: CredentialsFileV2 = { version: 2, profiles };
  const tmp = `${target}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, encoding: 'utf-8' });

    if (process.platform !== 'win32') {
      chmodSync(tmp, 0o600);
    }

    renameSync(tmp, target);

    if (process.platform !== 'win32') {
      const finalStat = statSync(target);
      if ((finalStat.mode & 0o777) !== 0o600) {
        chmodSync(target, 0o600);
      }
    }
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
}

/** Add or update a single credential profile */
export function upsertCredentialProfile(profile: CredentialProfile): void {
  const profiles = loadCredentialProfiles();
  profiles[profile.id] = profile;
  saveCredentialProfiles(profiles);
}

/** Remove a credential profile by id */
export function removeCredentialProfile(id: string): boolean {
  const profiles = loadCredentialProfiles();
  if (!profiles[id]) return false;
  delete profiles[id];
  saveCredentialProfiles(profiles);
  return true;
}

// ── Legacy flat API (kept for backward compat) ───────

/**
 * Resolve credential for a given env var name.
 * Priority: process.env > v2 profiles > v1 credentials file.
 */
export function resolveCredential(
  envVar: string,
  fileCredentials?: CredentialMap,
  source?: ResolveSource,
): string | undefined {
  if (process.env[envVar] && process.env[envVar]!.trim().length > 0) {
    if (source) { source.from = 'env'; source.fileValue = undefined; }
    return process.env[envVar]!;
  }

  // Try v2 profiles
  const profiles = loadCredentialProfiles();
  const providerId = envVar.replace(/_API_KEY$/i, '').toLowerCase();
  for (const [, profile] of Object.entries(profiles)) {
    if (profile.providerId === providerId && profile.enabled) {
      if (source) { source.from = 'profile'; source.fileValue = undefined; }
      return profile.apiKey;
    }
  }

  const creds = fileCredentials ?? loadCredentials();
  const fileValue = creds[envVar];
  if (fileValue && fileValue.trim().length > 0) {
    if (source) { source.from = 'file'; source.fileValue = fileValue; }
    return fileValue;
  }

  if (source) source.from = 'none';
  return undefined;
}

/** Legacy flat save — converts to v2 profiles internally */
export function saveCredentials(creds: CredentialMap): void {
  const profiles = loadCredentialProfiles();
  for (const [key, value] of Object.entries(creds)) {
    const providerId = key.replace(/_API_KEY$/i, '').toLowerCase();
    if (providerId && providerId !== key) {
      profiles[`${providerId}.default`] = {
        id: `${providerId}.default`,
        providerId,
        label: 'Default',
        apiKey: value,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
    }
  }
  saveCredentialProfiles(profiles);
}
