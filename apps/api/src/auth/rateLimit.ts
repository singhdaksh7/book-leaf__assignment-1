/**
 * In-memory failure counter for login throttling. Per-process only: with several API instances each keeps its own
 * count, so the effective limit is multiplied. Acceptable for this deployment; swap for a shared store if scaled out.
 */
export class FailureLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maxFailures: number, private readonly windowMs: number) {}

  /** Seconds until the key may try again, or 0 if allowed. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) return 0;
    return entry.count >= this.maxFailures ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      this.prune(now);
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count += 1;
    }
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    if (this.entries.size < 10_000) return;
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
  }
}
