/**
 * config/save.ts — Atomic config save.
 *
 * Writes to a temp file, fsyncs, then renames to the target path.
 * This prevents partial writes and corruption on crash.
 */
import { writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { configFilePath } from './paths.js';
import type { RwsConfig } from './schema.js';

export function saveConfig(config: RwsConfig): void {
  const target = configFilePath();
  const dir = dirname(target);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const tmp = `${target}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  try {
    writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, encoding: 'utf-8' });
    renameSync(tmp, target);
  } catch (err) {
    // Clean up temp file if rename failed
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
}
