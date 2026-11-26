import { fetchJson } from './fetch-json';

const cache = new Map<string, Promise<unknown>>();

export function cachedJson<T>(url: string, timeoutMs = 30_000): Promise<T> {
  const existing = cache.get(url);
  if (existing) return existing as Promise<T>;
  const pending = fetchJson<T>(url, {}, timeoutMs).catch((error) => {
    cache.delete(url);
    throw error;
  });
  cache.set(url, pending);
  return pending;
}
