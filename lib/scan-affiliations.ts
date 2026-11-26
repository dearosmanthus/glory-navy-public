import { normalizeScanName, type ScanMember } from './battle-scan';

type UniverseName = { id: number; name: string; category?: string };
type Affiliation = {
  character_id: number;
  corporation_id: number;
  alliance_id?: number;
};
export async function resolveScanMembers(
  names: string[],
  fetcher: typeof fetch = fetch,
): Promise<ScanMember[]> {
  const checkedAt = new Date().toISOString();
  async function post<T>(
    path: string,
    values: string[] | number[],
  ): Promise<T> {
    const response = await fetcher(
      `https://esi.evetech.net/latest/${path}/?datasource=tranquility`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Glory-Navy/1.0',
        },
        body: JSON.stringify(values),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error(`ESI_${response.status}`);
    return (await response.json()) as T;
  }
  const ids = await post<{ characters?: UniverseName[] }>(
    'universe/ids',
    names,
  );
  const characters = new Map(
    (ids.characters ?? []).map((r) => [normalizeScanName(r.name), r]),
  );
  const base = (name: string): ScanMember => ({
    name,
    id: characters.get(normalizeScanName(name))?.id ?? null,
    corporationId: null,
    corporation: null,
    allianceId: null,
    alliance: null,
    status: characters.has(normalizeScanName(name))
      ? 'unavailable'
      : 'not-found',
    checkedAt,
  });
  const characterIds = [...new Set([...characters.values()].map((r) => r.id))];
  if (!characterIds.length) return names.map(base);
  const affiliations = await post<Affiliation[]>(
    'characters/affiliation',
    characterIds,
  );
  const affiliationsById = new Map(
    affiliations.map((r) => [r.character_id, r]),
  );
  const entityIds = [
    ...new Set(
      affiliations.flatMap((r) => [
        r.corporation_id,
        ...(r.alliance_id ? [r.alliance_id] : []),
      ]),
    ),
  ];
  const entityNames = new Map<number, string>();
  // One client batch has at most 250 pilots, so corporation+alliance IDs fit in one ESI batch.
  if (entityIds.length)
    for (const entity of await post<UniverseName[]>(
      'universe/names',
      entityIds,
    ))
      entityNames.set(entity.id, entity.name);
  return names.map((name) => {
    const result = base(name),
      affiliation = result.id ? affiliationsById.get(result.id) : undefined;
    if (!affiliation) return result;
    return {
      ...result,
      corporationId: affiliation.corporation_id,
      corporation: entityNames.get(affiliation.corporation_id) ?? null,
      allianceId: affiliation.alliance_id ?? null,
      alliance: affiliation.alliance_id
        ? (entityNames.get(affiliation.alliance_id) ?? null)
        : null,
      status: 'resolved',
    };
  });
}
