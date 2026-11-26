'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';
import { cachedJson } from '@/lib/static-json';
import { revealToolResult } from '@/lib/tool-flow';
import { MARKETS as REGIONS, marketUrl, marketPrice, type MarketMap } from '@/lib/eve-market';
import {
  CircleDollarSign,
  Database,
  ExternalLink,
  RefreshCw,
  Search,
  X,
  ShieldCheck,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LP_CORPORATIONS } from './corporations';
import { LP_FACTIONS } from './factions';
import EveTypeIcon from './eve-type-icon';
import ServerStatus from './server-status';
import ToolNavigation, { type ToolId } from './tool-navigation';
import { bilingualName, formatLocalizedNumber, languageLocale, translate, useLanguage } from './language-provider';

const ContractTool = lazy(() => import('./contract-tool'));
const CourierTool = lazy(() => import('./courier-tool'));
const IndustryTool = lazy(() => import('./industry-tool'));
const ReprocessingTool = lazy(() => import('./reprocessing-tool'));
const BattleScanTool = lazy(() => import('./battle-scan-tool'));
const JumpNavigatorTool = lazy(() => import('./jump-navigator-tool'));
const AttendanceTool = lazy(() => import('./attendance-tool'));

type RequiredItem = { quantity: number; type_id: number };
type Offer = {
  ak_cost: number;
  isk_cost: number;
  lp_cost: number;
  offer_id: number;
  quantity: number;
  required_items: RequiredItem[];
  type_id: number;
};
type NameMap = Record<number, string>;
type BlueprintRecipe = {
  p: [typeId: number, quantity: number, zh: string, en: string];
  m: Array<[typeId: number, quantity: number]>;
};
type BlueprintMap = Record<string, BlueprintRecipe>;
type BlueprintPayload = { sde: number; blueprints: BlueprintMap };
type LocalizedTypeNames = Record<string, [zh: string, en: string]>;
type PriceMode = 'sell' | 'buy';
type SortMode = 'efficiency' | 'profit' | 'lp' | 'name';

type OfferRow = Offer & {
  name: string;
  searchName: string;
  rewardUnitPrice: number;
  rewardValue: number;
  materialCost: number;
  manufacturingCost: number;
  netProfit: number;
  efficiency: number | null;
  pointUnit: 'LP' | 'AK' | null;
  priced: boolean;
  costsPriced: boolean;
  manufacturingPriced: boolean;
  isBlueprint: boolean;
  blueprintRuns: number;
  blueprintProductQuantity: number;
  blueprintProductName: string;
};

const PAGE_SIZE = 25;
const number = { format: (value: number) => formatLocalizedNumber(value, { maximumFractionDigits: 0 }) };
const compact = { format: (value: number) => formatLocalizedNumber(value, { notation: 'compact', maximumFractionDigits: 1 }) };

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function formatIsk(value: number) {
  if (!Number.isFinite(value)) return '—';
  return `${compact.format(value)} ISK`;
}

function typeName(typeNames: LocalizedTypeNames, typeId: number, liveEnglishName?: string) {
  const localized = typeNames[String(typeId)];
  const en = liveEnglishName ?? localized?.[1] ?? `Type ${typeId}`;
  const zh = localized?.[0] ?? en;
  return bilingualName(zh, en);
}

function corporationName(corporation: (typeof LP_CORPORATIONS)[number]) {
  return bilingualName(corporation.zh, corporation.name);
}

function corporationOption(corporation: (typeof LP_CORPORATIONS)[number]) {
  return translate(
    `${corporationName(corporation)} · ${corporation.offers} 项`,
    `${corporationName(corporation)} · ${corporation.offers} offers`,
  );
}

function factionName(faction: (typeof LP_FACTIONS)[number]) {
  return bilingualName(faction.zh, faction.name);
}

