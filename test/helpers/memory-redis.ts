// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * In-memory stand-in for the `AppRedis` subset (get/mget/set/del/incr/
 * pexpire), honoring `PX` expiries and `NX`. Lets cache and presence tests
 * run without a Redis server.
 */
export class MemoryRedis {
  readonly store = new Map<string, { value: string; expiresAt: number | null }>();
  /** Flip to simulate an outage: every command rejects. */
  failing = false;

  private read(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  private guard(): void {
    if (this.failing) throw new Error('redis down');
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve().then(() => {
      this.guard();
      return this.read(key);
    });
  }

  mget(...keys: (string | string[])[]): Promise<(string | null)[]> {
    return Promise.resolve().then(() => {
      this.guard();
      return keys.flat().map((key) => this.read(key));
    });
  }

  set(key: string, value: string | number, ...args: (string | number)[]): Promise<'OK' | null> {
    return Promise.resolve().then(() => {
      this.guard();
      const flags = args.map((arg) => String(arg).toUpperCase());
      if (flags.includes('NX') && this.read(key) !== null) return null;
      const px = flags.indexOf('PX');
      const expiresAt = px >= 0 ? Date.now() + Number(args[px + 1]) : null;
      this.store.set(key, { value: String(value), expiresAt });
      return 'OK' as const;
    });
  }

  del(...keys: (string | string[])[]): Promise<number> {
    return Promise.resolve().then(() => {
      this.guard();
      let removed = 0;
      for (const key of keys.flat()) if (this.store.delete(key)) removed++;
      return removed;
    });
  }

  incr(key: string): Promise<number> {
    return Promise.resolve().then(() => {
      this.guard();
      const next = Number(this.read(key) ?? 0) + 1;
      const entry = this.store.get(key);
      this.store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    });
  }

  pexpire(key: string, ms: number): Promise<number> {
    return Promise.resolve().then(() => {
      this.guard();
      const entry = this.store.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + ms;
      return 1;
    });
  }
}
