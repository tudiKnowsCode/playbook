// Tiny in-process TTL cache. The upstream APIs are rate-limited and slow (Sleeper's
// player dictionary is ~5MB), so every provider call goes through here.

interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/**
 * Returns the cached value for `key`, or calls `fn` and caches the result.
 * Concurrent callers with the same key share one `fn` invocation.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fn()
    .then((value) => {
      store.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/** Drops cache entries whose key contains `fragment`; no argument clears everything. */
export function invalidate(fragment?: string): void {
  if (!fragment) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.includes(fragment)) store.delete(key);
  }
}

/** Serves a stale value rather than throwing when a refresh fails. */
export async function cachedResilient<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await cached(key, ttlMs, fn);
  } catch (err) {
    const stale = store.get(key);
    if (stale) return stale.value as T;
    throw err;
  }
}
