import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('./') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
    throw error;
  }
} });
const { emptyAttendanceStore, groupAttendanceCorporations, mostRecentAttendanceCorporation, recordAttendance, validateAttendanceStore } = await import('../lib/attendance.ts');

const member = (patch = {}) => ({
  name: 'Pilot A', id: 101, corporationId: 201, corporation: 'Fleet Corp',
  allianceId: 301, alliance: 'Fleet Alliance', status: 'resolved',
  checkedAt: '2026-09-11T01:00:00.000Z', ...patch,
});

test('corporation summary groups resolved characters and sorts by member count', () => {
  const groups = groupAttendanceCorporations([
    member(),
    member({ name: 'Pilot B', id: 102 }),
    member({ name: 'Pilot C', id: 103, corporationId: 202, corporation: 'Other Corp' }),
    member({ name: 'Missing', id: null, corporationId: null, corporation: null, status: 'not-found' }),
    member(),
  ]);
  assert.deepEqual(groups.map((group) => [group.corporation, group.members.length]), [['Fleet Corp', 2], ['Other Corp', 1]]);
});

test('recording sessions increments each selected corporation member once', () => {
  const firstGroup = groupAttendanceCorporations([member(), member(), member({ name: 'Pilot B', id: 102 })])[0];
  const first = recordAttendance(emptyAttendanceStore(), firstGroup, '2026-09-11T01:00:00.000Z');
  assert.equal(first.corporations['201'].sessions, 1);
  assert.deepEqual(first.corporations['201'].attendanceSessions[0].memberIds, [101, 102]);
  assert.equal(first.corporations['201'].members.length, 2);
  assert.ok(first.corporations['201'].members.every((item) => item.attendanceCount === 1));

  const secondGroup = groupAttendanceCorporations([member({ name: 'Pilot A Renamed' })])[0];
  const second = recordAttendance(first, secondGroup, '2026-09-11T02:00:00.000Z');
  assert.equal(second.corporations['201'].sessions, 2);
  assert.equal(second.corporations['201'].attendanceSessions.length, 2);
  assert.deepEqual(second.corporations['201'].attendanceSessions[0].memberIds, [101]);
  assert.equal(second.corporations['201'].members.find((item) => item.characterId === 101).attendanceCount, 2);
  assert.equal(second.corporations['201'].members.find((item) => item.characterId === 101).name, 'Pilot A Renamed');
  assert.equal(second.corporations['201'].members.find((item) => item.characterId === 102).attendanceCount, 1);
});

test('stored attendance validates exact corporation keys and rejects corrupt records', () => {
  const saved = recordAttendance(emptyAttendanceStore(), groupAttendanceCorporations([member()])[0], '2026-09-11T01:00:00.000Z');
  assert.deepEqual(validateAttendanceStore(JSON.parse(JSON.stringify(saved))), saved);
  assert.equal(validateAttendanceStore({ ...saved, v: 2 }), null);
  assert.equal(validateAttendanceStore({ v: 1, corporations: { wrong: saved.corporations['201'] } }), null);
  assert.equal(validateAttendanceStore({ v: 1, corporations: { 201: { ...saved.corporations['201'], sessions: 0 } } }), null);
  assert.equal(validateAttendanceStore({ v: 1, corporations: { 201: { ...saved.corporations['201'], attendanceSessions: [{ ...saved.corporations['201'].attendanceSessions[0], memberIds: [101, 101] }] } } }), null);
  assert.equal(validateAttendanceStore({ v: 1, corporations: { 201: { ...saved.corporations['201'], attendanceSessions: [{ ...saved.corporations['201'].attendanceSessions[0], memberIds: [999] }] } } }), null);
});

test('reload restores the corporation with the latest saved attendance', () => {
  const first = recordAttendance(emptyAttendanceStore(), groupAttendanceCorporations([member()])[0], '2026-09-11T01:00:00.000Z');
  const secondGroup = groupAttendanceCorporations([member({ id: 103, corporationId: 202, corporation: 'Latest Corp' })])[0];
  const saved = recordAttendance(first, secondGroup, '2026-09-11T03:00:00.000Z');
  assert.equal(mostRecentAttendanceCorporation(saved)?.corporationId, 202);
  assert.equal(mostRecentAttendanceCorporation(emptyAttendanceStore()), null);
});