export default function Home() {
  const { language } = useLanguage();
  const [tool, setTool] = useState<ToolId>('lp');
  const [routerReady, setRouterReady] = useState(false);
  const [faction, setFaction] = useState('500016');
  const [corporation, setCorporation] = useState('1000130');
  const [region, setRegion] = useState('10000002');
  const [priceMode, setPriceMode] = useState<PriceMode>('sell');
  const [taxRate, setTaxRate] = useState('0');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('efficiency');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [names, setNames] = useState<NameMap>({});
  const [markets, setMarkets] = useState<MarketMap>({});
  const [blueprints, setBlueprints] = useState<BlueprintMap>({});
  const [typeNames, setTypeNames] = useState<LocalizedTypeNames>({});
  const [blueprintSde, setBlueprintSde] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState(translate('正在读取 LP 商店…', 'Loading LP store…'));
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [page, setPage] = useState(1);
  const activeRequest = useRef<AbortController | null>(null);
  const resultPanel = useRef<HTMLElement | null>(null);
  const completedQuery = useRef({ key: '', at: 0 });

  const corporationId = corporation;

  const loadData = useCallback(async () => {
    if (!/^\d{6,12}$/.test(corporationId)) {
      setError(translate('请输入有效的军团 ID。', 'Enter a valid corporation ID.'));
      return;
    }

    activeRequest.current?.abort();
    completedQuery.current = { key: '', at: 0 };
    const controller = new AbortController();
    activeRequest.current = controller;
    const { signal } = controller;
    setOffers([]);
    setNames({});
    setMarkets({});
    setUpdatedAt(null);
    setLoading(true);
    setLoadingStage(translate('正在读取 LP 商店…', 'Loading LP store…'));
    setError('');
    setPage(1);

    try {
      const [offerPayload, blueprintPayload, localizedNames] = await Promise.all([
        fetchJson<Offer[]>(`/api/lp-store?corporation=${corporationId}`, { signal }),
        cachedJson<BlueprintPayload>('/lp-blueprints.json?v=20260907-audit'),
        cachedJson<LocalizedTypeNames>('/lp-type-names.json?v=20260908-1'),
      ]);
      const nextOffers = offerPayload.filter((offer) => offer.quantity > 0);
      const nextBlueprints = blueprintPayload.blueprints;
      const typeIds = Array.from(
        new Set(
          nextOffers.flatMap((offer) => {
            const blueprint = nextBlueprints[String(offer.type_id)];
            return [
              offer.type_id,
              ...offer.required_items.map((item) => item.type_id),
              ...(blueprint
                ? [
                    blueprint.p[0],
                    ...blueprint.m.map(([typeId]) => typeId),
                  ]
                : []),
            ];
          }),
        ),
      );
      if (signal.aborted) return;

      // Render the LP store as soon as its catalog is ready. Market requests can
      // finish in the background instead of keeping the whole table behind a spinner.
      setOffers(nextOffers);
      setBlueprints(nextBlueprints);
      setTypeNames(localizedNames);
      setBlueprintSde(blueprintPayload.sde);
      setLoadingStage(translate(
        `正在查询 ${number.format(typeIds.length)} 个物品的市场价…`,
        `Loading market prices for ${number.format(typeIds.length)} items…`,
      ));

      const [nameResponses, marketResponses] = await Promise.all([
        Promise.all(chunks(typeIds.filter((id) => !localizedNames[String(id)]), 900).map((group) =>
          fetchJson<Array<{ id: number; name: string }>>(`/api/type-names?types=${group.join(',')}`, { signal }))),
        Promise.all(chunks(typeIds, 80).map((group) => fetchJson<MarketMap>(marketUrl(region, group), { signal }))),
      ]);
      if (signal.aborted) return;

      const nextNames: NameMap = {};
      for (const entry of nameResponses.flat()) nextNames[entry.id] = entry.name;

      setNames(nextNames);
      setMarkets(Object.assign({}, ...marketResponses));
      setUpdatedAt(new Date());
      completedQuery.current = { key: `${corporationId}:${region}`, at: Date.now() };
    } catch (reason) {
      if (signal.aborted) return;
      setError(
        reason instanceof Error && (reason.name === 'TimeoutError' || reason.name === 'AbortError')
          ? translate('外部数据源响应超时，请点击“刷新数据”重试。', 'The data source timed out. Select Refresh Data to retry.')
          : reason instanceof Error ? reason.message : translate('数据加载失败，请稍后重试。', 'Failed to load data. Try again later.'),
      );
    } finally {
      if (activeRequest.current === controller && !signal.aborted) {
        setLoading(false);
        setLoadingStage('');
      }
    }
  }, [corporationId, region]);

  useEffect(() => {
    if (routerReady && tool === 'lp' && !(completedQuery.current.key === `${corporationId}:${region}` && Date.now() - completedQuery.current.at < 120_000)) {
      // oxlint-disable-next-line react/react-compiler -- loadData owns the request lifecycle state.
      void loadData();
    }
    return () => activeRequest.current?.abort();
  }, [loadData, tool, routerReady, corporationId, region]);

  useEffect(() => {
    function syncToolFromHash() {
      const hash = window.location.hash;
      setTool(hash.startsWith('#contract') ? 'contract' : hash.startsWith('#courier') ? 'courier' : hash.startsWith('#industry') ? 'industry' : hash.startsWith('#reprocessing') ? 'reprocessing' : hash.startsWith('#dscan') ? 'dscan' : hash.startsWith('#jump') ? 'jump' : hash.startsWith('#attendance') ? 'attendance' : 'lp');
      setRouterReady(true);
    }
    syncToolFromHash();
    window.addEventListener('hashchange', syncToolFromHash);
    return () => window.removeEventListener('hashchange', syncToolFromHash);
  }, []);

  const rows = useMemo<OfferRow[]>(() => {
    void language;
    const fee = Math.min(100, Math.max(0, Number(taxRate) || 0)) / 100;
    return offers.map((offer) => {
      const blueprint = blueprints[String(offer.type_id)];
      const blueprintRuns = blueprint ? offer.quantity : 0;
      const blueprintProductQuantity = blueprint ? blueprint.p[1] * blueprintRuns : 0;
      const rewardTypeId = blueprint ? blueprint.p[0] : offer.type_id;
      const rewardQuantity = blueprint ? blueprintProductQuantity : offer.quantity;
      const rewardUnitPrice = marketPrice(markets[String(rewardTypeId)], priceMode);
      const rewardValue = rewardUnitPrice * rewardQuantity;
      const materialCost = offer.required_items.reduce(
        (sum, item) =>
          sum + marketPrice(markets[String(item.type_id)], 'sell') * item.quantity,
        0,
      );
      const lpMaterialsPriced = offer.required_items.every(
        (item) => marketPrice(markets[String(item.type_id)], 'sell') > 0,
      );
      const manufacturingCost = blueprint
        ? blueprint.m.reduce(
            (sum, [typeId, quantity]) =>
              sum + marketPrice(markets[String(typeId)], 'sell') * quantity * blueprintRuns,
            0,
          )
        : 0;
      const manufacturingMaterialsPriced = blueprint
        ? blueprint.m.every(([typeId]) => marketPrice(markets[String(typeId)], 'sell') > 0)
        : true;
      const costsPriced = lpMaterialsPriced && manufacturingMaterialsPriced;
      const netProfit = rewardValue * (1 - fee) - offer.isk_cost - materialCost - manufacturingCost;
      const pointCost = offer.lp_cost > 0 ? offer.lp_cost : offer.ak_cost;
      const pointUnit = offer.lp_cost > 0 ? 'LP' : offer.ak_cost > 0 ? 'AK' : null;
      const displayName = typeName(typeNames, offer.type_id, names[offer.type_id]);
      const blueprintProductName = blueprint
        ? bilingualName(blueprint.p[2], blueprint.p[3])
        : '';
      return {
        ...offer,
        name: displayName,
        searchName: `${displayName} ${blueprintProductName} ${offer.type_id}`,
        rewardUnitPrice,
        rewardValue,
        materialCost,
        manufacturingCost,
        netProfit,
        efficiency: pointCost > 0 ? netProfit / pointCost : null,
        pointUnit,
        priced: rewardUnitPrice > 0 && costsPriced,
        costsPriced,
        manufacturingPriced: manufacturingMaterialsPriced,
        isBlueprint: Boolean(blueprint),
        blueprintRuns,
        blueprintProductQuantity,
        blueprintProductName,
      };
    });
  // oxlint-disable-next-line react/react-compiler -- Imported localization helpers read this language state.
  }, [blueprints, language, markets, names, offers, priceMode, taxRate, typeNames]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const result = rows.filter((row) =>
      normalized ? row.searchName.toLocaleLowerCase().includes(normalized) : true,
    );
    return result.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'lp') return a.lp_cost - b.lp_cost;
      if (a.priced !== b.priced) return a.priced ? -1 : 1;
      if (sort === 'profit') return b.netProfit - a.netProfit;
      const rank = (row: OfferRow) => row.pointUnit === 'LP' ? 0 : row.pointUnit === 'AK' ? 1 : 2;
      return rank(a) - rank(b) || (b.efficiency ?? b.netProfit) - (a.efficiency ?? a.netProfit);
    });
  }, [query, rows, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pricedCount = rows.filter((row) => row.priced).length;
  const preferredUnit = rows.some((row) => row.pointUnit === 'LP') ? 'LP' : rows.some((row) => row.pointUnit === 'AK') ? 'AK' : null;
  const best = rows
    .filter((row) => row.priced && row.pointUnit === preferredUnit)
    .sort((a, b) => (b.efficiency ?? b.netProfit) - (a.efficiency ?? a.netProfit))[0];
  const selectedCorporation = LP_CORPORATIONS.find((item) => item.id === corporation);
  const selectedFaction = LP_FACTIONS.find((item) => item.id === faction);
  const factionCorporations = useMemo(() => {
    const corporationIds = new Set<string>(selectedFaction?.corporationIds ?? []);
    return LP_CORPORATIONS.filter((item) => corporationIds.has(item.id));
  }, [selectedFaction]);
  const currentCorporation = selectedCorporation ? corporationName(selectedCorporation) : undefined;

  function chooseFaction(value: string) {
    const nextFaction = LP_FACTIONS.find((item) => item.id === value);
    if (!nextFaction) return;
    setFaction(nextFaction.id);
    if (!nextFaction.corporationIds.some((id) => id === corporation)) {
      const nextCorporation = LP_CORPORATIONS.find((item) =>
        nextFaction.corporationIds.some((id) => id === item.id),
      );
      if (nextCorporation) setCorporation(nextCorporation.id);
    }
  }

  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- pagination resets when the result set changes.
    setPage(1);
  }, [query, sort]);

  function switchTool(nextTool: ToolId) {
    setTool(nextTool);
    window.history.pushState(null, '', nextTool === 'lp' ? window.location.pathname : `#${nextTool}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function changePage(next: number) {
    setPage(next);
    requestAnimationFrame(() => revealToolResult(resultPanel.current));
  }

  if (tool === 'contract') {
    return <Suspense fallback={<ToolLoading />}><ContractTool onSwitch={switchTool} /></Suspense>;
  }

  if (tool === 'courier') {
    return <Suspense fallback={<ToolLoading />}><CourierTool onSwitch={switchTool} /></Suspense>;
  }

  if (tool === 'industry') {
    return <Suspense fallback={<ToolLoading />}><IndustryTool onSwitch={switchTool} /></Suspense>;
  }

  if (tool === 'reprocessing') {
    return <Suspense fallback={<ToolLoading />}><ReprocessingTool onSwitch={switchTool} /></Suspense>;
  }

  if (tool === 'dscan') {
    return <Suspense fallback={<ToolLoading />}><BattleScanTool onSwitch={switchTool} /></Suspense>;
  }

  if (tool === 'jump') {
    return <Suspense fallback={<ToolLoading />}><JumpNavigatorTool onSwitch={switchTool} /></Suspense>;
  }

  if (tool === 'attendance') {
    return <Suspense fallback={<ToolLoading />}><AttendanceTool onSwitch={switchTool} /></Suspense>;
  }

  return (
    <main className="site-shell min-h-screen text-foreground">
      <div className="scanline" aria-hidden="true" />
      <header className="site-header border-b border-border/80 bg-card/80 backdrop-blur-xl">
        <div className="site-header-grid mx-auto max-w-[1500px] px-4 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="brand-mark grid size-10 place-items-center border border-cyan-400/40 bg-cyan-400/10 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,.12)]">
              <Zap className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="glory-wordmark font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Glory Navy</p>
              <h1 className="text-lg font-semibold tracking-tight">{translate('LP 兑换效率终端', 'LP Store Efficiency')}</h1>
            </div>
          </div>
          <ServerStatus />
          <ToolNavigation active="lp" onSelect={switchTool} />
        </div>
      </header>

      <div className="site-content mx-auto max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">
        <section className="hud-panel control-grid mb-6 border border-border bg-card/80 p-4 shadow-2xl shadow-black/10 sm:p-5">
          <label className="field-block" htmlFor="lp-faction">
            <span>{translate(`所属势力 · ${LP_FACTIONS.length} 个`, `Faction · ${LP_FACTIONS.length}`)}</span>
            <NativeSelect id="lp-faction" value={faction} onChange={(event) => chooseFaction(event.target.value)}>
              {LP_FACTIONS.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {factionName(item)} · {item.corporationIds.length}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>

          <label className="field-block" htmlFor="lp-corporation">
            <span>{translate(`LP 军团 · ${factionCorporations.length} 个`, `LP corporation · ${factionCorporations.length}`)}</span>
            <NativeSelect id="lp-corporation" value={corporation} onChange={(event) => setCorporation(event.target.value)}>
              {factionCorporations.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {corporationOption(item)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>

          <label className="field-block" htmlFor="market-region">
            <span>{translate('估值市场', 'Market')}</span>
            <NativeSelect id="market-region" className="w-full" value={region} onChange={(event) => setRegion(event.target.value)}>
              {REGIONS.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>

          <label className="field-block" htmlFor="price-mode">
            <span>{translate('奖励估值', 'Reward price')}</span>
            <NativeSelect
              id="price-mode"
              className="w-full"
              value={priceMode}
              onChange={(event) => setPriceMode(event.target.value as PriceMode)}
            >
              <NativeSelectOption value="sell">{translate('最低卖单（挂单出售参考）', 'Lowest sell (listing reference)')}</NativeSelectOption>
              <NativeSelectOption value="buy">{translate('最高买单（立即出售）', 'Highest buy (instant sale)')}</NativeSelectOption>
            </NativeSelect>
          </label>

          <label className="field-block" htmlFor="tax-rate">
            <span>{translate('税费估算', 'Estimated tax')}</span>
            <div className="relative">
              <Input
                id="tax-rate"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={taxRate}
                onChange={(event) => setTaxRate(event.target.value)}
                className="pr-8"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
            </div>
          </label>

          <div className="flex items-end">
            <Button className="h-8 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300" onClick={() => void loadData()} disabled={loading}>
              <RefreshCw className={loading ? 'animate-spin' : ''} data-icon="inline-start" />
              {loading ? translate('同步中…', 'Syncing…') : translate('刷新数据', 'Refresh data')}
            </Button>
          </div>
        </section>

        <section className="mb-6 grid gap-3 sm:grid-cols-3">
          <Metric
            icon={<Database />}
            label={translate('有效兑换', 'Valid offers')}
            value={loading && rows.length === 0 ? '—' : translate(`${number.format(rows.length)} 项`, `${number.format(rows.length)} offers`)}
            meta={currentCorporation ?? `Corp ${corporationId}`}
          />
          <Metric
            icon={<ShieldCheck />}
            label={translate('已获得市场价', 'Market prices found')}
            value={loading && rows.length === 0 ? '—' : `${number.format(pricedCount)} / ${number.format(rows.length)}`}
            meta={REGIONS.find((item) => item.id === region)?.name ?? region}
          />
          <Metric
            icon={<CircleDollarSign />}
            label={preferredUnit ? translate(`当前最高 ${preferredUnit} 效率`, `Best ${preferredUnit} efficiency`) : translate('当前最高单次净利润', 'Best profit per exchange')}
            value={loading || !best ? '—' : best.efficiency === null ? formatIsk(best.netProfit) : `${number.format(best.efficiency)} ISK / ${best.pointUnit}`}
            meta={loading ? translate('正在获取报价…', 'Fetching prices…') : best?.name ?? (rows.length > 0 ? translate('缺少完整市场报价', 'Incomplete market prices') : translate('等待数据', 'Waiting for data'))}
            accent
          />
        </section>

        <section ref={resultPanel} tabIndex={-1} className="tool-result-anchor tool-table-scroll hud-panel overflow-hidden border border-border bg-card/85 shadow-2xl shadow-black/10">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={translate('搜索物品中文名、英文名或 ID…', 'Search item name or Type ID…')}
                aria-label={translate('搜索奖励物品', 'Search reward items')}
                className="pl-9 pr-10"
              />
              {query && <Button variant="ghost" size="icon-sm" className="absolute right-0 top-0 h-full" onClick={() => setQuery('')} aria-label={translate('清除搜索', 'Clear search')}><X /></Button>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{translate('排序', 'Sort')}</span>
              <NativeSelect value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
                <NativeSelectOption value="efficiency">{translate('单位点数收益', 'ISK per point')}</NativeSelectOption>
                <NativeSelectOption value="profit">{translate('单次利润', 'Profit per offer')}</NativeSelectOption>
                <NativeSelectOption value="lp">{translate('LP 成本', 'LP cost')}</NativeSelectOption>
                <NativeSelectOption value="name">{translate('物品名称', 'Item name')}</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>

          {loading && offers.length > 0 && <p aria-live="polite" className="flex items-center gap-2 border-b border-cyan-400/20 bg-cyan-400/5 px-4 py-3 text-sm text-cyan-100"><RefreshCw className="size-4 animate-spin" />{loadingStage}</p>}
          {error ? (
            <div className="grid min-h-72 place-items-center p-8 text-center">
              <div>
                <p className="mb-2 font-medium text-red-300">{translate('数据同步失败', 'Data sync failed')}</p>
                <p className="max-w-md text-sm text-muted-foreground">{error}</p>
                <Button variant="outline" className="mt-5" onClick={() => void loadData()}>
                  {translate('重新尝试', 'Try again')}
                </Button>
              </div>
            </div>
          ) : loading && offers.length === 0 ? (
            <LoadingTable stage={loadingStage} />
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center" aria-live="polite"><p className="font-medium">{query.trim() ? translate(`没有找到“${query.trim()}”`, `No matches for “${query.trim()}”`) : translate('该军团暂无兑换项目', 'This corporation has no offers')}</p><p className="mt-2 text-sm text-muted-foreground">{query.trim() ? translate('试试其他中文名、英文名或物品 ID。', 'Try another item name or Type ID.') : translate('可以在上方选择其他军团。', 'Choose another corporation above.')}</p>{query && <Button variant="outline" className="mt-4" onClick={() => setQuery('')}>{translate('清除搜索，显示全部', 'Clear search and show all')}</Button>}</div>
          ) : (
            <Table className="mobile-row-table lp-result-table">
              <TableHeader>
                <TableRow className="bg-muted/25 hover:bg-muted/25">
                  <TableHead className="min-w-72 pl-4">{translate('兑换奖励', 'Reward')}</TableHead>
                  <TableHead className="text-right">LP / AK</TableHead>
                  <TableHead className="text-right">{translate('ISK + 材料成本', 'ISK + material cost')}</TableHead>
                  <TableHead className="text-right">{translate('奖励 / 成品估值', 'Reward / product value')}</TableHead>
                  <TableHead className="text-right">{translate('预计净利润', 'Estimated profit')}</TableHead>
                  <TableHead className="pr-4 text-right">{translate('单位点数收益', 'ISK per point')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => (
                  <TableRow key={row.offer_id}>
                    <TableCell className="max-w-[420px] pl-4">
                      <div className="flex items-start gap-3">
                        <EveTypeIcon typeId={row.type_id} blueprint={row.isBlueprint} />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-100">
                            {!row.isBlueprint && row.quantity > 1 ? `${row.quantity}× ` : ''}{row.name}
                          </div>
                          {row.isBlueprint && (
                            <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="border-cyan-400/30 text-cyan-200">
                                  {translate(`蓝图反推 · ${number.format(row.blueprintRuns)} 流程`, `Blueprint estimate · ${number.format(row.blueprintRuns)} runs`)}
                                </Badge>
                                <span>
                                  {translate(`产出 ${number.format(row.blueprintProductQuantity)}×`, `Output ${number.format(row.blueprintProductQuantity)}×`)} {row.blueprintProductName}
                                </span>
                              </div>
                              <div>
                                {translate('制造材料（ME 0）：', 'Manufacturing materials (ME 0): ')}{loading ? translate('报价中…', 'Pricing…') : row.manufacturingPriced ? formatIsk(row.manufacturingCost) : translate('缺少市场价', 'Missing price')}
                              </div>
                            </div>
                          )}
                          {row.required_items.length > 0 && (
                            <div className="mt-1 whitespace-normal break-words text-xs text-muted-foreground">
                              {translate('商店需要：', 'Store requires: ')}{row.required_items.map((item) => `${item.quantity}× ${typeName(typeNames, item.type_id, names[item.type_id])}`).join(' · ')}
                            </div>
                          )}
                          {row.ak_cost > 0 && <Badge variant="outline" className="mt-1 border-amber-400/25 text-amber-200">{number.format(row.ak_cost)} AK</Badge>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell data-label={translate('LP / AK', 'LP / AK')} className="text-right font-mono">
                      {row.lp_cost > 0 ? number.format(row.lp_cost) : row.ak_cost > 0 ? `${number.format(row.ak_cost)} AK` : '0 LP'}
                    </TableCell>
                    <TableCell data-label={translate('ISK + 材料成本', 'ISK + materials')} className="text-right font-mono text-muted-foreground">
                      {loading ? translate('报价中…', 'Pricing…') : row.costsPriced ? formatIsk(row.isk_cost + row.materialCost + row.manufacturingCost) : translate('材料缺价', 'Missing material price')}
                    </TableCell>
                    <TableCell data-label={translate('奖励 / 成品估值', 'Reward / product value')} className="text-right font-mono">{loading ? translate('报价中…', 'Pricing…') : row.priced ? formatIsk(row.rewardValue) : translate('无市场价', 'No market price')}</TableCell>
                    <TableCell data-label={translate('预计净利润', 'Estimated profit')} className={`text-right font-mono ${row.netProfit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {loading ? translate('报价中…', 'Pricing…') : row.priced ? formatIsk(row.netProfit) : '—'}
                    </TableCell>
                    <TableCell data-label={translate('单位点数收益', 'ISK per point')} className="pr-4 text-right">
                      {loading ? translate('报价中…', 'Pricing…') : row.priced && row.efficiency !== null ? (
                        <span className="inline-flex min-w-24 justify-end border-l-2 border-cyan-400 pl-3 font-mono font-semibold text-cyan-200">
                          {number.format(row.efficiency)} / {row.pointUnit}
                        </span>
                      ) : row.priced ? translate('材料兑换', 'Material exchange') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!loading && !error && (
            <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                {translate(
                  `显示 ${filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0}–${Math.min(page * PAGE_SIZE, filtered.length)}，共 ${number.format(filtered.length)} 项`,
                  `Showing ${filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0}–${Math.min(page * PAGE_SIZE, filtered.length)}, ${number.format(filtered.length)} total`,
                )}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => changePage(Math.max(1, page - 1))}>{translate('上一页', 'Previous')}</Button>
                <span className="min-w-16 text-center font-mono">{page} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => changePage(Math.min(totalPages, page + 1))}>{translate('下一页', 'Next')}</Button>
              </div>
            </div>
          )}
        </section>

        <footer className="flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            {translate('价格采用所选贸易中心空间站订单簿极值（最高买单 / 最低卖单）；LP、AK 分别排序。蓝图按流程数和 SDE 基础材料（ME 0）反推，未计制造安装费。', 'Prices use the selected trade hub station order-book edges (highest buy / lowest sell). LP and AK are ranked separately. Blueprint values are estimated from runs and SDE base materials at ME 0; job installation fees are excluded.')}
          </p>
          <p className="flex items-center gap-3">
            {updatedAt && translate(`更新于 ${updatedAt.toLocaleTimeString(languageLocale(), { hour: '2-digit', minute: '2-digit' })}`, `Updated ${updatedAt.toLocaleTimeString(languageLocale(), { hour: '2-digit', minute: '2-digit' })}`)}
            {blueprintSde && `SDE ${blueprintSde}`}
            <a className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200" href="https://developers.eveonline.com/api-explorer" target="_blank" rel="noreferrer">
              ESI <ExternalLink className="size-3" />
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}

