'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';
import { cachedJson } from '@/lib/static-json';
import { revealToolResult } from '@/lib/tool-flow';
import { MARKETS, marketPrice, marketUrl, type MarketAggregate, type MarketMap } from '@/lib/eve-market';
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  FlaskConical,
  Gem,
  IceCreamBowl,
  Mountain,
  PackageOpen,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import EveTypeIcon from './eve-type-icon';
import { bilingualName, formatLocalizedNumber, languageLocale, translate, useLanguage } from './language-provider';
import ServerStatus from './server-status';
import ToolNavigation, { type ToolId } from './tool-navigation';

type ReprocessingKind = 'ore' | 'moon' | 'ice' | 'equipment' | 'material';
type RigTier = 'none' | 't1' | 't2';
type SecurityBand = 'high' | 'low' | 'null';
type Facility = 'npc' | 'athanor' | 'tatara' | 'custom';
type CompactType = [
  id: number,
  zh: string,
  en: string,
  volume: number,
  portionSize: number,
  kind: ReprocessingKind,
  groupId: number,
  skillId: number,
  materials: Array<[number, number]> | null,
];
type ReprocessingPayload = {
  schema: number;
  source: string;
  sde: number;
  types: CompactType[];
  groups: Array<[number, string, string]>;
  skills: Array<[number, string, string]>;
};
type EveType = {
  id: number;
  zh: string;
  en: string;
  volume: number;
  portionSize: number;
  kind: ReprocessingKind;
  groupId: number;
  skillId: number;
  materials: Array<[number, number]>;
};
type ReprocessingIndex = {
  byId: Map<number, EveType>;
  byName: Map<string, EveType[]>;
  groups: Map<number, string>;
  skills: Map<number, string>;
  count: number;
  source: string;
  sde: number;
};
type ParsedItem = { type: EveType; quantity: number };
type SavedSettings = {
  region: string;
  facility: Facility;
  security: SecurityBand;
  asteroidRig: RigTier;
  moonRig: RigTier;
  iceRig: RigTier;
  combinedRig: RigTier;
  customFacilityYield: string;
  reprocessingLevel: string;
  efficiencyLevel: string;
  specialtyLevel: string;
  scrapmetalLevel: string;
  implant: string;
  skillOverrides: Record<string, string>;
};
type Prices = { buy: number; split: number; sell: number };
type OutputRow = { type: EveType; quantity: number; unitPrices: Prices; values: Prices };
type ItemResult = {
  item: ParsedItem;
  batches: number;
  remainder: number;
  yieldPercent: number;
  specialtyLevel: number;
  rawPrices: Prices;
  rawValues: Prices;
  processedValues: Prices;
  outputs: OutputRow[];
  recommended: 'raw' | 'reprocess' | 'unknown';
};
type Analysis = {
  rows: ItemResult[];
  outputs: OutputRow[];
  rawTotals: Prices;
  processedTotals: Prices;
  delta: number;
  missingPrices: number;
  updatedAt: Date;
};

const SETTINGS_KEY = 'glory-navy.reprocessing.settings.v1';
const SAMPLE = `Veldspar\t100000
Compressed Veldspar\t50000
Loparite\t10000
Clear Icicle\t20
Rifter\t1`;
const PRICE_MODES: Array<keyof Prices> = ['buy', 'split', 'sell'];
const number = { format: (value: number) => formatLocalizedNumber(value, { maximumFractionDigits: 2 }) };
const compact = { format: (value: number) => formatLocalizedNumber(value, { notation: 'compact', maximumFractionDigits: 2 }) };
const DEFAULT_SETTINGS: SavedSettings = {
  region: '10000002',
  facility: 'npc',
  security: 'high',
  asteroidRig: 'none',
  moonRig: 'none',
  iceRig: 'none',
  combinedRig: 'none',
  customFacilityYield: '50',
  reprocessingLevel: '5',
  efficiencyLevel: '5',
  specialtyLevel: '5',
  scrapmetalLevel: '5',
  implant: '4',
  skillOverrides: {},
};
const FACILITIES: Array<{ id: Facility; zh: string; en: string; role: number }> = [
  { id: 'npc', zh: 'NPC 空间站（50%）', en: 'NPC station (50%)', role: 0 },
  { id: 'athanor', zh: '阿塔诺（建筑 +2%）', en: 'Athanor (structure +2%)', role: 2 },
  { id: 'tatara', zh: '塔塔拉（建筑 +5.5%）', en: 'Tatara (structure +5.5%)', role: 5.5 },
  { id: 'custom', zh: '自定义设施收率', en: 'Custom facility yield', role: 0 },
];
const RIGS: Array<{ id: RigTier; zh: string; en: string }> = [
  { id: 'none', zh: '无改装件（50%）', en: 'No rig (50%)' },
  { id: 't1', zh: '科技等级 I（51%）', en: 'Tech I (51%)' },
  { id: 't2', zh: '科技等级 II（53%）', en: 'Tech II (53%)' },
];
const SECURITY: Array<{ id: SecurityBand; zh: string; en: string; multiplier: number }> = [
  { id: 'high', zh: '高安（×1.00）', en: 'High sec (×1.00)', multiplier: 1 },
  { id: 'low', zh: '低安（×1.06）', en: 'Low sec (×1.06)', multiplier: 1.06 },
  { id: 'null', zh: '零安、虫洞（×1.12）', en: 'Null sec & wormhole (×1.12)', multiplier: 1.12 },
];

