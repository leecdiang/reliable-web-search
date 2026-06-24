/**
 * config/credentials.ts — Credential file I/O.
 *
 * Separate file from config.json so it can have different (stricter) permissions.
 *
 * Rules:
 *  - Unix: credentials file mode must be 0600.
 *  - Environment variables override file values.
 *  - Errors reading/writing credentials are surfaced clearly.
 */
import { readFileSync, writeFileSync, chmodSync, statSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { credentialsFilePath } from './paths.js';

export type CredentialMap = Record<string, string>;

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

  const result: CredentialMap = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

/**
 * Resolve credential for a given env var name.
 * Priority: process.env > credentials file.
 */
export function resolveCredential(
  envVar: string,
  fileCredentials?: CredentialMap,
  source?: { fileValue?: string; from: 'env' | 'file' | 'none' },
): string | undefined {
  // Environment variable always wins
  if (process.env[envVar] && process.env[envVar]!.trim().length > 0) {
    if (source) {
      source.from = 'env';
      source.fileValue = undefined;
    }
    return process.env[envVar]!;
  }

  const creds = fileCredentials ?? loadCredentials();
  const fileValue = creds[envVar];
  if (fileValue && fileValue.trim().length > 0) {
    if (source) {
      source.from = 'file';
      source.fileValue = fileValue;
    }
    return fileValue;
  }

  if (source) source.from = 'none';
  return undefined;
}

export function saveCredentials(creds: CredentialMap): void {
  const target = credentialsFilePath();
  const dir = dirname(target);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Load existing credentials and merge
  let existing: CredentialMap = {};
  try { existing = loadCredentials(); } catch { /* start fresh */ }

  const merged = { ...existing, ...creds };

  const tmp = `${target}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  try {
    writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600, encoding: 'utf-8' });

    // Enforce restrictive permissions on Unix
    if (process.platform !== 'win32') {
      chmodSync(tmp, 0o600);
    }

    renameSync(tmp, target);

    // Double-check permissions on final file
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
