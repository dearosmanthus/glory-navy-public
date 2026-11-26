type Loader = () => Promise<Response>;
type LoadedJson = { body: string; contentType: string };

const inFlight = new Map<string, Promise<LoadedJson>>();

function cacheStorage() {
  return (globalThis.caches as CacheStorage & { default?: Cache } | undefined)?.default;
}

function marked(response: Response, state: 'HIT' | 'MISS' | 'COALESCED') {
  const headers = new Headers(response.headers);
  headers.set('X-Glory-Cache', state);
  // Keep the public API response out of the zone-wide browser/CDN cache. The
  // normalized private cache below remains the single source of TTL behavior.
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  headers.set('CDN-Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function loadedResponse(payload: LoadedJson, maxAge: number) {
  return new Response(payload.body, {
    status: 200,
    headers: {
      'Cache-Control': `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 3}`,
      'Content-Type': payload.contentType,
    },
  });
}

export async function cachedJsonProxy(request: Request, key: string, maxAge: number, loader: Loader) {
  const storage = cacheStorage();
  const requestUrl = new URL(request.url);
  requestUrl.pathname = '/__glory_edge_cache__';
  requestUrl.search = new URLSearchParams({ key }).toString();
  const cacheKey = new Request(requestUrl, { method: 'GET' });

  if (storage) {
    const cached = await storage.match(cacheKey);
    if (cached) return marked(cached, 'HIT');
  }

  const pending = inFlight.get(key);
  if (pending) return marked(loadedResponse(await pending, maxAge), 'COALESCED');

  const load = (async () => {
    const upstream = await loader();
    if (!upstream.ok) throw new Error(`Upstream returned ${upstream.status}`);
    const payload = {
      body: await upstream.text(),
      contentType: upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8',
    };
    if (storage) await storage.put(cacheKey, loadedResponse(payload, maxAge));
    return payload;
  })();
  inFlight.set(key, load);
  try {
    return marked(loadedResponse(await load, maxAge), 'MISS');
  } finally {
    inFlight.delete(key);
  }
}

export function parseTypeIds(value: string | null, limit: number) {
  if (!value) return null;
  const raw = value.split(',');
  if (raw.length < 1 || raw.length > limit) return null;
  const ids = raw.map(Number);
  if (!ids.every((id) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647)) return null;
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

export function proxyError(error: unknown) {
  console.error('Upstream proxy failed', error);
  return Response.json(
    { error: '外部数据源暂时不可用，请稍后重试。' },
    { status: 502, headers: { 'Cache-Control': 'no-store' } },
  );
}
