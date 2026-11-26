import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  calculateJumpRange,
  displaySecurity,
  isJumpNavigatorData,
} from '../lib/jump-navigator.ts';

const ship = (jumpFreighter) => [
  jumpFreighter ? 1 : 2,
  jumpFreighter ? '战略货舰' : '无畏舰',
  jumpFreighter ? 'Jump Freighter' : 'Dreadnought',
  jumpFreighter ? '战略货舰' : '无畏舰',
  jumpFreighter ? 'Jump Freighter' : 'Dreadnought',
  'A',
  5,
  1000,
  16274,
  '氦同位素',
  'Helium Isotopes',
  jumpFreighter,
];

const system = (id, name, security, x, y, z) => [id, name, name, '测试星域', 'Test Region', security, x, y, z];
const fixture = {
  schema: 1,
  source: 'test',
  sde: 1,
  released: '2026-09-09T00:00:00Z',
  lightYearMeters: 9_460_730_472_580_800,
  ships: [ship(true), ship(false)],
  systems: [
    system(10, 'Origin', 0.1, 0, 0, 0),
    system(11, 'Reachable', 0.44, 3, 4, 0),
    system(12, 'High sec', 0.45, 1, 0, 0),
    system(13, 'Too far', -0.5, 6, 0, 0),
  ],
};

test('jump range and fuel apply JDC, JFC and jump-freighter modifiers', () => {
  const result = calculateJumpRange(fixture, {
    shipTypeId: 1,
    startSystemId: 10,
    jumpDriveCalibration: 0,
    jumpFuelConservation: 4,
    jumpFreighters: 4,
  });
  assert.equal(result.jumpRangeLy, 5);
  assert.deepEqual(result.systems.map((entry) => entry.id), [11]);
  assert.equal(result.systems[0].distanceLy, 5);
  assert.equal(result.systems[0].fuel, 1800);

  const capital = calculateJumpRange(fixture, {
    shipTypeId: 2,
    startSystemId: 10,
    jumpDriveCalibration: 0,
    jumpFuelConservation: 4,
    jumpFreighters: 0,
  });
  assert.equal(capital.systems[0].fuel, 3000);
});

test('security display follows the in-game high-sec boundary', () => {
  assert.equal(displaySecurity(0.449), 0.4);
  assert.equal(displaySecurity(0.45), 0.5);
  assert.equal(displaySecurity(0.01), 0.1);
  assert.equal(displaySecurity(-0.04), 0);
});

test('generated Tranquility SDE data reproduces known distance and fuel', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/jump-data.json', import.meta.url), 'utf8'));
  assert.equal(isJumpNavigatorData(data), true);
  assert.equal(data.sde, 3500372);
  assert.equal(data.ships.length, 56);
  assert.equal(data.systems.length, 5404);
  assert.equal(data.ships.some((entry) => entry[0] === 75993), false);
  assert.equal(data.systems.some((entry) => ['波赫温', '扎尔扎克'].includes(entry[3])), false);

  const result = calculateJumpRange(data, {
    shipTypeId: 28850,
    startSystemId: 30002537,
    jumpDriveCalibration: 4,
    jumpFuelConservation: 4,
    jumpFreighters: 4,
  });
  const gerper = result.systems.find((entry) => entry.id === 30003023);
  assert.equal(result.jumpRangeLy, 9);
  assert.equal(result.systems.length, 130);
  assert.equal(gerper.distanceLy, 6.31);
  assert.equal(gerper.fuel, 19981.35);
});
