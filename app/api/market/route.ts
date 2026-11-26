import { cachedJsonProxy, parseTypeIds, proxyError } from '@/lib/edge-json';
import { MARKETS } from '@/lib/eve-market';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const region = url.searchParams.get('region');
  const market = MARKETS.find((entry) => entry.id === region);
  const typeIds = parseTypeIds(url.searchParams.get('types'), 100);
  if (!market || !typeIds) return Response.json({ error: '市场或物品 ID 无效。' }, { status: 400 });
  const key = `market:${market.station}:${typeIds.join(',')}`;
  try {
    return await cachedJsonProxy(request, key, 60, () => fetch(
      `https://market.fuzzwork.co.uk/aggregates/?station=${market.station}&types=${typeIds.join(',')}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Glory-Navy/1.0' } },
    ));
  } catch (error) {
    return proxyError(error);
  }
}
