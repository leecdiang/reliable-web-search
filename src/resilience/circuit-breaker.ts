/**
 * ============================================================
 *  Circuit Breaker — three-state failure protection
 * ============================================================
 *  States: CLOSED (normal) → OPEN (tripped) → HALF_OPEN (testing)
 *
 *  Prevents repeatedly calling a failing provider, giving it
 *  time to recover. After `recoveryTimeout` ms, the breaker
 *  moves to half-open and allows one trial request.
 */

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerOptions {
  /** Consecutive failures to trip (default 3) */
  failureThreshold: number;
  /** Recovery timeout ms before half-open (default 60000) */
  recoveryTimeout: number;
  /** Max trial requests allowed in half-open state (default 1) */
  halfOpenMaxRequests: number;
}

export class CircuitBreaker {
  readonly providerId: string;
  private _state: BreakerState = 'closed';
  private _failureCount = 0;
  private _lastFailureTime = 0;
  private _halfOpenRequests = 0;
  private _openedAt = 0;
  private _opts: Required<BreakerOptions>;

  constructor(providerId: string, opts?: Partial<BreakerOptions>) {
    this.providerId = providerId;
    this._opts = {
      failureThreshold: opts?.failureThreshold ?? 3,
      recoveryTimeout: opts?.recoveryTimeout ?? 60_000,
      halfOpenMaxRequests: opts?.halfOpenMaxRequests ?? 1,
    };
  }

  get state(): BreakerState {
    return this._state;
  }

  get failureCount(): number {
    return this._failureCount;
  }

  /**
   * Check if a request is allowed through.
   * Returns `true` if the provider should be called.
   */
  allowRequest(): boolean {
    if (this._state === 'closed') return true;

    if (this._state === 'open') {
      if (Date.now() - this._openedAt >= this._opts.recoveryTimeout) {
        this._state = 'half_open';
        this._halfOpenRequests = 0;
      } else {
        return false;
      }
    }

    if (this._state === 'half_open') {
      if (this._halfOpenRequests < this._opts.halfOpenMaxRequests) {
        this._halfOpenRequests++;
        return true;
      }
      return false;
    }

    return true;
  }

  /** Record a successful request */
  recordSuccess(): void {
    this._failureCount = 0;
    this._lastFailureTime = 0;
    this._halfOpenRequests = 0;
    this._state = 'closed';
  }

  /** Record a failed request */
  recordFailure(): void {
    this._failureCount++;
    this._lastFailureTime = Date.now();

    if (
      this._state === 'half_open' ||
      this._failureCount >= this._opts.failureThreshold
    ) {
      this._state = 'open';
      this._openedAt = Date.now();
      this._halfOpenRequests = 0;
    }
  }

  /** Reset breaker to initial state */
  reset(): void {
    this._state = 'closed';
    this._failureCount = 0;
    this._lastFailureTime = 0;
    this._halfOpenRequests = 0;
    this._openedAt = 0;
  }
}

/** Manages circuit breakers per provider */
export class BreakerRegistry {
  private _breakers = new Map<string, CircuitBreaker>();
  private _opts: Partial<BreakerOptions>;

  constructor(opts?: Partial<BreakerOptions>) {
    this._opts = opts ?? {};
  }

  get(providerId: string): CircuitBreaker {
    let breaker = this._breakers.get(providerId);
    if (!breaker) {
      breaker = new CircuitBreaker(providerId, this._opts);
      this._breakers.set(providerId, breaker);
    }
    return breaker;
  }

  resetAll(): void {
    for (const breaker of this._breakers.values()) {
      breaker.reset();
    }
  }

  remove(providerId: string): boolean {
    return this._breakers.delete(providerId);
  }
}
