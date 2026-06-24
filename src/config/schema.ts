/**
 * config/schema.ts — Runtime config schema and validation.
 *
 * Config file versioning ensures forward/backward compatibility.
 * Validation runs at load time, not just TypeScript compile time.
 */

export interface RwsConfig {
  version: number;
  defaultStrategy: 'fallback' | 'race' | 'aggregate';
  providers: string[];
  count: number;
  timeoutMs: number;
  connectedHosts: string[];
}

export const DEFAULT_CONFIG: RwsConfig = {
  version: 1,
  defaultStrategy: 'fallback',
  providers: [],
  count: 5,
  timeoutMs: 15_000,
  connectedHosts: [],
};

const VALID_STRATEGIES = ['fallback', 'race', 'aggregate'] as const;

export function validate(raw: unknown): RwsConfig {
  if (!raw || typeof raw !== 'object') {
    throw new ConfigValidationError('config must be a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  // version
  if (typeof obj.version !== 'number' || obj.version < 1) {
    throw new ConfigValidationError(`config.version must be >= 1, got ${obj.version}`);
  }

  // defaultStrategy
  if (typeof obj.defaultStrategy !== 'string' || !(VALID_STRATEGIES as readonly string[]).includes(obj.defaultStrategy)) {
    throw new ConfigValidationError(
      `config.defaultStrategy must be one of [${VALID_STRATEGIES.join(', ')}], got ${obj.defaultStrategy}`,
    );
  }

  // providers
  if (!Array.isArray(obj.providers)) {
    throw new ConfigValidationError('config.providers must be an array');
  }
  if (!obj.providers.every((p: unknown) => typeof p === 'string')) {
    throw new ConfigValidationError('config.providers must be an array of strings');
  }

  // count
  if (typeof obj.count !== 'number' || obj.count < 1 || obj.count > 20) {
    throw new ConfigValidationError(`config.count must be 1-20, got ${obj.count}`);
  }

  // timeoutMs
  if (typeof obj.timeoutMs !== 'number' || obj.timeoutMs < 1000 || obj.timeoutMs > 120_000) {
    throw new ConfigValidationError(`config.timeoutMs must be 1000-120000, got ${obj.timeoutMs}`);
  }

  // connectedHosts
  if (!Array.isArray(obj.connectedHosts)) {
    throw new ConfigValidationError('config.connectedHosts must be an array');
  }

  return {
    version: obj.version,
    defaultStrategy: obj.defaultStrategy as RwsConfig['defaultStrategy'],
    providers: obj.providers as string[],
    count: obj.count,
    timeoutMs: obj.timeoutMs,
    connectedHosts: obj.connectedHosts as string[],
  };
}

export class ConfigValidationError extends Error {
  name = 'ConfigValidationError';
}
