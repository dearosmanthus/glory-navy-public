export type ScanType = [
  id: number,
  zh: string,
  en: string,
  groupId: number,
  mass: number | null,
];
export type ScanGroup = [
  id: number,
  zh: string,
  en: string,
  categoryId: number,
];
export type ScanSystem = [
  id: number,
  zh: string,
  en: string,
  regionId: number,
  security: number,
];
export type ScanCatalog = {
  schema: 1;
  sde: number;
  released: string;
  types: ScanType[];
  groups: ScanGroup[];
  categories: [number, string, string][];
  systems: ScanSystem[];
  regions: [number, string, string][];
};
export type ScanIndex = ReturnType<typeof createScanIndex>;
export type ScanEntry = {
  typeId: number | null;
  name: string;
  typeText: string;
  distance: string;
  metres: number | null;
  issue?: 'unknown' | 'ambiguous' | 'format';
  line: number;
};
export type ScanMember = {
  name: string;
  id: number | null;
  corporationId: number | null;
  corporation: string | null;
  allianceId: number | null;
  alliance: string | null;
  status: 'resolved' | 'not-found' | 'unavailable';
  checkedAt: string;
};
export type ScanSnapshot = {
  v: 1;
  kind: 'dscan' | 'members';
  title: string;
  raw: string;
  analyzedAt: string;
  manual: [number, number][];
  members: ScanMember[];
  example: boolean;
};
export const SCAN_MAX_LINES = 5000;
export const SCAN_MAX_MEMBERS = 3000;
export const SCAN_MAX_INPUT = 350_000;
export const SCAN_MAX_SHARE_BYTES = 1024 * 1024;
export const normalizeScanName = (s: string) =>
  s
    .normalize('NFKC')
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();

export function createScanIndex(data: ScanCatalog) {
  const types = new Map(data.types.map((r) => [r[0], r]));
  const groups = new Map(data.groups.map((r) => [r[0], r]));
  const names = new Map<string, ScanType[]>();
  for (const type of data.types)
    for (const name of new Set([type[1], type[2]].map(normalizeScanName))) {
      const candidates = names.get(name) ?? [];
      candidates.push(type);
      names.set(name, candidates);
    }
  const systemNames = new Map<string, ScanSystem>();
  for (const system of data.systems)
    for (const name of [system[1], system[2]])
      systemNames.set(normalizeScanName(name), system);
  return { data, types, groups, names, systemNames };
}

export function distanceMetres(raw: string): number | null {
  const value = raw
    .normalize('NFKC')
    .trim()
    .replace(/[\s\u00a0\u202f]/g, '')
    .toLowerCase();
  const match = value.match(/^([\d.,]+)(km|m|au|千米|公里|米|天文单位)$/);
  if (!match) return null;
  let number = match[1];
  // EVE English/Chinese use comma grouping. Also accept an unambiguous decimal comma for AU.
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(number))
    number = number.replace(/,/g, '');
  else if (
    /^\d+,\d{1,2}$/.test(number) &&
    ['au', '天文单位'].includes(match[2])
  )
    number = number.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(number)) return null;
  const factor = ['au', '天文单位'].includes(match[2])
    ? 149_597_870_700
    : ['km', '千米', '公里'].includes(match[2])
      ? 1000
      : 1;
  const metres = Number(number) * factor;
  return Number.isFinite(metres) && metres >= 0 ? metres : null;
}

function lines(raw: string) {
  if (raw.length > SCAN_MAX_INPUT) throw new Error('SCAN_TOO_LARGE');
  const rows = raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^ +| +$/g, ''))
    .filter((line) => line.trim());
  if (rows.length > SCAN_MAX_LINES) throw new Error('SCAN_TOO_MANY_LINES');
  return rows;
}

const headerType = /^(type|ship type|类型|舰船类型|舰船型号|物品类型)$/i;
const headerName = /^(name|名称|名字|对象名称)$/i;
const headerDistance = /^(distance|距离)$/i;

