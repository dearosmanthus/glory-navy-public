export type JumpShipTuple = [
  id: number,
  zh: string,
  en: string,
  categoryZh: string,
  categoryEn: string,
  race: string,
  baseRangeLy: number,
  baseFuelPerLy: number,
  fuelTypeId: number,
  fuelZh: string,
  fuelEn: string,
  jumpFreighter: boolean,
];

export type JumpSystemTuple = [
  id: number,
  zh: string,
  en: string,
  regionZh: string,
  regionEn: string,
  security: number,
  xLy: number,
  yLy: number,
  zLy: number,
];

export type JumpNavigatorData = {
  schema: 1;
  source: string;
  sde: number;
  released: string;
  lightYearMeters: number;
  ships: JumpShipTuple[];
  systems: JumpSystemTuple[];
};

export type JumpShip = {
  id: number;
  zh: string;
  en: string;
  categoryZh: string;
  categoryEn: string;
  race: string;
  baseRangeLy: number;
  baseFuelPerLy: number;
  fuelTypeId: number;
  fuelZh: string;
  fuelEn: string;
  jumpFreighter: boolean;
};

export type JumpSystem = {
  id: number;
  zh: string;
  en: string;
  regionZh: string;
  regionEn: string;
  security: number;
  xLy: number;
  yLy: number;
  zLy: number;
};

export type ReachableSystem = JumpSystem & {
  distanceLy: number;
  fuel: number;
};

export type JumpReachableResult = {
  startSystem: JumpSystem;
  ship: JumpShip;
  jumpDriveCalibration: number;
  jumpFuelConservation: number;
  jumpFreighters: number;
  jumpRangeLy: number;
  systems: ReachableSystem[];
};

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function displaySecurity(value: number) {
  if (value > 0 && value < 0.05) return 0.1;
  const displayed = round(value, 1);
  return Object.is(displayed, -0) ? 0 : displayed;
}

export function unpackJumpShip(ship: JumpShipTuple): JumpShip {
  return {
    id: ship[0],
    zh: ship[1],
    en: ship[2],
    categoryZh: ship[3],
    categoryEn: ship[4],
    race: ship[5],
    baseRangeLy: ship[6],
    baseFuelPerLy: ship[7],
    fuelTypeId: ship[8],
    fuelZh: ship[9],
    fuelEn: ship[10],
    jumpFreighter: ship[11],
  };
}

export function unpackJumpSystem(system: JumpSystemTuple): JumpSystem {
  return {
    id: system[0],
    zh: system[1],
    en: system[2],
    regionZh: system[3],
    regionEn: system[4],
    security: system[5],
    xLy: system[6],
    yLy: system[7],
    zLy: system[8],
  };
}

export function isJumpNavigatorData(value: unknown): value is JumpNavigatorData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<JumpNavigatorData>;
  return data.schema === 1
    && Number.isSafeInteger(data.sde)
    && Array.isArray(data.ships)
    && data.ships.length > 0
    && Array.isArray(data.systems)
    && data.systems.length > 0;
}

export function calculateJumpRange(
  data: JumpNavigatorData,
  input: {
    shipTypeId: number;
    startSystemId: number;
    jumpDriveCalibration: number;
    jumpFuelConservation: number;
    jumpFreighters: number;
  },
): JumpReachableResult {
  const skillValues = [input.jumpDriveCalibration, input.jumpFuelConservation, input.jumpFreighters];
  if (!skillValues.every((level) => Number.isSafeInteger(level) && level >= 0 && level <= 5)) {
    throw new Error('Skill levels must be whole numbers from 0 to 5.');
  }
  const shipTuple = data.ships.find((candidate) => candidate[0] === input.shipTypeId);
  const startTuple = data.systems.find((candidate) => candidate[0] === input.startSystemId);
  if (!shipTuple || !startTuple) throw new Error('Ship or start system was not found.');

  const ship = unpackJumpShip(shipTuple);
  const startSystem = unpackJumpSystem(startTuple);
  const jumpRangeLy = ship.baseRangeLy * (1 + 0.2 * input.jumpDriveCalibration);
  const conservationModifier = 1 - 0.1 * input.jumpFuelConservation;
  const freighterModifier = ship.jumpFreighter ? 1 - 0.1 * input.jumpFreighters : 1;
  const systems: ReachableSystem[] = [];

  for (const candidateTuple of data.systems) {
    if (candidateTuple[0] === startSystem.id || displaySecurity(candidateTuple[5]) >= 0.5) continue;
    const distance = Math.hypot(
      candidateTuple[6] - startSystem.xLy,
      candidateTuple[7] - startSystem.yLy,
      candidateTuple[8] - startSystem.zLy,
    );
    if (distance > jumpRangeLy + 1e-9) continue;
    systems.push({
      ...unpackJumpSystem(candidateTuple),
      distanceLy: round(distance, 2),
      fuel: round(distance * ship.baseFuelPerLy * conservationModifier * freighterModifier, 2),
    });
  }
  systems.sort((left, right) => left.distanceLy - right.distanceLy || left.en.localeCompare(right.en));

  return {
    startSystem,
    ship,
    jumpDriveCalibration: input.jumpDriveCalibration,
    jumpFuelConservation: input.jumpFuelConservation,
    jumpFreighters: input.jumpFreighters,
    jumpRangeLy: round(jumpRangeLy, 2),
    systems,
  };
}
