/**
 * mcp/server.ts — MCP stdio server exposing reliable_web_search tool (v0.3.0)
 *
 * Uses official @modelcontextprotocol/sdk for JSON-RPC framing over stdio.
 * All debug output goes to stderr; stdout is MCP protocol only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { reliableSearch } from '../reliable-search.js';
import { loadConfig } from '../config/load.js';
import { resolveCredential, loadCredentials } from '../config/credentials.js';
import { registry } from '../providers/registry.js';
import { configDir } from '../config/paths.js';
import type { ResultStatus } from '../types.js';

function log(...args: unknown[]): void {
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  process.stderr.write(`[rws-mcp] ${msg}\n`);
}

export async function runMcpServer(): Promise<void> {
  // Load user config
  const { config, warnings } = loadConfig();
  if (warnings.length > 0) {
    log('Config warnings:', warnings.join('; '));
  }

  // Set up credentials from env or file
  setupCredentials();

  const server = new McpServer({
    name: 'reliable-web-search',
    version: '0.3.0',
  }, {
    capabilities: { tools: {} },
  });

  // ── Register reliable_web_search tool ──────────────

  server.tool(
    'reliable_web_search',
    `Search the web using multiple providers with automatic fallback, circuit breaking, and resilience.

Use this tool for current or externally verifiable information.
A failed retrieval is not evidence that a claim is false.
no_results from one provider does not prove that information does not exist.
Only treat results as reviewable when usableForReview is true.
Inspect providerPath and attempts when diagnosing failures.`,
    {
      query: z.string().min(1, 'Query must not be empty after trimming'),
      count: z.number().int().min(1).max(20).optional(),
      strategy: z.enum(['fallback', 'race', 'aggregate']).optional(),
      providers: z.array(z.string()).optional(),
      freshness: z.enum(['day', 'week', 'month', 'year']).optional(),
    },
    async (params) => {
      const query = params.query.trim();

      try {
        const result = await reliableSearch(query, {
          count: params.count ?? config.count,
          providers: params.providers?.length ? params.providers : config.providers.length > 0 ? config.providers : undefined,
          fallback: params.strategy
            ? { mode: params.strategy }
            : { mode: config.defaultStrategy },
          timeout: config.timeoutMs,
          freshness: params.freshness,
        });

        // Format results as structured output
        const textSummary = formatTextSummary(result.results, result.provider);
        const structuredResult = {
          resultStatus: result.resultStatus,
          retrievalSucceeded: result.retrievalSucceeded,
          usableForReview: result.usableForReview,
          results: result.results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
            provider: r.provider,
            publishedAt: r.publishedAt,
          })),
          provider: result.provider,
          providerPath: result.providerPath,
          fallbackReason: result.fallbackReason,
          attempts: result.attempts,
          elapsedMs: result.elapsedMs,
          cacheHit: result.cacheHit,
        };

        return {
          content: [
            { type: 'text' as const, text: textSummary },
            { type: 'text' as const, text: JSON.stringify(structuredResult, null, 2) },
          ],
        };
      } catch (err: unknown) {
        const message = (err as Error).message;
        // Sanitize: remove any potential API keys from error message
        const sanitized = sanitizeMessage(message);

        return {
          content: [
            { type: 'text' as const, text: `Search failed: ${sanitized}` },
            {
              type: 'text' as const,
              text: JSON.stringify({
                resultStatus: 'failed' as ResultStatus,
                retrievalSucceeded: false,
                usableForReview: false,
                results: [],
                provider: 'none',
                providerPath: [],
                attempts: [],
                elapsedMs: 0,
                cacheHit: false,
                error: sanitized,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── Start stdio transport ──────────────────────────

  const transport = new StdioServerTransport();

  // Graceful shutdown
  let shuttingDown = false;
  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } catch {
      // Best effort
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('disconnect', cleanup);

  // Connect the server
  await server.connect(transport);

  log(`MCP server started`);
  log(`Config dir: ${configDir()}`);
  log(`Providers: ${config.providers.length > 0 ? config.providers.join(', ') : 'auto-detect'}`);
  log(`Strategy: ${config.defaultStrategy}`);
}

// ── Helpers ──────────────────────────────────────────

function setupCredentials(): void {
  try {
    // Verify we can read the credentials file
    loadCredentials();
  } catch {
    // Credentials file may not exist — that's OK
  }

  // Load env vars from credentials for providers that need them
  for (const provider of registry.list()) {
    if (provider.requiresKey && provider.envVars.length > 0) {
      const envVar = provider.envVars[0]!;
      if (!process.env[envVar]) {
        const credValue = resolveCredential(envVar);
        if (credValue) {
          // Temporarily populate env for core SDK compatibility
          process.env[envVar] = credValue;
        }
      }
    }
  }
}

function formatTextSummary(results: Array<{ title: string; url: string; snippet: string }>, provider: string): string {
  if (results.length === 0) {
    return `No results found via ${provider}.`;
  }
  const lines: string[] = [`Search results via ${provider} (${results.length} results):`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    lines.push(`\n${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
  }
  return lines.join('\n');
}

function sanitizeMessage(msg: string): string {
  // Remove any API key patterns (e.g. key=BSA... or Authorization: Bearer ...)
  return msg
    .replace(/key=[A-Za-z0-9_-]{8,}/g, 'key=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer ***')
    .replace(/([A-Z]{3,6})[A-Za-z0-9]{20,}/g, '$1***');
}
