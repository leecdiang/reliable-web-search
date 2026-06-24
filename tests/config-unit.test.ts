/**
 * Config module unit tests — v0.3.0
 *
 * Tests config paths, schema validation, load/save, credentials, and masking.
 * These tests import source modules directly (no dist/cli.js dependency).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── mask-secret ──────────────────────────────────────

import { maskSecret } from '../src/config/mask-secret.js';

describe('maskSecret', () => {
  it('masks keys longer than 6 chars', () => {
    const result = maskSecret('BSA1234567890ABCDEF7A9');
    assert.ok(result.startsWith('BSA'), `should start with first 3 chars, got ${result}`);
    assert.ok(result.endsWith('7A9'), `should end with last 3 chars, got ${result}`);
    assert.ok(result.includes('•'), 'should contain bullet characters');
    assert.ok(!result.includes('1234567890ABCDEF'), 'should not contain middle portion');
  });

  it('masks short keys (<=6 chars) fully', () => {
    assert.equal(maskSecret('abc123'), '***');
    assert.equal(maskSecret('123'), '***');
    assert.equal(maskSecret(''), '');
  });

  it('handles undefined and null', () => {
    assert.equal(maskSecret(undefined), '');
    assert.equal(maskSecret(null), '');
  });
});

// ── schema ───────────────────────────────────────────

import { validate, DEFAULT_CONFIG, ConfigValidationError } from '../src/config/schema.js';

describe('Config validation', () => {
  it('accepts valid default config', () => {
    const result = validate(DEFAULT_CONFIG);
    assert.deepEqual(result, DEFAULT_CONFIG);
  });

  it('rejects non-object', () => {
    assert.throws(() => validate(null), ConfigValidationError);
    assert.throws(() => validate('string'), ConfigValidationError);
  });

  it('rejects invalid version', () => {
    assert.throws(() => validate({ ...DEFAULT_CONFIG, version: 0 }), ConfigValidationError);
  });

  it('rejects invalid strategy', () => {
    assert.throws(() => validate({ ...DEFAULT_CONFIG, defaultStrategy: 'invalid' }), ConfigValidationError);
  });

  it('rejects invalid providers', () => {
    assert.throws(() => validate({ ...DEFAULT_CONFIG, providers: 'not-an-array' }), ConfigValidationError);
  });

  it('rejects invalid count', () => {
    assert.throws(() => validate({ ...DEFAULT_CONFIG, count: 0 }), ConfigValidationError);
    assert.throws(() => validate({ ...DEFAULT_CONFIG, count: 100 }), ConfigValidationError);
  });

  it('rejects invalid timeoutMs', () => {
    assert.throws(() => validate({ ...DEFAULT_CONFIG, timeoutMs: 500 }), ConfigValidationError);
    assert.throws(() => validate({ ...DEFAULT_CONFIG, timeoutMs: 999999 }), ConfigValidationError);
  });
});

// ── load / save (integration with fake HOME) ─────────

import { loadConfig } from '../src/config/load.js';
import { saveConfig } from '../src/config/save.js';

let fakeHome: string;
let origHome: string | undefined;

describe('Config load/save with fake HOME', () => {
  before(() => {
    origHome = process.env.HOME;
    fakeHome = mkdtempSync(join(tmpdir(), 'rws-config-unit-'));
    process.env.HOME = fakeHome;
  });

  after(() => {
    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('loadConfig returns defaults when no file exists', () => {
    const result = loadConfig();
    assert.equal(result.source, 'default');
    assert.deepEqual(result.config, DEFAULT_CONFIG);
    assert.equal(result.warnings.length, 0);
  });

  it('saveConfig writes and loadConfig reads back', () => {
    const cfg = { ...DEFAULT_CONFIG, providers: ['brave', 'duckduckgo'], defaultStrategy: 'race' as const };
    saveConfig(cfg);
    const result = loadConfig();
    assert.equal(result.source, 'file');
    assert.deepEqual(result.config.providers, ['brave', 'duckduckgo']);
    assert.equal(result.config.defaultStrategy, 'race');
  });

  it('corrupted config returns defaults with warnings', () => {
    const configPath = join(fakeHome, '.config', 'reliable-web-search', 'config.json');
    writeFileSync(configPath, 'NOT VALID JSON {{{');
    const result = loadConfig();
    assert.equal(result.source, 'default');
    assert.ok(result.warnings.length > 0, 'should have warnings');
    assert.ok(
      result.warnings.some((w) => w.includes('JSON') || w.includes('valid')),
      `warning should mention JSON validity, got: ${result.warnings.join(', ')}`,
    );
    // Corrupted file should still exist (not overwritten)
    assert.equal(readFileSync(configPath, 'utf-8'), 'NOT VALID JSON {{{');
  });

  it('atomic save does not leave .tmp files', () => {
    const cfg = { ...DEFAULT_CONFIG, providers: ['tavily'] };
    saveConfig(cfg);
    const configDir = join(fakeHome, '.config', 'reliable-web-search');
    const files = readdirSync(configDir);
    const tmpFiles = files.filter((f: string) => f.endsWith('.tmp'));
    assert.equal(tmpFiles.length, 0, 'no .tmp files should remain');
  });
});

// ── credentials ──────────────────────────────────────

import { loadCredentials, saveCredentials, resolveCredential } from '../src/config/credentials.js';

describe('Credentials with fake HOME', () => {
  before(() => {
    origHome = process.env.HOME;
    fakeHome = mkdtempSync(join(tmpdir(), 'rws-cred-unit-'));
    process.env.HOME = fakeHome;
  });

  after(() => {
    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('loadCredentials returns empty when no file', () => {
    const creds = loadCredentials();
    assert.deepEqual(creds, {});
  });

  it('saveCredentials writes and enforces 0600 on Unix', () => {
    saveCredentials({ BRAVE_API_KEY: 'test-key-123' });
    const creds = loadCredentials();
    assert.equal(creds.BRAVE_API_KEY, 'test-key-123');

    const credPath = join(fakeHome, '.config', 'reliable-web-search', 'credentials.json');
    const stat = statSync(credPath);
    if (process.platform !== 'win32') {
      assert.equal(stat.mode & 0o777, 0o600, `credentials permissions should be 600, got ${(stat.mode & 0o777).toString(8)}`);
    }
  });

  it('resolveCredential prefers env var over file', () => {
    saveCredentials({ BRAVE_API_KEY: 'file-key' });
    process.env.BRAVE_API_KEY = 'env-key';
    const source = { from: 'none' as const };
    const value = resolveCredential('BRAVE_API_KEY', undefined, source as any);
    assert.equal(value, 'env-key');
    assert.equal((source as any).from, 'env');
    delete process.env.BRAVE_API_KEY;
  });

  it('resolveCredential falls back to file', () => {
    saveCredentials({ BRAVE_API_KEY: 'file-key' });
    delete process.env.BRAVE_API_KEY;
    const source = { from: 'none' as const };
    const value = resolveCredential('BRAVE_API_KEY', undefined, source as any);
    assert.equal(value, 'file-key');
    assert.equal((source as any).from, 'file');
  });
});
