/**
 * Smoke test — validates npm pack artifacts:
 *   - ESM import and CJS require
 *   - Packaged CLI (rws --help, rws doctor, rws config path)
 *   - MCP stdio handshake via packaged CLI
 *
 * Run: npm run test:smoke  (or: node --test tests/smoke.test.mjs)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';

const require = createRequire(import.meta.url);
const CLI = join(process.cwd(), 'dist', 'cli.js');

describe('npm pack smoke test', () => {
  // ── SDK API ──────────────────────────────────────

  it('ESM import works and exports reliableSearch', async () => {
    const mod = await import('../dist/index.js');
    assert.equal(typeof mod.reliableSearch, 'function', 'reliableSearch should be a function');
    assert.equal(typeof mod.registry, 'object', 'registry should be an object');
    assert.equal(typeof mod.registry.list, 'function', 'registry.list should be a function');
    assert.ok(mod.createProviderError, 'createProviderError should be exported');
    assert.ok(mod.isProviderError, 'isProviderError should be exported');
  });

  it('CJS require works', () => {
    const mod = require('../dist/index.cjs');
    assert.equal(typeof mod.reliableSearch, 'function', 'reliableSearch should be a function via CJS');
  });

  it('type-only imports work (structural check)', async () => {
    const mod = await import('../dist/index.js');
    const providers = mod.registry.list();
    assert.ok(providers.length >= 8, 'at least 8 built-in providers');
    assert.ok(providers.every((p) => typeof p.id === 'string'), 'all providers have id');
    assert.ok(providers.every((p) => typeof p.priority === 'number'), 'all providers have priority');
    assert.ok(providers.every((p) => p.capabilities), 'all providers have capabilities');
  });

  it('DDG is lowest priority', async () => {
    const mod = await import('../dist/index.js');
    const providers = mod.registry.list();
    const ddg = providers.find((p) => p.id === 'duckduckgo');
    assert.ok(ddg, 'DDG should be registered');
    const others = providers.filter((p) => p.id !== 'duckduckgo');
    assert.ok(others.every((p) => p.priority < ddg.priority), 'DDG should have highest priority number (lowest priority)');
  });

  // ── Packaged CLI ──────────────────────────────────

  it('rws --help exits 0 and prints help', () => {
    // Skip if CLI not built
    if (!existsSync(CLI)) {
      assert.ok(true, 'skipped: dist/cli.js not built');
      return;
    }
    const r = spawnSync(process.execPath, [CLI, '--help'], {
      env: { ...process.env, HOME: tmpdir() },
      encoding: 'utf-8',
    });
    assert.equal(r.status, 0, `exit code ${r.status}`);
    assert.ok(
      r.stdout.includes('rws') || r.stdout.includes('reliable-web-search'),
      'should show help text',
    );
  });

  it('rws config path outputs a path', () => {
    if (!existsSync(CLI)) {
      assert.ok(true, 'skipped: dist/cli.js not built');
      return;
    }
    const r = spawnSync(process.execPath, [CLI, 'config', 'path'], {
      env: { ...process.env, HOME: tmpdir() },
      encoding: 'utf-8',
    });
    assert.equal(r.status, 0, `exit code ${r.status}`);
    assert.ok(
      r.stdout.includes('reliable-web-search'),
      `config path should include reliable-web-search, got: ${r.stdout}`,
    );
  });

  it('rws doctor runs without --live', () => {
    if (!existsSync(CLI)) {
      assert.ok(true, 'skipped: dist/cli.js not built');
      return;
    }
    const r = spawnSync(process.execPath, [CLI, 'doctor'], {
      env: { ...process.env, HOME: tmpdir() },
      encoding: 'utf-8',
    });
    // Doctor may exit 0 or 1 depending on environment
    const output = r.stdout + r.stderr;
    assert.ok(
      output.includes('doctor') || output.includes('Node') || output.includes('check'),
      'doctor should produce output',
    );
  });

  // ── Packaged MCP smoke ────────────────────────────

  it('MCP stdio handshake via built CLI', async () => {
    if (!existsSync(CLI)) {
      assert.ok(true, 'skipped: dist/cli.js not built');
      return;
    }

    // This test spawns the built CLI in MCP mode and validates the protocol
    const fakeHome = mkdtempSync(join(tmpdir(), 'rws-smoke-mcp-'));
    try {
      const proc = spawn(process.execPath, [CLI, 'mcp'], {
        env: { ...process.env, HOME: fakeHome },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const result = await new Promise((resolve) => {
        const rl = createInterface({ input: proc.stdout });
        rl.on('line', (line) => {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === 1) {
              proc.stdin?.write(
                JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
              );
            }
            if (parsed.id === 2) {
              const tools = parsed.result?.tools;
              const hasTool = Array.isArray(tools) && tools.some((t) => t.name === 'reliable_web_search');
              proc.stdin?.write(
                JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'shutdown' }) + '\n',
              );
              resolve(hasTool === true);
            }
          } catch {
            // ignore non-JSON
          }
        });

        // Send initialize
        setTimeout(() => {
          proc.stdin?.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'rws-smoke', version: '0.0.0' },
              },
            }) + '\n',
          );
        }, 200);

        // Send tools/list after a delay
        setTimeout(() => {
          proc.stdin?.write(
            JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n',
          );
        }, 600);

        setTimeout(() => {
          proc.kill();
          resolve(false);
        }, 5000);
      });

      proc.kill();
      assert.ok(result, 'MCP tools/list should include reliable_web_search');
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
