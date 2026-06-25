/**
 * config/schema.ts — Config schema v1 + v2 validation.
 *
 * v1: simple provider list + single strategy (deprecated on write, readable forever)
 * v2: ordered routes + credential profiles reference (current)
 */
export interface RwsConfig {
  version: number;
  defaultStrategy: 'fallback' | 'race' | 'aggregate';
  providers: string[];
  count: number;
  timeoutMs: number;
  connectedHosts: string[];
}

export interface RwsConfigV2 {
  version: number;
  defaultStrategy: 'fallback' | 'race' | 'aggregate';
  routes: ProviderRouteData[];
  count: number;
  timeoutMs: number;
  connectedHosts: string[];
  credentialPolicy?: 'failover';
}

export interface ProviderRouteData {
  id: string;
  providerId: string;
  credentialRef?: string;
  label?: string;
  priority: number;
  enabled: boolean;
}

export const DEFAULT_CONFIG: RwsConfig = {
  version: 1,
  defaultStrategy: 'fallback',
  providers: [],
  count: 5,
  timeoutMs: 15_000,
  connectedHosts: [],
};

export const DEFAULT_CONFIG_V2: RwsConfigV2 = {
  version: 2,
  defaultStrategy: 'fallback',
  routes: [],
  count: 5,
  timeoutMs: 15_000,
  connectedHosts: [],
  credentialPolicy: 'failover',
};

const VALID_STRATEGIES = ['fallback', 'race', 'aggregate'] as const;

export function validate(raw: unknown): RwsConfig {
  if (!raw || typeof raw !== 'object') {
    throw new ConfigValidationError('config must be a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.version !== 'number' || obj.version < 1) {
    throw new ConfigValidationError(`config.version must be >= 1, got ${obj.version}`);
  }

  if (typeof obj.defaultStrategy !== 'string' || !(VALID_STRATEGIES as readonly string[]).includes(obj.defaultStrategy)) {
    throw new ConfigValidationError(
      `config.defaultStrategy must be one of [${VALID_STRATEGIES.join(', ')}], got ${obj.defaultStrategy}`,
    );
  }

  if (typeof obj.count !== 'number' || obj.count < 1 || obj.count > 20) {
    throw new ConfigValidationError(`config.count must be 1-20, got ${obj.count}`);
  }

  if (typeof obj.timeoutMs !== 'number' || obj.timeoutMs < 1000 || obj.timeoutMs > 120_000) {
    throw new ConfigValidationError(`config.timeoutMs must be 1000-120000, got ${obj.timeoutMs}`);
  }

  if (!Array.isArray(obj.connectedHosts)) {
    throw new ConfigValidationError('config.connectedHosts must be an array');
  }

  // v2 config — routes-based
  if (obj.version >= 2) {
    if (!Array.isArray(obj.routes)) {
      throw new ConfigValidationError('config.routes must be an array for version >= 2');
    }
    return {
      version: obj.version,
      defaultStrategy: obj.defaultStrategy as RwsConfig['defaultStrategy'],
      providers: [],
      count: obj.count,
      timeoutMs: obj.timeoutMs,
      connectedHosts: obj.connectedHosts as string[],
    };
  }

  // v1 config — providers list
  if (!Array.isArray(obj.providers)) {
    throw new ConfigValidationError('config.providers must be an array');
  }
  if (!obj.providers.every((p: unknown) => typeof p === 'string')) {
    throw new ConfigValidationError('config.providers must be an array of strings');
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
