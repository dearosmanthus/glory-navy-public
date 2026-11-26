import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createScanIndex, distanceMetres, parseDirectionalScan, parseMemberNames, detectScanKind, summarizeDirectionalScan, validateScanSnapshot, SCAN_MAX_INPUT } from '../lib/battle-scan.ts';

// Match the app bundler's extensionless TypeScript imports in Node's test runner.
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('./') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
    throw error;
  }
} });
const { resolveScanMembers } = await import('../lib/scan-affiliations.ts');
const data = JSON.parse(readFileSync(new URL('../public/scan-data.json', import.meta.url), 'utf8'));
const index = createScanIndex(data);
const hull = (en) => data.types.find((row) => row[2] === en);
const row = (en, name = 'custom ship', distance = '-') => `${hull(en)[0]}\t${name}\t${en}\t${distance}`;
const parse = (raw) => parseDirectionalScan(raw, index);
const snapshot = (patch = {}) => ({ v: 1, kind: 'dscan', title: '', raw: row('Caracal'), analyzedAt: '2026-09-08T10:00:00.000Z', manual: [], members: [], example: false, ...patch });
const member = (patch = {}) => ({ name: 'Chribba', id: 95538921, corporationId: 98134807, corporation: 'Holding', allianceId: null, alliance: null, status: 'resolved', checkedAt: '2026-09-08T10:00:00.000Z', ...patch });

test('current CCP catalog includes bilingual hulls, probes and unpublished structures', () => {
  assert.equal(data.sde, 3494416);
  for (const id of [626, 11134, 35834, 2233, 4318, 45006, 78260, 79172]) assert.ok(index.types.has(id), `missing ${id}`);
  assert.ok(data.types.some((r) => index.groups.get(r[3])?.[3] === 6 && r[4] > 0));
  assert.ok(data.types.some((r) => r[3] === 479));
  assert.ok(data.systems.some((r) => r[2] === 'Jita'));
});

test('game clipboard IDs identify hulls despite misleading custom names', () => {
  const raw = '626\tDelovar Vexor\tVexor\t-\n11134\tForce Field\tAmarr Shuttle\t1,234 m';
  const result = parse(raw).entries;
  assert.deepEqual(result.map((r) => r.typeId), [626, 11134]);
  assert.equal(result[1].metres, 1234);
});

test('repeated ship names count as separate observed objects', () => {
  const result = parse([row('Caracal', 'same', '10 km'), row('Caracal', 'same', '2 AU')].join('\r\n'));
  const summary = summarizeDirectionalScan(result.entries, [], index);
  assert.equal(summary.shipCount, 2);
  assert.equal(summary.ships[0].nearest, 10000);
  assert.equal(summary.ships[0].farthest, distanceMetres('2 AU'));
});

test('English and Chinese type columns work without IDs and with reordered headers', () => {
  const type = hull('Caracal');
  assert.equal(parse(`自定义名\t${type[1]}\t12 千米`).entries[0].typeId, type[0]);
  const result = parse(`距离\t类型\t名称\n4 公里\t${type[1]}\t自定义名`);
  assert.equal(result.ignoredHeaders, 1);
  assert.equal(result.entries[0].typeId, type[0]);
  assert.equal(result.entries[0].metres, 4000);
  assert.equal(parse('sample  Caracal  20 km').entries[0].typeId, type[0]);
  assert.equal(parse(`\t${type[1]}\t12 千米`).entries[0].typeId, type[0]);
});

test('same Chinese name stays ambiguous without ID, ID wins including with headers', () => {
  assert.equal(parse('sample\t救赎级\t-').entries[0].issue, 'ambiguous');
  assert.equal(parse('22448\tsample\t救赎级\t-').entries[0].typeId, 22448);
  assert.equal(parse('Type ID\tName\tType\tDistance\n92822\tsample\t救赎级\t-').entries[0].typeId, 92822);
  assert.equal(parse('Type ID\tName\tType\tDistance\n2000000000\tsample\tCaracal\t-').entries[0].typeId, null);
});

test('unknown IDs/types are retained and never guessed from a custom ship name', () => {
  const result = parse('2000000000\tCaracal\tCaracal\t-\nCaracal\tUnknown Hull\t4 km');
  assert.equal(result.entries.length, 2);
  assert.ok(result.entries.every((r) => r.typeId === null));
  assert.equal(summarizeDirectionalScan(result.entries, [], index).shipCount, 0);
});

test('distance parsing distinguishes zero/unknown, AU, Chinese and separators', () => {
  for (const [raw, expected] of [['0 m', 0], ['1,234 km', 1234000], ['12.5 公里', 12500], ['１．５ AU', 224396806050], ['1,5 AU', 224396806050], ['1\u202f200 m', 1200], ['-', null], ['-3 km', null], ['1,2 km', null], ['NaN AU', null]]) assert.equal(distanceMetres(raw), expected, raw);
});

test('only fixed celestial or station names supply system clues', () => {
  const moon = row('Moon', 'Jita IV - Moon 4');
  assert.equal(summarizeDirectionalScan(parse(moon).entries, [], index).systems[0][2], 'Jita');
  const custom = [row('Caracal', 'Jita IV - Moon 4'), row('Astrahus', 'Jita IV - Moon 4')].join('\n');
  assert.equal(summarizeDirectionalScan(parse(custom).entries, [], index).systems.length, 0);
  const gate = data.types.find((t) => t[3] === 10);
  if (gate) assert.equal(summarizeDirectionalScan(parse(`${gate[0]}\tJita\t${gate[2]}\t1 AU`).entries, [], index).systems.length, 0);
});

