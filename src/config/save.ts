/**
 * config/save.ts — Atomic config save (v2 format).
 */
import { writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { configFilePath } from './paths.js';
import type { RwsConfigV2 } from '../types.js';

export function saveConfig(config: RwsConfigV2): void {
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
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
}