function facilityLabel(facility: (typeof FACILITIES)[number]) {
  return bilingualName(facility.zh, facility.en);
}

function rigTierLabel(rig: (typeof RIGS)[number]) {
  return translate(rig.zh, rig.en);
}

function securityLabel(band: (typeof SECURITY)[number]) {
  return translate(band.zh, band.en);
}
function normalizeName(value: string) {
  return value.normalize('NFKC').replace(/\u00a0/g, ' ').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function bilingual(type: EveType | undefined) {
  if (!type) return translate('未知物品', 'Unknown item');
  return bilingualName(type.zh, type.en);
}

function localizedPair(value: string) {
  const separator = value.indexOf(' / ');
  return separator < 0 ? value : translate(value.slice(0, separator), value.slice(separator + 3));
}

function kindLabel(kind: Exclude<ReprocessingKind, 'material'>) {
  return {
    ore: translate('普矿', 'Ore'),
    moon: translate('月矿', 'Moon ore'),
    ice: translate('冰矿', 'Ice'),
    equipment: translate('装备', 'Equipment'),
  }[kind];
}

function parseQuantity(value: string) {
  const normalized = value.normalize('NFKC').replace(/，/g, ',').trim();
  if (!/^\d+$/.test(normalized) && !/^\d{1,3}([,._ ])\d{3}(?:\1\d{3})*$/.test(normalized)) return 0;
  const result = Number(normalized.replace(/[,._ ]/g, ''));
  return Number.isSafeInteger(result) && result > 0 && result <= 1e12 ? result : 0;
}

function findType(index: ReprocessingIndex, name: string) {
  const key = name.trim();
  if (/^\d+$/.test(key)) return index.byId.get(Number(key));
  const candidates = index.byName.get(normalizeName(key));
  return candidates?.length === 1 ? candidates[0] : undefined;
}

function parseLine(line: string, index: ReprocessingIndex) {
  const columns = line.includes('\t') ? line.split('\t').map((part) => part.trim()) : line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
  if (columns.length >= 2) {
    const type = findType(index, columns[0]);
    const quantity = parseQuantity(columns[1]);
    if (type && quantity) return { type, quantity };
    const leadingQuantity = parseQuantity(columns[0]);
    const leadingType = findType(index, columns[1]);
    if (leadingType && leadingQuantity) return { type: leadingType, quantity: leadingQuantity };
    if (line.includes('\t') || type || leadingType) return null;
  }
  const tokens = line.trim().split(/\s+/);
  for (let split = tokens.length - 1; split >= 1; split -= 1) {
    const quantity = parseQuantity(tokens[split]);
    const type = findType(index, tokens.slice(0, split).join(' '));
    if (type && quantity) return { type, quantity };
  }
  const leading = parseQuantity(tokens[0] ?? '');
  if (leading) {
    for (let end = tokens.length; end >= 2; end -= 1) {
      const type = findType(index, tokens.slice(1, end).join(' '));
      if (type) return { type, quantity: leading };
    }
  }
  const direct = findType(index, line);
  return direct ? { type: direct, quantity: 1 } : null;
}

function parseInput(value: string, index: ReprocessingIndex) {
  if (value.length > 500_000 || value.split(/\r?\n/).length > 5_000) throw new Error(translate('清单过长：最多 5000 行、50 万字符。', 'The list is too large. Use at most 5,000 lines or 500,000 characters.'));
  const aggregate = new Map<number, ParsedItem>();
  const unmatched: string[] = [];
  for (const original of value.split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    const parsed = parseLine(line, index);
    if (!parsed || parsed.type.kind === 'material' || parsed.type.materials.length === 0) {
      unmatched.push(original);
      continue;
    }
    const current = aggregate.get(parsed.type.id);
    const quantity = (current?.quantity ?? 0) + parsed.quantity;
    if (quantity > 1e12) throw new Error(translate('同一种物品数量最多 1 万亿，请分批计算。', 'A single item is limited to 1 trillion units. Please split the calculation.'));
    aggregate.set(parsed.type.id, { type: parsed.type, quantity });
  }
  if (aggregate.size > 500) throw new Error(translate('一次最多计算 500 种物品。', 'Each calculation supports up to 500 item types.'));
  return { items: Array.from(aggregate.values()), unmatched };
}

function unpack(row: CompactType): EveType {
  return { id: row[0], zh: row[1], en: row[2], volume: row[3], portionSize: row[4], kind: row[5], groupId: row[6], skillId: row[7], materials: row[8] ?? [] };
}

function decode(payload: ReprocessingPayload): ReprocessingIndex {
  const byId = new Map<number, EveType>();
  const byName = new Map<string, EveType[]>();
  for (const compactType of payload.types) {
    const type = unpack(compactType);
    byId.set(type.id, type);
    if (type.kind === 'material' || type.materials.length === 0) continue;
    for (const name of new Set([normalizeName(type.zh), normalizeName(type.en)])) {
      byName.set(name, [...(byName.get(name) ?? []), type]);
    }
  }
  const groups = new Map(payload.groups.map(([id, zh, en]) => [id, zh === en ? zh : `${zh}（${en}）`]));
  const skills = new Map(payload.skills.map(([id, zh, en]) => [id, zh === en ? zh : `${zh}（${en}）`]));
  return { byId, byName, groups, skills, count: Array.from(byId.values()).filter((type) => type.materials.length > 0).length, source: payload.source, sde: payload.sde };
}

function priceValues(market: MarketAggregate | undefined): Prices {
  return { buy: marketPrice(market, 'buy'), split: marketPrice(market, 'split'), sell: marketPrice(market, 'sell') };
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function bounded(value: string, min: number, max: number, fallback = min) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function facilityYield(kind: ReprocessingKind, settings: SavedSettings) {
  if (kind === 'equipment') return 0.5;
  if (settings.facility === 'custom') return bounded(settings.customFacilityYield, 0, 100, 50) / 100;
  if (settings.facility === 'npc') return 0.5;
  const rig = settings.facility === 'tatara'
    ? settings.combinedRig
    : kind === 'moon' ? settings.moonRig : kind === 'ice' ? settings.iceRig : settings.asteroidRig;
  const base = rig === 't2' ? 0.53 : rig === 't1' ? 0.51 : 0.5;
  const security = rig === 'none' ? 1 : SECURITY.find((band) => band.id === settings.security)?.multiplier ?? 1;
  const role = FACILITIES.find((facility) => facility.id === settings.facility)?.role ?? 0;
  return base * security * (1 + role / 100);
}

function totalYield(type: EveType, settings: SavedSettings) {
  if (type.kind === 'equipment') return Math.min(1, facilityYield(type.kind, settings) * (1 + bounded(settings.scrapmetalLevel, 0, 5, 0) * 0.02));
  const specialty = bounded(settings.skillOverrides[String(type.skillId)] ?? settings.specialtyLevel, 0, 5, 0);
  return Math.min(1,
    facilityYield(type.kind, settings)
    * (1 + bounded(settings.reprocessingLevel, 0, 5, 0) * 0.03)
    * (1 + bounded(settings.efficiencyLevel, 0, 5, 0) * 0.02)
    * (1 + specialty * 0.02)
    * (1 + bounded(settings.implant, 0, 4, 0) / 100),
  );
}

function outputQuantity(batches: number, perBatch: number, yieldValue: number) {
  const scaled = BigInt(Math.round(Math.min(1, Math.max(0, yieldValue)) * 10_000_000));
  return Number(BigInt(batches) * BigInt(perBatch) * scaled / BigInt(10_000_000));
}

function formatIsk(value: number) {
  return Number.isFinite(value) ? `${compact.format(value)} ISK` : '—';
}

function formatPercent(value: number) {
  return `${number.format(value * 100)}%`;
}

export default function ReprocessingTool({ onSwitch }: { onSwitch: (tool: ToolId) => void }) {
  useLanguage();
  const [index, setIndex] = useState<ReprocessingIndex | null>(null);
  const [input, setInput] = useState('');
  const [settings, setSettings] = useState<SavedSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [dataAttempt, setDataAttempt] = useState(0);
  const [dataError, setDataError] = useState('');
  const [calculating, setCalculating] = useState(false);
  const [loadingStage, setLoadingStage] = useState(() => translate('载入重处理数据库…', 'Loading reprocessing database…'));
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const request = useRef<AbortController | null>(null);
  const resultTotals = useRef<HTMLElement | null>(null);
  useEffect(() => { if (analysis) revealToolResult(resultTotals.current); }, [analysis]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? 'null');
      // oxlint-disable-next-line react/react-compiler -- Hydrate persisted user settings after the browser mounts.
      if (saved) setSettings({ ...DEFAULT_SETTINGS, ...saved, skillOverrides: saved.skillOverrides ?? {} });
    } catch { /* use defaults */ }
    // oxlint-disable-next-line react/react-compiler -- Mark local-storage hydration complete after the browser mounts.
    setSettingsLoaded(true);
  }, []);

  useEffect(() => {
    if (settingsLoaded) window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings, settingsLoaded]);

  useEffect(() => {
    let cancelled = false;
    cachedJson<ReprocessingPayload>('/reprocessing-data.json?v=20260908-2')
      .then((payload) => { if (!cancelled) setIndex(decode(payload)); })
      .catch((reason) => { if (!cancelled) setDataError(reason instanceof Error ? reason.message : translate('重处理数据库加载失败。', 'Failed to load the reprocessing database.')); })
      .finally(() => { if (!cancelled) setLoadingData(false); });
    return () => { cancelled = true; };
  }, [dataAttempt]);

  useEffect(() => () => request.current?.abort(), []);

  function invalidate() {
    request.current?.abort();
    setCalculating(false);
    setLoadingStage('');
    setAnalysis(null);
    setCopied(false);
    setError('');
  }

  function updateSettings(patch: Partial<SavedSettings>) {
    invalidate();
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function calculate() {
    if (!index) { setError(translate('重处理数据库尚未加载完成。', 'The reprocessing database is still loading.')); return; }
    let parsed;
    try { parsed = parseInput(input, index); }
    catch (reason) { setError(reason instanceof Error ? reason.message : translate('清单解析失败。', 'Failed to parse the list.')); return; }
    setItems(parsed.items);
    setUnmatched(parsed.unmatched);
    if (parsed.items.length === 0) { setError(translate('没有识别到可重处理物品，请粘贴“物品名 + 数量”，每行一项。', 'No reprocessable items were recognized. Paste one item name and quantity per line.')); return; }

    const ids = new Set<number>();
    for (const item of parsed.items) {
      ids.add(item.type.id);
      for (const [materialId] of item.type.materials) ids.add(materialId);
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setCalculating(true);
    setLoadingStage(translate(`查询 ${ids.size} 种物品的吉他报价…`, `Fetching Jita prices for ${ids.size} item types…`));
    setError('');
    try {
      const responses = await Promise.all(chunks(Array.from(ids), 80).map((group) => fetchJson<MarketMap>(marketUrl(settings.region, group), { signal: controller.signal }, 30_000)));
      if (controller.signal.aborted) return;
      const markets = Object.assign({}, ...responses) as MarketMap;
      const outputMap = new Map<number, OutputRow>();
      const rows = parsed.items.map((item): ItemResult => {
        const batches = Math.floor(item.quantity / item.type.portionSize);
        const remainder = item.quantity - batches * item.type.portionSize;
        const yieldValue = totalYield(item.type, settings);
        const rawPrices = priceValues(markets[String(item.type.id)]);
        const rawValues = PRICE_MODES.reduce((values, mode) => ({ ...values, [mode]: rawPrices[mode] * item.quantity }), { buy: 0, split: 0, sell: 0 });
        const outputs = item.type.materials.map(([materialId, perBatch]) => {
          const type = index.byId.get(materialId) ?? { id: materialId, zh: `Type ${materialId}`, en: `Type ${materialId}`, volume: 0, portionSize: 1, kind: 'material' as const, groupId: 0, skillId: 0, materials: [] };
          const quantity = outputQuantity(batches, perBatch, yieldValue);
          const unitPrices = priceValues(markets[String(materialId)]);
          const values = PRICE_MODES.reduce((result, mode) => ({ ...result, [mode]: unitPrices[mode] * quantity }), { buy: 0, split: 0, sell: 0 });
          const current = outputMap.get(materialId);
          outputMap.set(materialId, current
            ? { ...current, quantity: current.quantity + quantity, values: PRICE_MODES.reduce((result, mode) => ({ ...result, [mode]: current.values[mode] + values[mode] }), { buy: 0, split: 0, sell: 0 }) }
            : { type, quantity, unitPrices, values });
          return { type, quantity, unitPrices, values };
        });
        const processedValues = PRICE_MODES.reduce((values, mode) => ({
          ...values,
          [mode]: outputs.reduce((sum, output) => sum + output.values[mode], 0) + rawPrices[mode] * remainder,
        }), { buy: 0, split: 0, sell: 0 });
        const allPriced = outputs.every((output) => output.quantity === 0 || output.unitPrices.split > 0) && rawPrices.split > 0;
        const recommended = !allPriced ? 'unknown' : processedValues.split > rawValues.split ? 'reprocess' : 'raw';
        const specialtyLevel = item.type.kind === 'equipment' ? bounded(settings.scrapmetalLevel, 0, 5, 0) : bounded(settings.skillOverrides[String(item.type.skillId)] ?? settings.specialtyLevel, 0, 5, 0);
        return { item, batches, remainder, yieldPercent: yieldValue, specialtyLevel, rawPrices, rawValues, processedValues, outputs, recommended };
      });
      const rawTotals = PRICE_MODES.reduce((values, mode) => ({ ...values, [mode]: rows.reduce((sum, row) => sum + row.rawValues[mode], 0) }), { buy: 0, split: 0, sell: 0 });
      const processedTotals = PRICE_MODES.reduce((values, mode) => ({ ...values, [mode]: rows.reduce((sum, row) => sum + row.processedValues[mode], 0) }), { buy: 0, split: 0, sell: 0 });
      const outputs = Array.from(outputMap.values()).filter((row) => row.quantity > 0).sort((a, b) => b.values.split - a.values.split);
      const missingPrices = Array.from(ids).filter((typeId) => marketPrice(markets[String(typeId)], 'split') <= 0).length;
      setAnalysis({ rows, outputs, rawTotals, processedTotals, delta: processedTotals.split - rawTotals.split, missingPrices, updatedAt: new Date() });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : translate('市场报价加载失败，请重试。', 'Failed to load market prices. Please retry.'));
    } finally {
      if (!controller.signal.aborted) setCalculating(false);
    }
  }

  const relevantSkills = useMemo(() => {
    if (!index) return [];
    return Array.from(new Set(items.filter((item) => item.type.kind !== 'equipment').map((item) => item.type.skillId))).sort((a, b) => (index.skills.get(a) ?? '').localeCompare(index.skills.get(b) ?? '', 'zh-CN'));
  }, [index, items]);

  async function copyOutputs() {
    if (!analysis) return;
    try {
      await navigator.clipboard.writeText(analysis.outputs.filter((row) => row.quantity > 0).map((row) => `${row.type.en}\t${number.format(row.quantity)}`).join('\n'));
      setCopied(true);
    } catch { setError(translate('无法自动复制，请允许浏览器使用剪贴板。', 'Automatic copy failed. Allow clipboard access in your browser.')); }
  }

  const selectedFacility = FACILITIES.find((facility) => facility.id === settings.facility);
  const selectedCombinedRig = RIGS.find((rig) => rig.id === settings.combinedRig);
  const rigSummary = settings.facility === 'tatara'
    ? `${translate('综合改装件', 'Combined rig')} ${selectedCombinedRig ? rigTierLabel(selectedCombinedRig) : translate('无', 'None')}`
    : settings.facility === 'athanor'
      ? `${translate('普矿', 'Ore')} ${settings.asteroidRig.toUpperCase()} · ${translate('月矿', 'Moon ore')} ${settings.moonRig.toUpperCase()} · ${translate('冰矿', 'Ice')} ${settings.iceRig.toUpperCase()}`
      : translate('不使用建筑改装件', 'No structure rig');

  return (
    <main className="site-shell min-h-screen text-foreground">
      <header className="site-header border-b border-border/80 bg-card/80 backdrop-blur-xl">
        <div className="site-header-grid mx-auto max-w-[1500px] px-4 py-4 sm:px-7">
          <div className="flex items-center gap-3"><div className="brand-mark grid size-10 place-items-center border border-cyan-400/40 bg-cyan-400/10 text-cyan-300"><FlaskConical className="size-5" /></div><div><p className="glory-wordmark font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Glory Navy</p><h1 className="text-lg font-semibold tracking-tight">{translate('重处理与化矿中心', 'Reprocessing Center')}</h1></div></div>
          <ServerStatus />
          <ToolNavigation active="reprocessing" onSelect={onSwitch} />
        </div>
      </header>

      <div className="site-content mx-auto max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">
        <section className="hud-panel mb-5 flex flex-wrap items-center justify-between gap-3 border border-border bg-card/80 p-4"><div><h2 className="text-sm font-semibold">{translate('普矿 · 月矿 · 冰矿 · 装备回收', 'Ore · Moon ore · Ice · Equipment recycling')}</h2><p className="mt-1 text-sm text-muted-foreground">{translate('粘贴清单，选择设施与技能，计算产物和价值。', 'Paste a list, choose your facility and skills, then calculate outputs and value.')}</p></div><Badge variant="outline">SDE {index?.sde ?? '—'}</Badge></section>

        {dataError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-amber-400/25 bg-amber-400/5 p-4 text-sm text-amber-100"><span>{translate('重处理数据库载入失败。', 'The reprocessing database failed to load.')} {dataError}</span><Button variant="outline" disabled={loadingData} onClick={() => { setLoadingData(true); setDataError(''); setDataAttempt((value) => value + 1); }}>{translate('重试载入', 'Retry loading')}</Button></div>}
        {error && <div role="alert" className="mb-5 flex gap-3 border border-red-400/25 bg-red-400/8 p-4 text-sm text-red-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</div>}

        <section className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(390px,.65fr)]">
          <div className="hud-panel border border-border bg-card/80 p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between gap-3"><label htmlFor="reprocessing-input" className="text-sm font-medium">{translate('粘贴待处理物品', 'Paste items to process')}</label><span className="text-xs text-muted-foreground">{translate('中文、英文、Type ID · 每行一项', 'Chinese, English or Type ID · one item per line')}</span></div>
            <Textarea id="reprocessing-input" value={input} onChange={(event) => { invalidate(); setInput(event.target.value); }} placeholder={translate('Veldspar    100000\n月矿名称    数量\nRifter    1', 'Veldspar    100000\nMoon ore name    quantity\nRifter    1')} className="field-sizing-fixed h-72 min-h-48 max-h-[36rem] resize-y overflow-y-auto font-mono text-sm leading-6 lg:h-[32rem]" />
            <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => { invalidate(); setInput(SAMPLE); }}><PackageOpen data-icon="inline-start" />{translate('载入混合示例', 'Load mixed example')}</Button><Button variant="ghost" size="sm" onClick={() => { invalidate(); setInput(''); setItems([]); setUnmatched([]); }}><RotateCcw data-icon="inline-start" />{translate('清空', 'Clear')}</Button></div>
          </div>

          <aside className="hud-panel border border-border bg-card/80 p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.16em] text-violet-300">Facility & skills</p><h2 className="mt-1 text-lg font-semibold">{translate('设施与技能', 'Facility and skills')}</h2></div><div className="flex border border-border bg-background/40 p-0.5"><Button type="button" size="sm" variant={!advanced ? 'secondary' : 'ghost'} onClick={() => setAdvanced(false)}>{translate('简单', 'Simple')}</Button><Button type="button" size="sm" variant={advanced ? 'secondary' : 'ghost'} onClick={() => setAdvanced(true)}>{translate('高级', 'Advanced')}</Button></div></div>
            <Button className="xl:sticky xl:top-[var(--tool-header-clearance)] z-10 mb-4 h-10 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300" onClick={() => void calculate()} disabled={calculating || loadingData || !index}><RefreshCw className={calculating ? 'animate-spin' : ''} data-icon="inline-start" />{loadingData ? translate('载入重处理数据库', 'Loading reprocessing database') : calculating ? loadingStage : translate('解析并计算重处理', 'Parse and calculate')}</Button>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField className="sm:col-span-2" label={translate('估值市场 · 默认吉他', 'Valuation market · Jita by default')} value={settings.region} onChange={(value) => updateSettings({ region: value })}>{MARKETS.map((market) => <NativeSelectOption key={market.id} value={market.id}>{market.name}</NativeSelectOption>)}</SelectField>
              <SelectField className="sm:col-span-2" label={translate('建筑', 'Facility')} value={settings.facility} onChange={(value) => updateSettings({ facility: value as Facility })}>{FACILITIES.map((facility) => <NativeSelectOption key={facility.id} value={facility.id}>{facilityLabel(facility)}</NativeSelectOption>)}</SelectField>
              {settings.facility === 'custom' && <NumberField className="sm:col-span-2" label={translate('自定义矿石/冰矿设施收率', 'Custom ore/ice facility yield')} value={settings.customFacilityYield} onChange={(value) => updateSettings({ customFacilityYield: value })} suffix="%" />}
              {(settings.facility === 'athanor' || settings.facility === 'tatara') && <SelectField className="sm:col-span-2" label={translate('建筑所在安全等级', 'Structure security band')} value={settings.security} onChange={(value) => updateSettings({ security: value as SecurityBand })}>{SECURITY.map((band) => <NativeSelectOption key={band.id} value={band.id}>{securityLabel(band)}</NativeSelectOption>)}</SelectField>}
              {settings.facility === 'athanor' && <><SelectField label={translate('普矿改装件', 'Ore rig')} value={settings.asteroidRig} onChange={(value) => updateSettings({ asteroidRig: value as RigTier })}>{RIGS.map((rig) => <NativeSelectOption key={rig.id} value={rig.id}>{rigTierLabel(rig)}</NativeSelectOption>)}</SelectField><SelectField label={translate('月矿改装件', 'Moon ore rig')} value={settings.moonRig} onChange={(value) => updateSettings({ moonRig: value as RigTier })}>{RIGS.map((rig) => <NativeSelectOption key={rig.id} value={rig.id}>{rigTierLabel(rig)}</NativeSelectOption>)}</SelectField><SelectField className="sm:col-span-2" label={translate('冰矿改装件', 'Ice rig')} value={settings.iceRig} onChange={(value) => updateSettings({ iceRig: value as RigTier })}>{RIGS.map((rig) => <NativeSelectOption key={rig.id} value={rig.id}>{rigTierLabel(rig)}</NativeSelectOption>)}</SelectField></>}
              {settings.facility === 'tatara' && <SelectField className="sm:col-span-2" label={translate('综合提炼监控改装件', 'Combined reprocessing rig')} value={settings.combinedRig} onChange={(value) => updateSettings({ combinedRig: value as RigTier })}>{RIGS.map((rig) => <NativeSelectOption key={rig.id} value={rig.id}>{rigTierLabel(rig)}</NativeSelectOption>)}</SelectField>}
              <NumberField label={bilingualName('提炼学概论', 'Reprocessing')} value={settings.reprocessingLevel} onChange={(value) => updateSettings({ reprocessingLevel: value })} suffix={translate('级', 'Lv.')} max="5" />
              <NumberField label={bilingualName('提炼效率理论', 'Reprocessing Efficiency')} value={settings.efficiencyLevel} onChange={(value) => updateSettings({ efficiencyLevel: value })} suffix={translate('级', 'Lv.')} max="5" />
              <NumberField label={translate('专项处理技能（默认）', 'Specialized processing (default)')} value={settings.specialtyLevel} onChange={(value) => updateSettings({ specialtyLevel: value })} suffix={translate('级', 'Lv.')} max="5" />
              <NumberField label={bilingualName('碎铁处理技术（装备）', 'Scrapmetal Processing (equipment)')} value={settings.scrapmetalLevel} onChange={(value) => updateSettings({ scrapmetalLevel: value })} suffix={translate('级', 'Lv.')} max="5" />
              <SelectField className="sm:col-span-2" label={translate('提炼植入体（仅矿石和冰矿）', 'Reprocessing implant (ore and ice only)')} value={settings.implant} onChange={(value) => updateSettings({ implant: value })}><NativeSelectOption value="0">{translate('无', 'None')}</NativeSelectOption><NativeSelectOption value="1">RX-801 (+1%)</NativeSelectOption><NativeSelectOption value="2">RX-802 (+2%)</NativeSelectOption><NativeSelectOption value="4">RX-804 (+4%)</NativeSelectOption></SelectField>
            </div>
            <div className="mt-3 border border-cyan-400/15 bg-cyan-400/5 p-3 text-xs leading-5 text-muted-foreground"><p className="font-medium text-cyan-100">{selectedFacility ? facilityLabel(selectedFacility) : ''}</p><p>{rigSummary}</p><p>{translate('装备回收固定使用 50% 设施基础值，只受碎铁处理技术影响。', 'Equipment recycling uses a fixed 50% facility base and is affected only by Scrapmetal Processing.')}</p></div>
            {advanced && <div className="mt-3 border-t border-border/70 pt-3"><p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-violet-300">{translate('按清单覆盖专项技能', 'Override specialized skills')}</p>{relevantSkills.length === 0 ? <p className="text-xs leading-5 text-muted-foreground">{translate('先解析一次清单，这里会列出清单实际使用的普矿、月矿和冰矿专项技能。', 'Calculate a list once to show the ore, moon ore and ice skills it actually uses.')}</p> : <div className="grid gap-3 sm:grid-cols-2">{relevantSkills.map((skillId) => <NumberField key={skillId} label={index?.skills.get(skillId) ?? `Skill ${skillId}`} value={settings.skillOverrides[String(skillId)] ?? settings.specialtyLevel} onChange={(value) => updateSettings({ skillOverrides: { ...settings.skillOverrides, [String(skillId)]: value } })} suffix={translate('级', 'Lv.')} max="5" />)}</div>}</div>}

            <Button className="xl:hidden mt-4 h-10 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300" onClick={() => void calculate()} disabled={calculating || loadingData || !index}><RefreshCw className={calculating ? 'animate-spin' : ''} data-icon="inline-start" />{loadingData ? translate('载入重处理数据库', 'Loading reprocessing database') : calculating ? loadingStage : translate('解析并计算重处理', 'Parse and calculate')}</Button>
          </aside>
        </section>

        {unmatched.length > 0 && <div className="mb-6 border border-amber-400/25 bg-amber-400/8 p-4"><p className="mb-2 text-sm font-medium text-amber-200">{translate(`未识别 ${unmatched.length} 行`, `${unmatched.length} unrecognized lines`)}</p><p className="whitespace-pre-wrap font-mono text-xs text-amber-100/75">{unmatched.slice(0, 20).join('\n')}</p></div>}

        {analysis && <>
          <section ref={resultTotals} tabIndex={-1} className="tool-result-anchor mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard icon={<Mountain />} label={translate('原物中间价', 'Raw split value')} value={formatIsk(analysis.rawTotals.split)} meta={translate(`${analysis.rows.length} 种待处理物品`, `${analysis.rows.length} input types`)} />
            <SummaryCard icon={<FlaskConical />} label={translate('产物中间价', 'Output split value')} value={formatIsk(analysis.processedTotals.split)} meta={translate('包含不足一批的剩余原物', 'Includes raw quantities below one batch')} accent />
            <SummaryCard icon={<Gem />} label={translate('重处理价值差', 'Reprocessing delta')} value={`${analysis.delta >= 0 ? '+' : ''}${formatIsk(analysis.delta)}`} meta={analysis.delta >= 0 ? translate('重处理后价值更高', 'Reprocessing is worth more') : translate('出售原物价值更高', 'Selling raw is worth more')} negative={analysis.delta < 0} />
            <SummaryCard icon={<IceCreamBowl />} label={translate('汇总产物', 'Combined outputs')} value={`${analysis.outputs.length} ${translate('种', 'types')}`} meta={analysis.missingPrices ? translate(`缺 ${analysis.missingPrices} 项市场价`, `${analysis.missingPrices} market prices missing`) : translate('市场报价完整', 'All market prices available')} />
          </section>

          <section id="reprocessing-outputs" className="tool-table-scroll tool-result-anchor mb-6 hud-panel overflow-hidden border border-border bg-card/85">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div><h2 className="font-semibold">{translate('重处理产物汇总', 'Reprocessing output summary')}</h2><p className="mt-1 text-xs text-muted-foreground">{translate('可直接复制为游戏多买清单。', 'Copy directly as an EVE multibuy list.')}</p></div><Button variant="outline" size="sm" onClick={() => void copyOutputs()}>{copied ? <Check data-icon="inline-start" /> : <ClipboardCopy data-icon="inline-start" />}{copied ? translate('已复制', 'Copied') : translate('复制产物清单', 'Copy output list')}</Button></div>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-muted/25 hover:bg-muted/25"><TableHead className="min-w-64 pl-4">{translate('产物', 'Output')}</TableHead><TableHead className="text-right">{translate('数量', 'Quantity')}</TableHead><TableHead className="text-right">{translate('买单总值', 'Buy value')}</TableHead><TableHead className="text-right">{translate('中间总值', 'Split value')}</TableHead><TableHead className="pr-4 text-right">{translate('卖单总值', 'Sell value')}</TableHead></TableRow></TableHeader><TableBody>{analysis.outputs.filter((row) => row.quantity > 0).map((row) => <TableRow key={row.type.id}><TableCell className="pl-4"><div className="flex items-center gap-3"><EveTypeIcon typeId={row.type.id} /><span className="font-medium text-slate-100">{bilingual(row.type)}</span></div></TableCell><TableCell className="text-right font-mono">{number.format(row.quantity)}</TableCell><TableCell className="text-right font-mono">{formatIsk(row.values.buy)}</TableCell><TableCell className="text-right font-mono text-cyan-200">{formatIsk(row.values.split)}</TableCell><TableCell className="pr-4 text-right font-mono">{formatIsk(row.values.sell)}</TableCell></TableRow>)}</TableBody></Table></div>
          </section>

          <section className="tool-table-scroll hud-panel mb-6 overflow-hidden border border-border bg-card/85">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div><h2 className="font-semibold">{translate('逐项重处理', 'Item breakdown')}</h2><p className="mt-1 text-xs text-muted-foreground">{translate('收率按每件物品对应的专项技能计算；不足一个 SDE 批次的数量保留为原物。', 'Yield uses the specialized skill for each item. Quantities below one SDE batch remain as raw items.')}</p></div><Badge variant="outline">SDE {index?.sde}</Badge></div>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-muted/25 hover:bg-muted/25"><TableHead className="min-w-72 pl-4">{translate('物品', 'Item')}</TableHead><TableHead className="text-right">{translate('数量 / 批次', 'Quantity / batches')}</TableHead><TableHead className="text-right">{translate('实际收率', 'Actual yield')}</TableHead><TableHead className="text-right">{translate('原物中间价', 'Raw split value')}</TableHead><TableHead className="text-right">{translate('处理后中间价', 'Processed split')}</TableHead><TableHead className="pr-4 text-right">{translate('建议', 'Recommendation')}</TableHead></TableRow></TableHeader><TableBody>{analysis.rows.map((row) => <TableRow key={row.item.type.id}><TableCell className="pl-4"><div className="flex items-center gap-3"><EveTypeIcon typeId={row.item.type.id} /><div><p className="font-medium text-slate-100">{bilingual(row.item.type)}</p><p className="mt-1 text-xs text-muted-foreground"><Badge variant="outline" className="mr-2 h-5 px-1.5 text-[10px]">{kindLabel(row.item.type.kind as Exclude<ReprocessingKind, 'material'>)}</Badge>{index?.groups.get(row.item.type.groupId)} · {index?.skills.get(row.item.type.skillId)} Lv.{row.specialtyLevel}</p></div></div></TableCell><TableCell className="text-right font-mono"><p>{number.format(row.item.quantity)}</p><p className="text-xs text-muted-foreground">{number.format(row.batches)} {translate('批', 'batches')}{row.remainder ? translate(` · 余 ${number.format(row.remainder)}`, ` · remainder ${number.format(row.remainder)}`) : ''}</p></TableCell><TableCell className="text-right font-mono text-cyan-200">{formatPercent(row.yieldPercent)}</TableCell><TableCell className="text-right font-mono">{row.rawPrices.split > 0 ? formatIsk(row.rawValues.split) : translate('缺价', 'No price')}</TableCell><TableCell className="text-right font-mono">{formatIsk(row.processedValues.split)}</TableCell><TableCell className="pr-4 text-right"><Badge variant="outline" className={row.recommended === 'reprocess' ? 'border-cyan-400/30 text-cyan-200' : 'border-emerald-400/30 text-emerald-200'}>{row.recommended === 'unknown' ? translate('缺价待定', 'Price needed') : row.recommended === 'reprocess' ? row.item.type.kind === 'equipment' ? translate('回收', 'Recycle') : translate('化矿', 'Reprocess') : translate('卖原物', 'Sell raw')}</Badge></TableCell></TableRow>)}</TableBody></Table></div>
          </section>
        </>}

        <footer className="flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><p>{translate('配方、批量、技能与设施参数：', 'Recipes, batch sizes, skills and facility data: ')}{index?.source ?? 'CCP SDE'}; {translate('市场报价：', 'market prices: ')}Fuzzwork.</p><p>{analysis ? translate(`计算于 ${analysis.updatedAt.toLocaleTimeString(languageLocale(), { hour: '2-digit', minute: '2-digit' })}`, `Calculated ${analysis.updatedAt.toLocaleTimeString(languageLocale(), { hour: '2-digit', minute: '2-digit' })}`) : translate(`${index?.count ?? 0} 种可重处理物品`, `${index?.count ?? 0} reprocessable item types`)}</p></footer>
      </div>
    </main>
  );
}

function SelectField({ label, value, onChange, children, className = '' }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; className?: string }) {
  return <label className={`field-block ${className}`}><span>{localizedPair(label)}</span><NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>{children}</NativeSelect></label>;
}

function NumberField({ label, value, onChange, suffix, max = '100', className = '' }: { label: string; value: string; onChange: (value: string) => void; suffix?: string; max?: string; className?: string }) {
  return <label className={`field-block ${className}`}><span className="truncate" title={localizedPair(label)}>{localizedPair(label)}</span><div className="relative"><Input type="number" min="0" max={max} step="1" value={value} onChange={(event) => onChange(event.target.value)} className={suffix ? 'pr-8' : ''} />{suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}</div></label>;
}

function SummaryCard({ icon, label, value, meta, accent = false, negative = false }: { icon: React.ReactNode; label: string; value: string; meta: string; accent?: boolean; negative?: boolean }) {
  return <article className={`hud-card border bg-card/80 p-4 ${accent ? 'border-cyan-400/35' : negative ? 'border-red-400/30' : 'border-border'}`}><div className="mb-3 flex items-center justify-between text-muted-foreground"><span className="text-xs uppercase tracking-[0.12em]">{label}</span><span className="[&_svg]:size-4">{icon}</span></div><p className={`font-mono text-xl font-semibold ${negative ? 'text-red-300' : accent ? 'text-cyan-200' : 'text-slate-100'}`}>{value}</p><p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p></article>;
}
