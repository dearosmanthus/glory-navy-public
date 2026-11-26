import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const LIGHT_YEAR_METERS = 9_460_730_472_580_800;
const SDE_SOURCE = 'https://developers.eveonline.com/static-data';
const sourceDirectory = path.resolve(process.argv[2] ?? '.sde-tmp');
const output = path.resolve('public/jump-data.json');
const provenanceOutput = path.resolve('data/jump-data-provenance.json');
const excludedRegionIds = new Set([10000070, 10001000, 10001004]);

async function records(filename, callback) {
  const input = fs.createReadStream(path.join(sourceDirectory, filename), 'utf8');
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (line.trim()) callback(JSON.parse(line));
  }
}

const groups = new Map();
await records('groups.jsonl', (row) => {
  if (row.categoryID === 6) groups.set(row._key, row);
});

const dogma = new Map();
await records('typeDogma.jsonl', (row) => {
  const attributes = Object.fromEntries(row.dogmaAttributes.map((attribute) => [attribute.attributeID, attribute.value]));
  if (attributes[861] && attributes[866] && attributes[867] && attributes[868] && !attributes[2453]) dogma.set(row._key, attributes);
});

const fuelIds = new Set([...dogma.values()].map((attributes) => attributes[866]));
const wantedTypes = new Set([...dogma.keys(), ...fuelIds]);
const types = new Map();
await records('types.jsonl', (row) => {
  if (wantedTypes.has(row._key)) types.set(row._key, row);
});

const regions = new Map();
await records('mapRegions.jsonl', (row) => regions.set(row._key, row));

const systems = [];
await records('mapSolarSystems.jsonl', (row) => {
  if (row._key < 30_000_000 || row._key > 30_999_999 || excludedRegionIds.has(row.regionID)) return;
  const region = regions.get(row.regionID);
  if (!region || !row.name?.en || !row.position) throw new Error(`Incomplete map data for system ${row._key}`);
  systems.push([
    row._key,
    row.name.zh ?? row.name.en,
    row.name.en,
    region.name.zh ?? region.name.en,
    region.name.en,
    row.securityStatus,
    Number((row.position.x / LIGHT_YEAR_METERS).toFixed(10)),
    Number((row.position.y / LIGHT_YEAR_METERS).toFixed(10)),
    Number((row.position.z / LIGHT_YEAR_METERS).toFixed(10)),
  ]);
});
systems.sort((left, right) => left[0] - right[0]);
if (systems.length < 5_000) throw new Error(`Expected at least 5,000 jump systems, received ${systems.length}`);

const raceByFuelType = new Map([[16274, 'A'], [17888, 'C'], [17887, 'G'], [17889, 'M']]);
const ships = [...dogma.entries()].flatMap(([id, attributes]) => {
  const item = types.get(id);
  const group = item ? groups.get(item.groupID) : undefined;
  if (!item?.published || !group) return [];
  const fuel = types.get(attributes[866]);
  if (!fuel) throw new Error(`Fuel type ${attributes[866]} is missing for type ${id}`);
  return [[
    id,
    item.name.zh ?? item.name.en,
    item.name.en,
    group.name.zh ?? group.name.en,
    group.name.en,
    raceByFuelType.get(attributes[866]) ?? '',
    attributes[867],
    attributes[868],
    attributes[866],
    fuel.name.zh ?? fuel.name.en,
    fuel.name.en,
    item.groupID === 902,
  ]];
}).sort((left, right) => left[3].localeCompare(right[3], 'en') || left[2].localeCompare(right[2], 'en'));
if (ships.length < 25) throw new Error(`Expected at least 25 jump-capable ships, received ${ships.length}`);

const metadata = JSON.parse(fs.readFileSync(path.join(sourceDirectory, '_sde.jsonl'), 'utf8'));
const payload = {
  schema: 1,
  source: 'CCP EVE Online Static Data Export',
  sde: metadata.buildNumber,
  released: metadata.releaseDate,
  lightYearMeters: LIGHT_YEAR_METERS,
  ships,
  systems,
};
const serialized = JSON.stringify(payload);
fs.writeFileSync(output, serialized);

const provenance = {
  source: payload.source,
  sde: payload.sde,
  released: payload.released,
  sources: { sde: SDE_SOURCE },
  systemCount: systems.length,
  shipCount: ships.length,
  outputSha256: createHash('sha256').update(serialized).digest('hex'),
};
fs.writeFileSync(provenanceOutput, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(JSON.stringify({ sde: payload.sde, systems: systems.length, ships: ships.length, bytes: fs.statSync(output).size }));
