export type CourierRoute = {
  id: number;
  start: string;
  end: string;
  cost_per_m3: number;
  collateral_percentage: number;
  transport_type: string;
  transport_volume: number;
  paused: number;
  expiration: number;
  completion: number;
  minimum_cost: number;
};

export type CourierLocationCategory = {
  category_name: string | null;
  category_priority: number;
};

export type CourierRoutesData = {
  routes: CourierRoute[];
  locations: string[];
  location_categories: Record<string, CourierLocationCategory>;
};

export type CourierAppraisal = {
  buy_price: number;
  sell_price: number;
  volume: number;
  janice_url: string | null;
  failed_items?: Record<string, number>;
};

export type CourierAppraisalResponse = {
  success: boolean;
  from_cache?: boolean;
  appraisal?: CourierAppraisal;
  error?: string;
};

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateCourierQuote(
  route: CourierRoute,
  input: {
    volume: number;
    collateral: number;
    additionalVolume?: number;
    additionalCollateral?: number;
  },
) {
  const totalVolume = nonNegative(input.volume) + nonNegative(input.additionalVolume ?? 0);
  const totalCollateral = nonNegative(input.collateral) + nonNegative(input.additionalCollateral ?? 0);
  const costPerCubicMeter = nonNegative(route.cost_per_m3);
  const collateralRatio = nonNegative(route.collateral_percentage) / 100;
  const transportVolume = nonNegative(route.transport_volume);
  const minimumCost = nonNegative(route.minimum_cost);
  const volumeCost = totalVolume * costPerCubicMeter;
  const collateralFee = totalCollateral * collateralRatio;
  const calculatedCost = volumeCost + collateralFee;
  const totalCost = Math.max(calculatedCost, minimumCost);

  return {
    totalVolume,
    totalCollateral,
    volumeCost,
    collateralFee,
    calculatedCost,
    totalCost,
    minimumCost,
    minimumApplied: minimumCost > calculatedCost,
    transportVolume,
    volumeExceedsCapacity: transportVolume > 0 && totalVolume > transportVolume,
  };
}
