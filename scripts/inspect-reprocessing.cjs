/* oxlint-disable typescript/no-require-imports */
const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '.sde-tmp');

async function rows(name, accept = () => true) {
  const result = [];
  const input = fs.createReadStream(path.join(root, name), 'utf8');
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    const value = JSON.parse(line);
    if (accept(value)) result.push(value);
  }
  return result;
}

async function main() {
  const names = /reprocess|refin|processing|grading|athanor|tatara|scrapmetal/i;
  const types = await rows('types.jsonl', (row) => names.test(row.name?.en ?? ''));
  console.log('TYPES');
  for (const row of types) console.log(JSON.stringify({ id: row._key, name: row.name?.en, zh: row.name?.zh, group: row.groupID, market: row.marketGroupID, portion: row.portionSize }));

  const wantedIds = new Set(types.map((row) => row._key));
  const dogma = await rows('typeDogma.jsonl', (row) => wantedIds.has(row._key));
  const attributeIds = new Set(dogma.flatMap((row) => (row.dogmaAttributes ?? []).map((entry) => entry.attributeID)));
  const effectIds = new Set(dogma.flatMap((row) => (row.dogmaEffects ?? []).map((entry) => typeof entry === 'number' ? entry : entry.effectID)));
  const attributes = await rows('dogmaAttributes.jsonl', (row) => attributeIds.has(row._key));
  const effects = await rows('dogmaEffects.jsonl', (row) => effectIds.has(row._key));
  const attributeNames = new Map(attributes.map((row) => [row._key, row.name]));
  const effectNames = new Map(effects.map((row) => [row._key, row.name]));
  console.log('DOGMA');
  for (const row of dogma) {
    const type = types.find((item) => item._key === row._key);
    console.log(JSON.stringify({
      id: row._key,
      name: type?.name?.en,
      attributes: (row.dogmaAttributes ?? []).map((entry) => [entry.attributeID, attributeNames.get(entry.attributeID), entry.value]),
      effects: (row.dogmaEffects ?? []).map((entry) => {
        const id = typeof entry === 'number' ? entry : entry.effectID;
        return [id, effectNames.get(id)];
      }),
    }));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
