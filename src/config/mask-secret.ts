/**
 * config/mask-secret.ts — Safe key display.
 *
 * Masks API keys for display:
 *   - Long keys (>6 chars): show first 3 and last 3, mask middle (e.g. "BSA••••7A9")
 *   - Short keys (<=6 chars): show "***" only
 *   - Empty/null/undefined: return empty string
 */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return '';
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}${'•'.repeat(Math.min(value.length - 6, 8))}${value.slice(-3)}`;
}
