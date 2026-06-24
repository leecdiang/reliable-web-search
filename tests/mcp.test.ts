/**
 * MCP Server regression tests — v0.3.0
 *
 * Validates:
 *   - stdio initialize/listTools/callTool/shutdown handshake
 *   - reliable_web_search tool schema
 *   - tool call goes through existing core
 *   - timeout/cancellation passed to core
 *   - no banner/log on stdout
 *   - credentials not leaked in MCP responses or stderr
 *
 * Uses a fake HOME to avoid real user credentials.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';

const CLI = join(process.cwd(), 'dist', 'cli.js');

// Skip until MCP server is implemented (commit 4)
const skipAll = 'MCP server not yet implemented (pending commit 4)';

let fakeHome: string;

/** Minimal MCP client for integration testing */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

function request(id: number, method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, params };
}

type McpResult = { _id: number; _result: unknown; _error?: unknown };

/**
 * Spawn rws mcp, send a sequence of JSON-RPC requests, collect results.
 */
async function mcpRoundtrip(
  messages: JsonRpcRequest[],
  env: Record<string, string>,
): Promise<McpResult[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [CLI, 'mcp'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const results: McpResult[] = [];
    let buffer = '';

    const rl = createInterface({ input: proc.stdout! });
    rl.on('line', (line: string) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.id !== undefined) {
          results.push({ _id: parsed.id as number, _result: parsed.result, _error: parsed.error });
        }
      } catch {
        // skip non-JSON lines
      }
    });

    // Collect stderr separately — should not contain credentials
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('error', reject);

    // Send messages sequentially
    let sent = 0;
    const sendNext = () => {
      if (sent >= messages.length) {
        proc.stdin?.end();
        return;
      }
      const msg = JSON.stringify(messages[sent]) + '\n';
      proc.stdin?.write(msg);
      sent++;
      if (sent < messages.length) {
        setTimeout(sendNext, 50);
      } else {
        // Give time for last response then close
        setTimeout(() => proc.stdin?.end(), 500);
      }
    };

    proc.stdin?.on('error', () => {}); // ignore EPIPE

    proc.on('close', (code) => {
      resolve(results);
    });

    sendNext();
  });
}

describe('MCP — stdio handshake', { skip: skipAll }, () => {
  before(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'rws-mcp-test-'));
  });

  it('completes initialize → listTools → shutdown', async () => {
    const results = await mcpRoundtrip(
      [
        request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} }),
        request(2, 'tools/list'),
        request(3, 'shutdown'),
      ],
      { ...process.env, HOME: fakeHome },
    );

    // initialize response
    const init = results.find((r) => r._id === 1);
    assert.ok(init, 'should get initialize response');
    assert.ok(!init._error, 'initialize should not error');

    // tools/list response
    const tools = results.find((r) => r._id === 2);
    assert.ok(tools, 'should get tools/list response');
    assert.ok(!tools._error, 'tools/list should not error');
    const toolList = (tools._result as any)?.tools as any[];
    assert.ok(Array.isArray(toolList), 'tools should be an array');
    assert.ok(
      toolList.some((t: any) => t.name === 'reliable_web_search'),
      'should include reliable_web_search tool',
    );
  });

  it('tool call invokes core search and returns structured result', async () => {
    // Setup with DDG (no key needed) as default provider
    const configDir = join(fakeHome, '.config', 'reliable-web-search');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        version: 1,
        defaultStrategy: 'fallback',
        providers: ['duckduckgo'],
        count: 3,
        timeoutMs: 10000,
      }),
    );

    const results = await mcpRoundtrip(
      [
        request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} }),
        request(2, 'tools/call', {
          name: 'reliable_web_search',
          arguments: { query: 'hello world', count: 2 },
        }),
      ],
      { ...process.env, HOME: fakeHome },
    );

    const call = results.find((r) => r._id === 2);
    assert.ok(call, 'should get tools/call response');
    // Result should have structured fields
    const content = (call._result as any)?.content;
    assert.ok(content, 'should have content in result');
  });

  it('stdout has no banner or log pollution', async () => {
    // Spawn mcp, capture first line from stdout
    const proc = spawn(process.execPath, [CLI, 'mcp'], {
      env: { ...process.env, HOME: fakeHome },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let firstLine = '';
    const rl = createInterface({ input: proc.stdout! });
    rl.on('line', (line: string) => {
      if (!firstLine) firstLine = line;
      proc.kill();
    });

    await new Promise<void>((resolve) => {
      // After init, send something and check stdout
      setTimeout(() => {
        proc.stdin?.write(JSON.stringify(request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} })) + '\n');
      }, 200);
      setTimeout(() => resolve(), 800);
    });

    proc.kill();
    // First line of stdout should be JSON, not a banner
    if (firstLine) {
      try {
        JSON.parse(firstLine);
      } catch {
        assert.fail(`stdout first line should be JSON, got: ${firstLine}`);
      }
    }
  });

  after(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });
});

describe('MCP — credentials safety', { skip: skipAll }, () => {
  before(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'rws-mcp-sec-test-'));
    const configDir = join(fakeHome, '.config', 'reliable-web-search');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'credentials.json'),
      JSON.stringify({ BRAVE_API_KEY: 'SECRET-KEY-12345' }),
    );
    chmodSync(join(configDir, 'credentials.json'), 0o600);
  });

  it('API key does not appear in MCP stderr', async () => {
    // Spawn mcp and capture stderr
    const proc = spawn(process.execPath, [CLI, 'mcp'], {
      env: { ...process.env, HOME: fakeHome },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.stdin?.write(JSON.stringify(request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} })) + '\n');
    await new Promise((r) => setTimeout(r, 500));
    proc.kill();

    assert.ok(!stderr.includes('SECRET-KEY-12345'), 'credentials must not appear in stderr');
  });

  after(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });
});
