import { cachedJsonProxy, proxyError } from '@/lib/edge-json';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await cachedJsonProxy(request, 'esi:adjusted-prices', 3600, () => fetch(
      'https://esi.evetech.net/markets/prices/?datasource=tranquility',
      { headers: { Accept: 'application/json', 'User-Agent': 'Glory-Navy/1.0' } },
    ));
  } catch (error) {
    return proxyError(error);
  }
}
