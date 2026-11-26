import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';

const source = path.resolve(process.argv[2] ?? '.sde-tmp');
async function records(file, callback) {
  for await (const line of readline.createInterface({ input: fs.createReadStream(path.join(source, file), 'utf8'), crlfDelay: Infinity })) {
    if (line.trim()) callback(JSON.parse(line));
  }
}
const categories = new Map(), groups = new Map();
const categoryIds = new Set([2, 3, 6, 18, 22, 23, 25, 40, 46, 65, 87]);
const probeGroups = new Set([479, 492, 548, 4088]);
const names = (r) => [r.name.zh ?? r.name.en, r.name.en];
await records('categories.jsonl', (r) => categories.set(r._key, [r._key, ...names(r)]));
await records('groups.jsonl', (r) => {
  if (categoryIds.has(r.categoryID) || probeGroups.has(r._key)) groups.set(r._key, [r._key, ...names(r), r.categoryID]);
});
const types = [], systems = [], regions = [], metadata = {};
await records('types.jsonl', (r) => {
  if (groups.has(r.groupID) && r.name.en) types.push([r._key, ...names(r), r.groupID, Number.isFinite(r.mass) && r.mass > 0 ? r.mass : null]);
});
await records('mapSolarSystems.jsonl', (r) => systems.push([r._key, ...names(r), r.regionID, r.securityStatus]));
await records('mapRegions.jsonl', (r) => regions.push([r._key, ...names(r)]));
await records('_sde.jsonl', (r) => { if (r._key === 'sde') Object.assign(metadata, r); });
const usedGroups = new Set(types.map((r) => r[3]));
const chosenGroups = [...groups.values()].filter((r) => usedGroups.has(r[0]));
const usedCategories = new Set(chosenGroups.map((r) => r[3]));
const inputs = {};
for (const file of ['types.jsonl', 'groups.jsonl', 'categories.jsonl', 'mapSolarSystems.jsonl', 'mapRegions.jsonl', '_sde.jsonl']) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(path.join(source, file))) hash.update(chunk);
  inputs[file] = hash.digest('hex');
}
const result = { schema: 1, source: 'CCP EVE Online Static Data Export', sde: metadata.buildNumber, released: metadata.releaseDate, types, groups: chosenGroups, categories: [...categories.values()].filter((r) => usedCategories.has(r[0])), systems, regions };
fs.writeFileSync('public/scan-data.json', JSON.stringify(result));
fs.writeFileSync('data/scan-data-provenance.json', JSON.stringify({ source: result.source, url: 'https://developers.eveonline.com/static-data', sde: result.sde, released: result.released, inputs, outputSha256: createHash('sha256').update(JSON.stringify(result)).digest('hex') }, null, 2) + '\n');
console.log(JSON.stringify({ types: types.length, groups: chosenGroups.length, systems: systems.length, bytes: fs.statSync('public/scan-data.json').size }));