export function parseDirectionalScan(raw: string, index: ScanIndex) {
  const entries: ScanEntry[] = [];
  let ignoredHeaders = 0;
  let header: {
    type: number;
    name: number;
    distance: number;
    id: number;
  } | null = null;
  for (const [lineIndex, original] of lines(raw).entries()) {
    // Tabs are authoritative; multiple spaces are a fallback for plain-text copies.
    const cells = (
      original.includes('\t') ? original.split('\t') : original.split(/ {2,}/)
    ).map((s) => s.trim());
    const typeHeader = cells.findIndex((cell) => headerType.test(cell));
    const nameHeader = cells.findIndex((cell) => headerName.test(cell));
    if (typeHeader >= 0 && nameHeader >= 0) {
      header = {
        type: typeHeader,
        name: nameHeader,
        distance: cells.findIndex((cell) => headerDistance.test(cell)),
        id: cells.findIndex((cell) =>
          /^(type\s*id|id|类型\s*id|物品\s*id)$/i.test(cell),
        ),
      };
      ignoredHeaders++;
      continue;
    }
    let type: ScanType | undefined;
    let name = '',
      typeText = '',
      distance = '';
    let candidates: ScanType[] = [];
    if (header && cells.length >= 2) {
      name = cells[header.name] ?? '';
      typeText = cells[header.type] ?? '';
      distance = cells[header.distance] ?? '';
      if (header.id >= 0) type = index.types.get(Number(cells[header.id]));
      else candidates = index.names.get(normalizeScanName(typeText)) ?? [];
    } else if (cells.length >= 4 && /^\d+$/.test(cells[0])) {
      type = index.types.get(Number(cells[0]));
      name = cells[1];
      typeText = cells[2];
      distance = cells[3];
      // An unknown explicit ID must not be silently replaced with a conflicting name.
      if (!type) {
        entries.push({
          typeId: null,
          name,
          typeText,
          distance,
          metres: distanceMetres(distance),
          issue: 'unknown',
          line: lineIndex + 1,
        });
        continue;
      }
    } else if (cells.length >= 3) {
      name = cells[0];
      typeText = cells[1];
      distance = cells[2];
      candidates = index.names.get(normalizeScanName(typeText)) ?? [];
    } else if (cells.length === 2) {
      name = cells[0];
      typeText = cells[1];
      candidates = index.names.get(normalizeScanName(typeText)) ?? [];
    } else {
      // A single exact hull name is accepted as one object; never fuzzy-match a custom name.
      typeText = original;
      name = original;
      candidates = index.names.get(normalizeScanName(original)) ?? [];
    }
    type ??= candidates.length === 1 ? candidates[0] : undefined;
    entries.push({
      typeId: type?.[0] ?? null,
      name: name.slice(0, 300),
      typeText: typeText.slice(0, 200),
      distance: distance.slice(0, 60),
      metres: distanceMetres(distance),
      ...(type
        ? {}
        : {
            issue:
              candidates.length > 1
                ? ('ambiguous' as const)
                : cells.length === 1
                  ? ('format' as const)
                  : ('unknown' as const),
          }),
      line: lineIndex + 1,
    });
  }
  return { entries, ignoredHeaders };
}

export function parseMemberNames(raw: string) {
  const accepted = new Map<string, string>(),
    rejected: string[] = [];
  let duplicates = 0;
  for (const row of lines(raw)) {
    if (/^(name|pilot|character|名称|角色名称|成员)$/i.test(row)) continue;
    if (
      row.includes('\t') ||
      row.length < 2 ||
      row.length > 100 ||
      /^https?:\/\//i.test(row) ||
      /[<>]/.test(row) ||
      Array.from(row).some((char) => char.charCodeAt(0) < 32)
    ) {
      rejected.push(row);
      continue;
    }
    const key = normalizeScanName(row);
    if (accepted.has(key)) duplicates++;
    else accepted.set(key, row);
  }
  if (accepted.size > SCAN_MAX_MEMBERS)
    throw new Error('SCAN_TOO_MANY_MEMBERS');
  return { names: [...accepted.values()], rejected, duplicates };
}

export function detectScanKind(
  raw: string,
  index: ScanIndex,
): 'dscan' | 'members' {
  const rows = lines(raw);
  if (
    rows.some((line) => line.includes('\t') || line.split(/ {2,}/).length >= 3)
  )
    return 'dscan';
  return rows.length &&
    rows.every((line) => index.names.has(normalizeScanName(line)))
    ? 'dscan'
    : 'members';
}

