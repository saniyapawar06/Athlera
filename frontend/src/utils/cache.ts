// Tiny in-memory response cache for stale-while-revalidate UX.
// Lets screens seed initial state instantly on revisit (no blank loaders)
// while a background refetch keeps data fresh. Cleared on logout.
const store = new Map<string, any>();

export function cacheGet<T = any>(key: string): T | undefined {
  return store.get(key);
}

export function cacheSet<T = any>(key: string, value: T): void {
  store.set(key, value);
}

export function cacheClear(): void {
  store.clear();
}
