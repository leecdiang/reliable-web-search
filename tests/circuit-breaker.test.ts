/**
 * ============================================================
 *  Circuit Breaker Tests
 * ============================================================
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, BreakerRegistry } from '../src/resilience/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    const cb = new CircuitBreaker('test');
    assert.equal(cb.state, 'closed');
    assert.equal(cb.failureCount, 0);
  });

  it('allows requests when closed', () => {
    const cb = new CircuitBreaker('test');
    assert.equal(cb.allowRequest(), true);
  });

  it('trips after threshold failures', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 3 });
    cb.recordFailure();
    assert.equal(cb.state, 'closed');
    cb.recordFailure();
    assert.equal(cb.state, 'closed');
    cb.recordFailure();
    assert.equal(cb.state, 'open');
  });

  it('blocks requests when open', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1 });
    cb.recordFailure();
    assert.equal(cb.allowRequest(), false);
  });

  it('resets on success', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 2 });
    cb.recordFailure();
    cb.recordSuccess();
    assert.equal(cb.state, 'closed');
    assert.equal(cb.failureCount, 0);
  });

  it('resets manually', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1 });
    cb.recordFailure();
    assert.equal(cb.state, 'open');
    cb.reset();
    assert.equal(cb.state, 'closed');
    assert.equal(cb.failureCount, 0);
  });
});

describe('BreakerRegistry', () => {
  it('creates breakers on demand', () => {
    const reg = new BreakerRegistry();
    const cb = reg.get('brave');
    assert.equal(cb.providerId, 'brave');
  });

  it('returns same breaker for same id', () => {
    const reg = new BreakerRegistry();
    const a = reg.get('tavily');
    const b = reg.get('tavily');
    assert.equal(a, b);
  });

  it('resets all breakers', () => {
    const reg = new BreakerRegistry({ failureThreshold: 1 });
    const cb = reg.get('test');
    cb.recordFailure();
    assert.equal(cb.state, 'open');
    reg.resetAll();
    assert.equal(cb.state, 'closed');
  });
});
