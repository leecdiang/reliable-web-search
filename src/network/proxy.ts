/**
 * network/proxy.ts — Environment proxy support for CLI & MCP processes (v0.3.0 RC2)
 *
 * Uses undici's EnvHttpProxyAgent to respect HTTP_PROXY / HTTPS_PROXY / NO_PROXY
 * environment variables at the Node.js fetch level.
 *
 * IMPORTANT: Only call setupProxy() at process entry points (CLI, MCP server).
 * Core SDK imports must NOT produce global side effects — this module exports
 * a no-op when not explicitly activated.
 */
import { EnvHttpProxyAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';

// ── State ────────────────────────────────────────────

let originalDispatcher: Dispatcher | null = null;
let proxyActive = false;
let proxyUrlForLog: string | null = null;
let proxySource: string | null = null;

// ── Public API ───────────────────────────────────────

/**
 * Enable environment-proxy support for this process.
 *
 * Detects HTTP_PROXY / HTTPS_PROXY (and lowercase variants) and installs
 * EnvHttpProxyAgent as the global undici dispatcher. NO_PROXY is respected
 * automatically by EnvHttpProxyAgent.
 *
 * Call exactly once at process entry:
 *   - CLI main() in cli.ts
 *   - MCP server start in mcp/server.ts
 *
 * Safe to call multiple times — subsequent calls are no-ops when already active.
 *
 * Logs a safe status line (URL hostname only, no credentials).
 */
export function setupProxy(): void {
  if (proxyActive) return;

  const httpProxy  = process.env.HTTP_PROXY  || process.env.http_proxy  || '';
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  const noProxyRaw = process.env.NO_PROXY    || process.env.no_proxy    || '';

  const proxyUrl = httpsProxy || httpProxy;
  if (!proxyUrl) return;

  // Record safe info for doctor / logging (strip credentials)
  proxyUrlForLog = sanitizeProxyUrl(proxyUrl);
  proxySource = httpsProxy ? 'HTTPS_PROXY' : 'HTTP_PROXY';

  // Save original dispatcher so we can restore on teardown
  originalDispatcher = getGlobalDispatcher();

  const agent = new EnvHttpProxyAgent();
  setGlobalDispatcher(agent);
  proxyActive = true;

  process.stderr.write(
    `[rws-proxy] enabled via ${proxySource} → ${proxyUrlForLog}` +
    (noProxyRaw ? ` (NO_PROXY: ${noProxyRaw})` : '') +
    '\n',
  );
}

/**
 * Restore the original undici dispatcher (no proxy).
 * Called on MCP server shutdown or process cleanup.
 */
export function teardownProxy(): void {
  if (!proxyActive) return;
  if (originalDispatcher) {
    setGlobalDispatcher(originalDispatcher);
  }
  proxyActive = false;
  proxyUrlForLog = null;
  proxySource = null;
  originalDispatcher = null;
}

/**
 * Query current proxy status — safe to expose in doctor output
 * (no credential-bearing URL is returned).
 */
export interface ProxyStatus {
  detected: boolean;
  enabled: boolean;
  source: string | null;
  /** Hostname portion only — safe for display */
  hostname: string | null;
  /** NO_PROXY value (safe, from env directly) */
  noProxy: string | null;
}

export function getProxyStatus(): ProxyStatus {
  const httpProxy  = process.env.HTTP_PROXY  || process.env.http_proxy  || '';
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  const noProxyRaw = process.env.NO_PROXY    || process.env.no_proxy    || '';
  const detected   = !!(httpsProxy || httpProxy);

  return {
    detected,
    enabled: proxyActive,
    source: proxyActive ? proxySource : detected
      ? (httpsProxy ? 'HTTPS_PROXY' : 'HTTP_PROXY')
      : null,
    hostname: detected ? sanitizeProxyUrl(httpsProxy || httpProxy) : null,
    noProxy: noProxyRaw || null,
  };
}

// ── Helpers ──────────────────────────────────────────

/**
 * Strip credentials (user:password@) from a proxy URL for safe logging.
 * Returns only the scheme + hostname + port.
 */
function sanitizeProxyUrl(raw: string): string {
  try {
    const url = new URL(raw);
    // Return scheme://hostname:port only
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol}//${url.hostname}${port}`;
  } catch {
    // If we can't parse it, show a redacted marker
    return '<proxy-url>';
  }
}
