/**
 * ============================================================
 *  Provider Shared Utilities
 * ============================================================
 *  Shared helpers used by all key-requiring providers.
 *  Extracted here to avoid cross-provider import dependencies.
 */

export function apiKeyMissing(provider: string): string {
  return (
    `missing_api_key: ${provider} requires an API key. ` +
    `Set the ${provider.toUpperCase()}_API_KEY environment variable.`
  );
}

export function apiKeyInvalid(provider: string): string {
  return (
    `invalid_api_key: ${provider} API key is invalid or expired. ` +
    `Check your ${provider.toUpperCase()}_API_KEY environment variable.`
  );
}