test('manual additions remain distinct and structures do not inflate ship totals/mass', () => {
  const caracal = hull('Caracal'), astrahus = hull('Astrahus');
  const result = summarizeDirectionalScan(parse([row('Caracal'), row('Astrahus')].join('\n')).entries, [[caracal[0], 3], [astrahus[0], 99]], index);
  assert.equal(result.shipCount, 4);
  assert.equal(result.manualCount, 3);
  assert.equal(result.mass, caracal[4] * 4);
  assert.equal(result.ships[0].scanned, 1);
  assert.equal(result.ships[0].manual, 3);
  assert.equal(result.types.length, 2);
});

test('member lists normalize duplicate names and report invalid rows', () => {
  const result = parseMemberNames('Name\r\nChribba\r\nCHRIBBA\n  CCP Explorer  \nhttps://example.com\nship\ttype\n<x>');
  assert.deepEqual(result.names, ['Chribba', 'CCP Explorer']);
  assert.equal(result.duplicates, 1);
  assert.equal(result.rejected.length, 3);
  assert.equal(detectScanKind('CCP  Explorer\nChribba', index), 'members');
  assert.equal(detectScanKind(row('Caracal'), index), 'dscan');
  assert.equal(detectScanKind('Caracal\nRifter', index), 'dscan');
});

test('limits fail explicitly instead of silently truncating', () => {
  assert.throws(() => parse('x'.repeat(SCAN_MAX_INPUT + 1)), /SCAN_TOO_LARGE/);
  assert.throws(() => parse(Array(5001).fill('Caracal').join('\n')), /SCAN_TOO_MANY_LINES/);
  assert.throws(() => parseMemberNames(Array.from({ length: 3001 }, (_, i) => `Pilot ${i}`).join('\n')), /SCAN_TOO_MANY_MEMBERS/);
});

test('share snapshots round-trip data and reject malformed or contradictory records', () => {
  const original = snapshot({ manual: [[hull('Caracal')[0], 2]], title: '<not executable>' });
  assert.deepEqual(validateScanSnapshot(JSON.parse(JSON.stringify(original))), original);
  for (const patch of [{ v: 2 }, { raw: '' }, { analyzedAt: 'yesterday' }, { manual: [[1, -1]] }, { manual: [[1, 1], [1, 2]] }, { raw: 'a\x00b' }, { members: [member()] }]) assert.equal(validateScanSnapshot(snapshot(patch)), null);
  const saved = snapshot({ kind: 'members', raw: 'Chribba', members: [member()] });
  assert.deepEqual(validateScanSnapshot(saved), saved);
  for (const members of [[], [member(), member()], [member({ name: 'Someone Else' })], [member({ corporationId: null })], [member({ status: 'not-found' })]]) assert.equal(validateScanSnapshot({ ...saved, members }), null);
});

test('public member lookup resolves characters only and batches organization IDs', async () => {
  const calls = [];
  const mock = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.includes('/universe/ids/')) return Response.json({ characters: [{ id: 101, name: 'Pilot A' }, { id: 102, name: 'Pilot B' }], corporations: [{ id: 999, name: 'Corp Only' }] });
    if (url.includes('/characters/affiliation/')) return Response.json([{ character_id: 101, corporation_id: 201, alliance_id: 301 }, { character_id: 102, corporation_id: 201 }]);
    return Response.json([{ id: 201, name: 'A Corporation' }, { id: 301, name: 'An Alliance' }]);
  };
  const result = await resolveScanMembers(['pilot a', 'Pilot B', 'Corp Only'], mock);
  assert.deepEqual(result.map((r) => r.status), ['resolved', 'resolved', 'not-found']);
  assert.equal(result[0].alliance, 'An Alliance');
  assert.equal(result[1].allianceId, null);
  assert.deepEqual(calls[2].body, [201, 301]);
  assert.ok(calls.every((r) => r.url.startsWith('https://esi.evetech.net/')));
});

test('missing affiliations remain unavailable and upstream errors are not invented identities', async () => {
  let calls = 0;
  const result = await resolveScanMembers(['Pilot A'], async () => Response.json(++calls === 1 ? { characters: [{ id: 101, name: 'Pilot A' }] } : []));
  assert.equal(result[0].status, 'unavailable');
  assert.equal(result[0].corporationId, null);
  assert.equal((await resolveScanMembers(['Missing Pilot'], async () => Response.json({})))[0].status, 'not-found');
  await assert.rejects(() => resolveScanMembers(['Pilot A'], async () => new Response('', { status: 503 })), /ESI_503/);
});

test('browser request helper preserves expired-link, size and rate-limit errors', async () => {
  const { scanFetch } = await import('../lib/scan-fetch.ts');
  const original = globalThis.fetch;
  try {
    for (const [status, code] of [[404, 'SCAN_NOT_FOUND'], [413, 'BODY_TOO_LARGE'], [429, 'RATE_LIMIT']]) {
      globalThis.fetch = async () => Response.json({ error: code }, { status });
      await assert.rejects(() => scanFetch('/api/scans/test'), new RegExp(code));
    }
    globalThis.fetch = async () => Response.json({ code: 'saved' });
    assert.deepEqual(await scanFetch('/api/scans'), { code: 'saved' });
  } finally { globalThis.fetch = original; }
});
