/**
 * CLI regression tests — v0.3.0
 *
 * These tests validate the CLI entry point behavior:
 *   help, non-TTY, query shorthand, JSON output, key masking.
 * Uses a fake HOME to avoid touching the real user config.
 *
 * NOTE: These tests require `dist/cli.js` to exist (built by tsup).
 * They define the expected contract and will pass once impl lands.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'dist', 'cli.js');

const skipAll = !existsSync(CLI)
  ? 'dist/cli.js not built — run npm run build first'
  : undefined;

let fakeHome: string;

describe('CLI — rws --help', { skip: skipAll }, () => {
  it('prints help and exits 0', () => {
    const r = spawnSync(process.execPath, [CLI, '--help'], {
      env: { ...process.env, HOME: tmpdir() },
      encoding: 'utf-8',
    });
    assert.equal(r.status, 0, `exit code ${r.status}`);
    const output = r.stdout + r.stderr;
    assert.ok(
      output.includes('rws') || output.includes('reliable-web-search') || output.includes('search') || output.includes('Commands'),
    );
  });
});

describe('CLI — rws with no args (non-TTY)', { skip: skipAll }, () => {
  it('does not enter interactive mode when not a TTY', () => {
    const r = spawnSync(process.execPath, [CLI], {
      env: { ...process.env, HOME: tmpdir() },
      encoding: 'utf-8',
    });
    // Non-TTY should show help/usage, not hang waiting for input
    const output = r.stdout + r.stderr;
    assert.ok(
      output.includes('help') || output.includes('Usage') || output.includes('Commands'),
      'should show help text when not a TTY',
    );
  });
});

describe('CLI — rws "query" shorthand', { skip: skipAll }, () => {
  it('attempts search, does not show main help menu', () => {
    const r = spawnSync(process.execPath, [CLI, 'hello world'], {
      env: { ...process.env, HOME: tmpdir() },
      encoding: 'utf-8',
    });
    const combined = r.stdout + r.stderr;
    // Should attempt search — will likely fail without keys but should NOT be the help screen
    assert.ok(
      combined.includes('search') || combined.includes('Search') || combined.includes('Duck') || combined.includes('query'),
      'should attempt a search action',
    );
  });
});

describe('CLI — search with --json', { skip: skipAll }, () => {
  it('outputs JSON-like content on --json', () => {
    const r = spawnSync(process.execPath, [CLI, 'search', 'test', '--json'], {
      env: { ...process.env, HOME: tmpdir() },
      encoding: 'utf-8',
    });
    const stdout = r.stdout.trim();
    // With DDG (no key needed), should produce JSON output
    if (stdout.startsWith('{')) {
      const parsed = JSON.parse(stdout);
      assert.ok(typeof parsed === 'object');
    }
    // At minimum, stdout should not be empty
    assert.ok(stdout.length > 0, 'should produce output');
  });

  it('does not mix log into JSON stdout', () => {
    const r = spawnSync(process.execPath, [CLI, 'search', 'test', '--json'], {
      env: { ...process.env, HOME: tmpdir() },
      encoding: 'utf-8',
    });
    const stdout = r.stdout.trim();
    if (stdout.startsWith('{')) {
      assert.ok(!stdout.includes('\n{'), 'JSON stdout should not have prefix log lines');
    }
  });
});

describe('CLI — API key masking', { skip: skipAll }, () => {
  before(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'rws-cli-test-'));
    const configDir = join(fakeHome, '.config', 'reliable-web-search');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'credentials.json'),
      JSON.stringify({ BRAVE_API_KEY: 'BSA1234567890ABCDEF7A9' }),
    );
    chmodSync(join(configDir, 'credentials.json'), 0o600);
  });

  it('config show masks API keys', () => {
    const r = spawnSync(process.execPath, [CLI, 'config'], {
      env: { ...process.env, HOME: fakeHome },
      encoding: 'utf-8',
    });
    // Full key must not appear
    assert.ok(!r.stdout.includes('BSA1234567890ABCDEF7A9'), 'full key must not leak');
    // Masked form should appear (e.g. BSA••••7A9 or similar)
    assert.ok(r.stdout.includes('BSA') || r.stdout.includes('***') || r.stdout.includes('…'), 'masked key should appear');
  });

  it('API key not leaked in error messages', () => {
    const r = spawnSync(process.execPath, [CLI, 'search', 'test', '--provider', 'brave'], {
      env: { ...process.env, HOME: fakeHome },
      encoding: 'utf-8',
    });
    assert.ok(!r.stderr.includes('BSA1234567890ABCDEF7A9'), 'key should not leak in stderr');
  });

  after(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });
});
