export type CompactAppraisalType = [
  id: number,
  zh: string,
  en: string,
  volume: number,
  portionSize: number,
  categoryId: number,
  materials: Array<[number, number]> | null,
];

export type ValidAppraisal = {
  v: 1;
  region: string;
  marketScope?: 'station' | 'region';
  pricedAt?: string;
  settings: {
    ore: boolean;
    equipment: boolean;
    oreYield: number;
    scrapYield: number;
    discount: number;
  };
  items: Array<[number, number]>;
  prices: Record<string, [number, number]>;
  types?: CompactAppraisalType[];
};

const allowedRegions = new Set([
  '10000002',
  '10000030',
  '10000032',
  '10000042',
  '10000043',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFinitePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e18;
}

function validPair(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && value.every((item) => Number.isSafeInteger(item) && item > 0 && item <= 1e12);
}

export function validateAppraisal(value: unknown): ValidAppraisal | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.region !== 'string' || !allowedRegions.has(value.region)) return null;

  const settings = value.settings;
  if (
    !isRecord(settings)
    || typeof settings.ore !== 'boolean'
    || typeof settings.equipment !== 'boolean'
    || ![settings.oreYield, settings.scrapYield, settings.discount].every(
      (item) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 100,
    )
  ) return null;

  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 500) return null;
  const items: Array<[number, number]> = [];
  for (const item of value.items) {
    if (!validPair(item)) return null;
    items.push([item[0], item[1]]);
  }
  if (new Set(items.map(([id]) => id)).size !== items.length) return null;

  if (!isRecord(value.prices)) return null;
  const priceEntries = Object.entries(value.prices);
  if (priceEntries.length < 1 || priceEntries.length > 5000) return null;
  const prices: Record<string, [number, number]> = {};
  for (const [typeId, pair] of priceEntries) {
    if (!/^\d{1,12}$/.test(typeId) || !Array.isArray(pair) || pair.length !== 2) return null;
    if (!isFinitePrice(pair[0]) || !isFinitePrice(pair[1])) return null;
    prices[typeId] = [pair[0], pair[1]];
  }
  if (!items.every(([id]) => Object.hasOwn(prices, String(id)))) return null;

  let types: CompactAppraisalType[] | undefined;
  if (value.types !== undefined) {
    if (!Array.isArray(value.types) || value.types.length > 5000) return null;
    types = [];
    const seen = new Set<number>();
    for (const row of value.types) {
      if (
        !Array.isArray(row)
        || row.length !== 7
        || !Number.isSafeInteger(row[0])
        || row[0] <= 0
        || seen.has(row[0])
        || ![row[1], row[2]].every((name) => typeof name === 'string' && name.length > 0 && name.length <= 500)
        || !isFinitePrice(row[3])
        || !Number.isSafeInteger(row[4])
        || row[4] <= 0
        || !Number.isSafeInteger(row[5])
        || row[5] < 0
      ) return null;

      const materials = row[6] ?? [];
      if (!Array.isArray(materials) || materials.length > 100 || !materials.every(validPair)) return null;
      seen.add(row[0]);
      types.push([row[0], row[1], row[2], row[3], row[4], row[5], materials]);
    }
    if (!items.every(([id]) => seen.has(id))) return null;
    const itemIds = new Set(items.map(([id]) => id));
    if (!types.filter(([id]) => itemIds.has(id)).every((row) => (row[6] ?? []).every(([id]) => seen.has(id) && Object.hasOwn(prices, String(id))))) return null;
  }

  if (value.marketScope !== undefined && value.marketScope !== 'station' && value.marketScope !== 'region') return null;
  if (
    value.pricedAt !== undefined
    && (
      typeof value.pricedAt !== 'string'
      || !Number.isFinite(Date.parse(value.pricedAt))
      || Date.parse(value.pricedAt) > Date.now() + 300_000
    )
  ) return null;

  return {
    v: 1,
    region: value.region,
    settings: {
      ore: settings.ore,
      equipment: settings.equipment,
      oreYield: settings.oreYield as number,
      scrapYield: settings.scrapYield as number,
      discount: settings.discount as number,
    },
    items,
    prices,
    ...(types ? { types } : {}),
    ...(value.marketScope ? { marketScope: value.marketScope as 'station' | 'region' } : {}),
    ...(value.pricedAt ? { pricedAt: new Date(value.pricedAt as string).toISOString() } : {}),
  };
}
