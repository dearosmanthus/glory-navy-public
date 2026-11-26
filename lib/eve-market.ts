export const MARKETS = [
  { id: '10000002', station: '60003760', name: '吉他 4-4（Jita）' },
  { id: '10000043', station: '60008494', name: '艾玛 VIII（Amarr）' },
  { id: '10000032', station: '60011866', name: '多迪谢 IX（Dodixie）' },
  { id: '10000030', station: '60004588', name: '伦斯 VI（Rens）' },
  { id: '10000042', station: '60005686', name: '赫克 VIII（Hek）' },
] as const;

export function marketUrl(region: string, typeIds: number[]) {
  const market = MARKETS.find((entry) => entry.id === region);
  if (!market) throw new Error('请选择有效市场。');
  return `/api/market?region=${market.id}&types=${typeIds.join(',')}`;
}

export type MarketSide = { percentile?: string; min?: string; max?: string; volume?: string };
export type MarketAggregate = { buy?: MarketSide; sell?: MarketSide };
export type MarketMap = Record<string, MarketAggregate>;

export function marketPrice(market: MarketAggregate | undefined, mode: 'buy' | 'sell' | 'split') {
  function price(side: MarketSide | undefined, orderBookEdge: 'min' | 'max') {
    if (!side || (side.volume !== undefined && Number(side.volume) <= 0)) return 0;
    const value = Number(side[orderBookEdge] ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  const buy = price(market?.buy, 'max');
  const sell = price(market?.sell, 'min');
  if (mode === 'buy') return buy;
  if (mode === 'sell') return sell;
  return buy > 0 && sell > 0 ? (buy + sell) / 2 : 0;
}
