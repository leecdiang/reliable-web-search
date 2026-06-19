/**
 * ============================================================
 *  Provider Registry — registration + auto-detection
 * ============================================================
 *  Manages search provider lifecycle. Providers register
 *  themselves; the registry handles lookup and credential
 *  auto-detection from environment variables.
 */

import type {
  ProviderRegistry as IProviderRegistry,
  SearchProvider,
} from '../types.js';

class Registry implements IProviderRegistry {
  private _providers = new Map<string, SearchProvider>();

  register(provider: SearchProvider): void {
    if (this._providers.has(provider.id)) {
      throw new Error(
        `Provider "${provider.id}" is already registered. ` +
        `Unregister it first or use a different id.`
      );
    }
    this._providers.set(provider.id, provider);
  }

  unregister(id: string): boolean {
    return this._providers.delete(id);
  }

  get(id: string): SearchProvider | undefined {
    return this._providers.get(id);
  }

  list(): SearchProvider[] {
    return [...this._providers.values()];
  }

  /**
   * Auto-detect providers whose credentials are present in the environment.
   * Keyless providers (DuckDuckGo) are always included.
   * Key-requiring providers are included only when their env var is set.
   */
  detect(): SearchProvider[] {
    const available: SearchProvider[] = [];
    for (const provider of this._providers.values()) {
      if (!provider.requiresKey) {
        available.push(provider);
        continue;
      }
      const hasKey = provider.envVars.some(
        (ev) => typeof process.env[ev] === 'string' && process.env[ev]!.trim().length > 0
      );
      if (hasKey) {
        available.push(provider);
      }
    }
    return available;
  }
}

/** Global singleton registry */
export const registry: IProviderRegistry = new Registry();

export { Registry };
