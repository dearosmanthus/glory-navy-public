import { cachedJsonProxy, parseTypeIds, proxyError } from '@/lib/edge-json';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const typeIds = parseTypeIds(new URL(request.url).searchParams.get('types'), 1000);
  if (!typeIds) return Response.json({ error: '物品 ID 无效。' }, { status: 400 });
  const key = `esi:type-names:${typeIds.join(',')}`;
  try {
    return await cachedJsonProxy(request, key, 86_400, () => fetch(
      'https://esi.evetech.net/universe/names?datasource=tranquility',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Glory-Navy/1.0',
        },
        body: JSON.stringify(typeIds),
      },
    ));
  } catch (error) {
    return proxyError(error);
  }
}
