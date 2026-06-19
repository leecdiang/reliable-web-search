/**
 * ============================================================
 *  Error Classifier Tests
 * ============================================================
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../src/resilience/error-classify.js';

describe('classifyError', () => {
  it('classifies missing api key errors', () => {
    const result = classifyError(new Error('missing_api_key: brave requires an API key'), 'brave');
    assert.equal(result.category, 'missing_credentials');
    assert.equal(result.retryable, false);
    assert.equal(result.shouldFallback, true);
  });

  it('classifies auth failures', () => {
    const result = classifyError(new Error('invalid_api_key'), 'tavily');
    assert.equal(result.category, 'auth_failed');
    assert.equal(result.retryable, false);
  });

  it('classifies auth failures from HTTP 401', () => {
    const result = classifyError({ status: 401, message: 'Unauthorized' }, 'gemini');
    assert.equal(result.category, 'auth_failed');
  });

  it('classifies rate limiting', () => {
    const result = classifyError(new Error('rate limited (HTTP 429)'), 'bocha');
    assert.equal(result.category, 'rate_limited');
    assert.equal(result.retryable, true);
  });

  it('classifies rate limiting from HTTP 429', () => {
    const result = classifyError({ status: 429 }, 'brave');
    assert.equal(result.category, 'rate_limited');
    assert.equal(result.retryable, true);
  });

  it('classifies timeouts', () => {
    const result = classifyError(new Error('Search timed out after 15000ms'), 'tavily');
    assert.equal(result.category, 'timeout');
    assert.equal(result.retryable, true);
  });

  it('classifies server errors', () => {
    const result = classifyError({ status: 500, message: 'Internal Server Error' }, 'ddg');
    assert.equal(result.category, 'server_error');
    assert.equal(result.retryable, true);
  });

  it('classifies network errors', () => {
    const result = classifyError(new Error('fetch failed: ECONNREFUSED'), 'searxng');
    assert.equal(result.category, 'network_error');
    assert.equal(result.retryable, true);
  });

  it('classifies parse errors', () => {
    const result = classifyError(new SyntaxError('Unexpected token < in JSON'), 'metaso');
    assert.equal(result.category, 'parse_error');
    assert.equal(result.retryable, false);
  });

  it('classifies unknown errors', () => {
    const result = classifyError('something weird happened', 'custom');
    assert.equal(result.category, 'unknown');
    assert.equal(result.retryable, false);
  });
});