export function summarizeDirectionalScan(
  entries: ScanEntry[],
  manual: [number, number][],
  index: ScanIndex,
) {
  const counts = new Map<
    number,
    {
      type: ScanType;
      scanned: number;
      manual: number;
      nearest: number | null;
      farthest: number | null;
    }
  >();
  const systems = new Map<number, ScanSystem>();
  for (const entry of entries) {
    const type = entry.typeId ? index.types.get(entry.typeId) : undefined;
    if (!type) continue;
    const current = counts.get(type[0]) ?? {
      type,
      scanned: 0,
      manual: 0,
      nearest: null,
      farthest: null,
    };
    current.scanned++;
    if (entry.metres !== null) {
      current.nearest =
        current.nearest === null
          ? entry.metres
          : Math.min(current.nearest, entry.metres);
      current.farthest = Math.max(current.farthest ?? 0, entry.metres);
    }
    counts.set(type[0], current);
    // Only fixed celestial/station names can supply a location clue. Never use a gate destination, ship or player structure name.
    if ([6, 7, 8, 9, 15].includes(type[3])) {
      const words = normalizeScanName(entry.name).split(' ');
      for (let n = Math.min(words.length, 6); n >= 1; n--) {
        const found = index.systemNames.get(words.slice(0, n).join(' '));
        if (found) {
          systems.set(found[0], found);
          break;
        }
      }
    }
  }
  for (const [id, quantity] of manual) {
    const type = index.types.get(id);
    if (
      !type ||
      index.groups.get(type[3])?.[3] !== 6 ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 10000
    )
      continue;
    const current = counts.get(id) ?? {
      type,
      scanned: 0,
      manual: 0,
      nearest: null,
      farthest: null,
    };
    current.manual += quantity;
    counts.set(id, current);
  }
  const types = [...counts.values()].sort(
    (a, b) =>
      b.scanned + b.manual - a.scanned - a.manual || a.type[0] - b.type[0],
  );
  const ships = types.filter((row) => index.groups.get(row.type[3])?.[3] === 6);
  const classes = new Map<number, { group: ScanGroup; count: number }>();
  for (const row of ships) {
    const group = index.groups.get(row.type[3])!;
    const current = classes.get(group[0]) ?? { group, count: 0 };
    current.count += row.scanned + row.manual;
    classes.set(group[0], current);
  }
  return {
    types,
    ships,
    classes: [...classes.values()].sort((a, b) => b.count - a.count),
    systems: [...systems.values()],
    unknown: entries.filter((r) => r.typeId === null),
    shipCount: ships.reduce((sum, r) => sum + r.scanned + r.manual, 0),
    manualCount: ships.reduce((sum, r) => sum + r.manual, 0),
    mass: ships.reduce(
      (sum, r) => sum + (r.type[4] ?? 0) * (r.scanned + r.manual),
      0,
    ),
    missingMass: ships.some((r) => r.type[4] === null),
  };
}

function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}
function validId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 2_147_483_647
  );
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    !Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(char),
    )
  );
}

export function validateScanSnapshot(raw: unknown): ScanSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    r.v !== 1 ||
    (r.kind !== 'dscan' && r.kind !== 'members') ||
    !text(r.raw, SCAN_MAX_INPUT) ||
    !r.raw.trim() ||
    !text(r.title, 120) ||
    !validDate(r.analyzedAt) ||
    !Array.isArray(r.manual) ||
    r.manual.length > 100 ||
    !Array.isArray(r.members) ||
    r.members.length > SCAN_MAX_MEMBERS ||
    typeof r.example !== 'boolean'
  )
    return null;
  try {
    lines(r.raw);
    if (r.kind === 'members') parseMemberNames(r.raw);
  } catch {
    return null;
  }
  const manual: [number, number][] = [];
  for (const pair of r.manual) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !validId(pair[0]) ||
      !Number.isInteger(pair[1]) ||
      pair[1] < 1 ||
      pair[1] > 10000
    )
      return null;
    if (manual.some(([id]) => id === pair[0])) return null;
    manual.push([pair[0], pair[1]]);
  }
  const members: ScanMember[] = [];
  const expectedNames =
    r.kind === 'members'
      ? new Set(parseMemberNames(r.raw as string).names.map(normalizeScanName))
      : new Set<string>();
  const memberNames = new Set<string>();
  for (const member of r.members) {
    if (
      !member ||
      !text(member.name, 100) ||
      !member.name.trim() ||
      !validDate(member.checkedAt) ||
      !['resolved', 'not-found', 'unavailable'].includes(member.status)
    )
      return null;
    for (const key of ['id', 'corporationId', 'allianceId'])
      if (member[key] !== null && !validId(member[key])) return null;
    for (const key of ['corporation', 'alliance'])
      if (member[key] !== null && !text(member[key], 200)) return null;
    if (member.status === 'resolved' && (!member.id || !member.corporationId))
      return null;
    const normalized = normalizeScanName(member.name);
    if (!expectedNames.has(normalized) || memberNames.has(normalized))
      return null;
    if (
      member.status === 'not-found' &&
      (member.id !== null ||
        member.corporationId !== null ||
        member.allianceId !== null)
    )
      return null;
    memberNames.add(normalized);
    members.push({
      name: member.name,
      id: member.id,
      corporationId: member.corporationId,
      corporation: member.corporation,
      allianceId: member.allianceId,
      alliance: member.alliance,
      status: member.status,
      checkedAt: member.checkedAt,
    });
  }
  if (
    r.kind === 'members' &&
    (!expectedNames.size || expectedNames.size !== members.length)
  )
    return null;
  if (
    (r.kind === 'dscan' && members.length) ||
    (r.kind === 'members' && manual.length)
  )
    return null;
  return {
    v: 1,
    kind: r.kind,
    title: r.title,
    raw: r.raw,
    analyzedAt: r.analyzedAt,
    manual,
    members,
    example: r.example,
  };
}