function ToolLoading() {
  return (
    <main className="site-shell grid min-h-screen place-items-center text-foreground">
      <div className="hud-panel border border-border bg-card/85 px-8 py-7 text-center">
        <RefreshCw className="mx-auto mb-3 size-5 animate-spin text-cyan-300" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{translate('正在载入功能模块…', 'Loading module…')}</p>
      </div>
    </main>
  );
}

function Metric({ icon, label, value, meta, accent = false }: { icon: React.ReactNode; label: string; value: string; meta: string; accent?: boolean }) {
  return (
    <article className={`hud-card relative overflow-hidden border bg-card/80 p-4 ${accent ? 'border-cyan-400/35' : 'border-border'}`}>
      {accent && <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-cyan-400/8 to-transparent" aria-hidden="true" />}
      <div className="mb-3 flex items-center justify-between text-muted-foreground">
        <span className="text-xs uppercase tracking-[0.14em]">{label}</span>
        <span className="[&_svg]:size-4">{icon}</span>
      </div>
      <p className={`font-mono text-xl font-semibold ${accent ? 'text-cyan-200' : 'text-slate-100'}`}>{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>
    </article>
  );
}

function LoadingTable({ stage }: { stage: string }) {
  return (
    <div aria-label={translate('正在载入兑换数据', 'Loading LP data')}>
      <div className="flex items-center gap-2 border-b border-cyan-400/15 bg-cyan-400/5 px-4 py-3 text-xs text-cyan-200">
        <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
        {stage || translate('正在同步实时数据…', 'Syncing live data…')}
      </div>
      <div className="space-y-1 p-4">
        {Array.from({ length: 9 }, (_, index) => (
          <div key={index} className="grid grid-cols-[minmax(210px,2fr)_repeat(4,1fr)] items-center gap-6 border-b border-border/50 py-3">
            <div className="space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-32" /></div>
            <Skeleton className="ml-auto h-4 w-16" />
            <Skeleton className="ml-auto h-4 w-24" />
            <Skeleton className="ml-auto hidden h-4 w-20 sm:block" />
            <Skeleton className="ml-auto hidden h-4 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
