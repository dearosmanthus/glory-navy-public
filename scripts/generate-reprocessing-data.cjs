/* oxlint-disable typescript/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const root = path.resolve(__dirname, '..');
const source = path.join(root, '.sde-tmp');
const output = path.join(root, 'public', 'reprocessing-data.json');
const MOON_GROUPS = new Set([1884, 1920, 1921, 1922, 1923]);
const MOON_SKILLS = new Map([
  [1884, 46152],
  [1920, 46153],
  [1921, 46154],
  [1922, 46155],
  [1923, 46156],
]);

async function readRows(name) {
  const result = [];
  const input = fs.createReadStream(path.join(source, name), 'utf8');
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (line) result.push(JSON.parse(line));
  }
  return result;
}

function localName(row, fallback) {
  const en = row?.name?.en ?? fallback;
  return [row?.name?.zh ?? en, en];
}

async function main() {
  const [typeRows, groupRows, materialRows, dogmaRows] = await Promise.all([
    readRows('types.jsonl'),
    readRows('groups.jsonl'),
    readRows('typeMaterials.jsonl'),
    readRows('typeDogma.jsonl'),
  ]);
  const groups = new Map(groupRows.map((row) => [row._key, row]));
  const allTypes = new Map(typeRows.map((row) => [row._key, row]));
  const materials = new Map(materialRows.filter((row) => row.materials?.length).map((row) => [row._key, row.materials.map((item) => [item.materialTypeID, item.quantity])]));
  const skillByType = new Map();
  for (const row of dogmaRows) {
    const skill = row.dogmaAttributes?.find((attribute) => attribute.attributeID === 790)?.value;
    if (skill) skillByType.set(row._key, skill);
  }

  const inputs = [];
  const referenced = new Set();
  const groupIds = new Set();
  const skillIds = new Set([3385, 3389, 12196, 18025, ...MOON_SKILLS.values()]);
  for (const [typeId, recipe] of materials) {
    const row = allTypes.get(typeId);
    if (!row?.published || !row.name?.en) continue;
    const group = groups.get(row.groupID);
    const categoryId = group?.categoryID ?? 0;
    let kind = 'equipment';
    let skillId = 12196;
    if (categoryId === 25) {
      kind = row.groupID === 465 ? 'ice' : MOON_GROUPS.has(row.groupID) ? 'moon' : 'ore';
      skillId = skillByType.get(typeId) ?? (kind === 'ice' ? 18025 : MOON_SKILLS.get(row.groupID) ?? 60377);
    }
    const [zh, en] = localName(row, `Type ${typeId}`);
    inputs.push([
      typeId,
      zh,
      en,
      row.packagedVolume ?? row.volume ?? 0,
      row.portionSize || 1,
      kind,
      row.groupID ?? 0,
      skillId,
      recipe,
    ]);
    groupIds.add(row.groupID ?? 0);
    skillIds.add(skillId);
    for (const [materialId] of recipe) referenced.add(materialId);
  }

  const compactTypes = inputs.slice();
  const inputIds = new Set(inputs.map((row) => row[0]));
  for (const typeId of referenced) {
    if (inputIds.has(typeId)) continue;
    const row = allTypes.get(typeId);
    const [zh, en] = localName(row, `Type ${typeId}`);
    compactTypes.push([typeId, zh, en, row?.packagedVolume ?? row?.volume ?? 0, row?.portionSize || 1, 'material', row?.groupID ?? 0, 0, null]);
  }

  const compactGroups = Array.from(groupIds).sort((a, b) => a - b).map((groupId) => {
    const group = groups.get(groupId);
    const [zh, en] = localName(group, `Group ${groupId}`);
    return [groupId, zh, en];
  });
  const compactSkills = Array.from(skillIds).sort((a, b) => a - b).map((typeId) => {
    const [zh, en] = localName(allTypes.get(typeId), `Skill ${typeId}`);
    return [typeId, zh, en];
  });
  const sde = JSON.parse(fs.readFileSync(path.join(source, '_sde.jsonl'), 'utf8')).buildNumber;
  const payload = {
    schema: 1,
    source: 'CCP EVE Online Static Data Export',
    sde,
    types: compactTypes,
    groups: compactGroups,
    skills: compactSkills,
  };
  fs.writeFileSync(output, JSON.stringify(payload));
  const counts = inputs.reduce((map, row) => ({ ...map, [row[5]]: (map[row[5]] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ output, sde, inputs: inputs.length, outputs: referenced.size, skills: compactSkills.length, counts, bytes: fs.statSync(output).size }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
