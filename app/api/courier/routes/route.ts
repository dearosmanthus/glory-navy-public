import { cachedJsonProxy, proxyError } from '@/lib/edge-json';

export const dynamic = 'force-dynamic';

const ROUTES_URL = 'https://hallogistics.space/api/routes';

export async function GET(request: Request) {
  try {
    return await cachedJsonProxy(request, 'courier:hallogistics:routes', 300, () => fetch(ROUTES_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Glory-Navy/1.0',
      },
      signal: AbortSignal.timeout(8_000),
    }));
  } catch (error) {
    return proxyError(error);
  }
}
