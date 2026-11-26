import { cachedJsonProxy, proxyError } from '@/lib/edge-json';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const corporation = new URL(request.url).searchParams.get('corporation');
  if (!corporation || !/^\d{6,12}$/.test(corporation)) {
    return Response.json({ error: '军团 ID 无效。' }, { status: 400 });
  }
  try {
    return await cachedJsonProxy(request, `esi:lp-store:${corporation}`, 600, () => fetch(
      `https://esi.evetech.net/loyalty/stores/${corporation}/offers?datasource=tranquility`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Glory-Navy/1.0' } },
    ));
  } catch (error) {
    return proxyError(error);
  }
}
