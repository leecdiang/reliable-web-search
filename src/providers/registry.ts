/**
 * Provider Registry — sorted by priority, with typo suggestions.
 */
import type { ProviderRegistry as IProviderRegistry, SearchProvider } from '../types.js';

class Registry implements IProviderRegistry {
  private _providers = new Map<string, SearchProvider>();

  register(provider: SearchProvider): void {
    if (this._providers.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" is already registered.`);
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
    return [...this._providers.values()].sort((a, b) => a.priority - b.priority);
  }

  detect(): SearchProvider[] {
    const available: SearchProvider[] = [];
    for (const provider of this.list()) {
      if (!provider.requiresKey) {
        available.push(provider);
        continue;
      }
      if (provider.isConfigured && provider.isConfigured()) {
        available.push(provider);
        continue;
      }
      const hasKey = provider.envVars.some(
        (ev) => typeof process.env[ev] === 'string' && process.env[ev]!.trim().length > 0
      );
      if (hasKey) available.push(provider);
    }
    // Already sorted by priority from list()
    return available;
  }

  suggest(candidate: string): string[] {
    const ids = [...this._providers.keys()];
    const lower = candidate.toLowerCase().trim();
    // Exact match
    if (ids.includes(lower)) return [];
    // Levenshtein distance ≤ 2
    const suggestions: { id: string; d: number }[] = [];
    for (const id of ids) {
      const d = levenshtein(lower, id);
      if (d <= 2) suggestions.push({ id, d });
    }
    suggestions.sort((a, b) => a.d - b.d);
    return suggestions.slice(0, 3).map((s) => s.id);
  }
}

export const registry: IProviderRegistry = new Registry();
export { Registry };

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! :
        Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!) + 1;
    }
  }
  return dp[m]![n]!;
}
