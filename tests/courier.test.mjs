import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCourierQuote } from '../lib/courier.ts';

const route = {
  id: 1,
  start: 'Jita',
  end: '1DH-SX',
  cost_per_m3: 600,
  collateral_percentage: 1,
  transport_type: 'JF full max',
  transport_volume: 375_000,
  paused: 0,
  expiration: 14,
  completion: 7,
  minimum_cost: 10_000_000,
};

test('courier quote matches the HA Logistics volume and collateral formula', () => {
  const quote = calculateCourierQuote(route, { volume: 20_000, collateral: 1_000_000_000 });
  assert.equal(quote.volumeCost, 12_000_000);
  assert.equal(quote.collateralFee, 10_000_000);
  assert.equal(quote.totalCost, 22_000_000);
  assert.equal(quote.minimumApplied, false);
});

test('courier quote applies the route minimum and includes additional cargo', () => {
  const quote = calculateCourierQuote(route, {
    volume: 10,
    collateral: 1_000,
    additionalVolume: 20,
    additionalCollateral: 2_000,
  });
  assert.equal(quote.totalVolume, 30);
  assert.equal(quote.totalCollateral, 3_000);
  assert.equal(quote.totalCost, 10_000_000);
  assert.equal(quote.minimumApplied, true);
});

test('courier quote flags cargo over route capacity and sanitizes invalid inputs', () => {
  const quote = calculateCourierQuote(route, {
    volume: 400_000,
    collateral: Number.NaN,
    additionalVolume: -50,
    additionalCollateral: -1,
  });
  assert.equal(quote.totalCollateral, 0);
  assert.equal(quote.totalVolume, 400_000);
  assert.equal(quote.volumeExceedsCapacity, true);
});
