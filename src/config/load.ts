/**
 * config/load.ts — Load config.json from disk with validation.
 *
 * Corrupted config: report error, do NOT silently overwrite.
 * Missing config: return defaults (not an error).
 */
import { readFileSync } from 'node:fs';
import { configFilePath } from './paths.js';
import { type RwsConfig, DEFAULT_CONFIG, validate, ConfigValidationError } from './schema.js';

export interface LoadResult {
  config: RwsConfig;
  source: 'file' | 'default';
  warnings: string[];
}

export function loadConfig(): LoadResult {
  const path = configFilePath();
  const warnings: string[] = [];

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: { ...DEFAULT_CONFIG }, source: 'default', warnings: [] };
    }
    // Permission error or other — report but use defaults
    warnings.push(`Cannot read config at ${path}: ${(err as Error).message}`);
    return { config: { ...DEFAULT_CONFIG }, source: 'default', warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    warnings.push(`Config file at ${path} is not valid JSON: ${(err as Error).message}. Using defaults. Fix or delete the file to continue.`);
    return { config: { ...DEFAULT_CONFIG }, source: 'default', warnings };
  }

  try {
    const config = validate(parsed);
    return { config, source: 'file', warnings };
  } catch (err: unknown) {
    if (err instanceof ConfigValidationError) {
      warnings.push(`Config at ${path} failed validation: ${err.message}. Using defaults.`);
      return { config: { ...DEFAULT_CONFIG }, source: 'default', warnings };
    }
    throw err;
  }
}
