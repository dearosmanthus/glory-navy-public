'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';
import { cachedJson } from '@/lib/static-json';
import { revealToolResult } from '@/lib/tool-flow';
import { MARKETS, marketPrice, marketUrl, type MarketMap } from '@/lib/eve-market';
import {
  Boxes,
  Calculator,
  ChevronRight,
  ClipboardCopy,
  Clock3,
  Coins,
  Factory,
  FlaskConical,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import EveTypeIcon from './eve-type-icon';
import { bilingualName, formatLocalizedNumber, languageLocale, translate, useLanguage } from './language-provider';
import ServerStatus from './server-status';
import ToolNavigation, { type ToolId } from './tool-navigation';
import { buildProductionGraph, scheduleProduction, type FacilityProfile, type PlanningPreferences } from '@/lib/industry-planning';
import { DEFAULT_PLANNING, IndustryScheduleResults, IndustryScheduleSetup, planningError, restorePlanning } from './industry-schedule';

type CompactIndustryType = [
  id: number,
  zh: string,
  en: string,
  volume: number,
  groupId: number,
  categoryId: number,
  metaGroupId: number,
];
type CompactGroup = [id: number, zh: string, en: string, categoryId: number];
type CompactRig = [id: number, zh: string, en: string, size: number, tech: number, material: number, time: number];
type CompactRecipe = [
  productId: number,
  blueprintId: number,
  outputQuantity: number,
  time: number,
  activity: 0 | 1,
  groupId: number,
  materials: Array<[typeId: number, quantity: number]>,
  skills: Array<[typeId: number, level: number]>,
];
type IndustryPayload = {
  schema: number;
  source: string;
  sde: number;
  types: CompactIndustryType[];
  groups: CompactGroup[];
  recipes: CompactRecipe[];
  rigs: CompactRig[];
};
type IndustryType = {
  id: number;
  zh: string;
  en: string;
  volume: number;
  groupId: number;
  categoryId: number;
  metaGroupId: number;
};
type Recipe = {
  productId: number;
  blueprintId: number;
  outputQuantity: number;
  time: number;
  activity: 0 | 1;
  groupId: number;
  materials: Array<[number, number]>;
  skills: Array<[number, number]>;
};
type IndustryIndex = {
  byType: Map<number, IndustryType>;
  recipes: Map<number, Recipe>;
  groups: Map<number, string>;
  catalog: Recipe[];
  rigs: IndustryRig[];
  source: string;
  sde: number;
};
type IndustryRig = {
  id: number;
  zh: string;
  en: string;
  size: number;
  tech: number;
  material: number;
  time: number;
};
type PlanItem = { key: number; productId: number; quantity: string; me: string; te: string };
type PriceMode = 'buy' | 'split' | 'sell';
type ExpansionMode = 'direct' | 'one' | 'all';
type FacilityPreset = 'custom' | 'npc' | 'raitaru' | 'azbel' | 'sotiyo';
type SecurityBand = 'high' | 'low' | 'null';
type SavedIndustrySettings = {
  region: string;
  materialPrice: PriceMode;
  productPrice: PriceMode;
  expansion: ExpansionMode;
  componentMe: string;
  componentTe: string;
  materialBonus: string;
  timeBonus: string;
  skillTimeBonus: string;
  facilityPreset: FacilityPreset;
  securityBand: SecurityBand;
  materialRigId: string;
  timeRigId: string;
  combinedRigId: string;
  structureMaterialBonus: string;
  structureTimeBonus: string;
  structureJobCostBonus: string;
  systemCostIndex: string;
  facilityTax: string;
  reactionMaterialBonus: string;
  reactionTimeBonus: string;
  reactionSkillTimeBonus: string;
  reactionStructureTimeBonus: string;
  reactionStructureJobCostBonus: string;
  reactionCostIndex: string;
  reactionFacilityTax: string;
};
type JobRow = {
  key: string;
  planningId: string;
  recipe: Recipe;
  product: IndustryType;
  level: number;
  runs: number;
  produced: number;
  materialEfficiency: number;
  timeEfficiency: number;
  duration: number | null;
  jobFee: number;
  estimatedItemValue: number;
  systemCostFee: number;
  structureCostAdjustment: number;
  facilityTaxAmount: number;
  sccSurcharge: number;
  highestBuyPrice: number;
  lowestSellPrice: number;
};
type MaterialRow = {
  type: IndustryType;
  quantity: number;
  unitPrice: number;
  highestBuyPrice: number;
  lowestSellPrice: number;
  value: number;
};
type OutputRow = {
  type: IndustryType;
  requested: number;
  produced: number;
  unitPrice: number;
  highestBuyPrice: number;
  lowestSellPrice: number;
  value: number;
};
type Calculation = {
  jobs: JobRow[];
  materials: MaterialRow[];
  outputs: OutputRow[];
  materialCost: number;
  jobFees: number;
  estimatedItemValue: number;
  systemCostFees: number;
  structureCostAdjustments: number;
  facilityTaxes: number;
  sccSurcharges: number;
  revenue: number;
  profit: number;
  margin: number | null;
  missingMaterialPrices: number;
  missingOutputPrices: number;
  calculatedAt: Date;
};

const SETTINGS_KEY = 'glory-navy.industry.settings.v2';
const SCC_SURCHARGE_RATE = 0.04;
const integer = { format: (value: number) => formatLocalizedNumber(value, { maximumFractionDigits: 0 }) };
const decimal = { format: (value: number) => formatLocalizedNumber(value, { maximumFractionDigits: 2 }) };
const compact = { format: (value: number) => formatLocalizedNumber(value, { notation: 'compact', maximumFractionDigits: 2 }) };

const DEFAULT_SETTINGS: SavedIndustrySettings = {
  region: '10000002',
  materialPrice: 'sell',
  productPrice: 'buy',
  expansion: 'direct',
  componentMe: '0',
  componentTe: '0',
  materialBonus: '0',
  timeBonus: '0',
  skillTimeBonus: '0',
  facilityPreset: 'npc',
  securityBand: 'high',
  materialRigId: 'none',
  timeRigId: 'none',
  combinedRigId: 'none',
  structureMaterialBonus: '0',
  structureTimeBonus: '0',
  structureJobCostBonus: '0',
  systemCostIndex: '0',
  facilityTax: '0',
  reactionMaterialBonus: '0',
  reactionTimeBonus: '0',
  reactionSkillTimeBonus: '0',
  reactionStructureTimeBonus: '0',
  reactionStructureJobCostBonus: '0',
  reactionCostIndex: '0',
  reactionFacilityTax: '0',
};

const FACILITY_PRESETS: Array<{ id: FacilityPreset; zh: string; en: string; material: string; time: string; cost: string }> = [
  { id: 'npc', zh: 'NPC 空间站', en: 'NPC station', material: '0', time: '0', cost: '0' },
  { id: 'raitaru', zh: '莱塔卢（中型工程复合体）', en: 'Raitaru (medium engineering complex)', material: '1', time: '15', cost: '3' },
  { id: 'azbel', zh: '阿兹贝尔（大型工程复合体）', en: 'Azbel (large engineering complex)', material: '1', time: '20', cost: '4' },
  { id: 'sotiyo', zh: '索迪约（超大型工程复合体）', en: 'Sotiyo (XL engineering complex)', material: '1', time: '30', cost: '5' },
  { id: 'custom', zh: '自定义建筑', en: 'Custom structure', material: '0', time: '0', cost: '0' },
];

const SECURITY_BANDS: Array<{ id: SecurityBand; name: string; multiplier: number }> = [
  { id: 'high', name: '高安 / High sec（×1.0）', multiplier: 1 },
  { id: 'low', name: '低安 / Low sec（×1.9）', multiplier: 1.9 },
  { id: 'null', name: '零安与虫洞 / Null sec & wormhole（×2.1）', multiplier: 2.1 },
];

function rigBonus(rigId: string, kind: 'material' | 'time', securityBand: SecurityBand, index: IndustryIndex | null) {
  if (rigId === 'none') return '0';
  if (rigId === 'custom') return null;
  const rig = index?.rigs.find((item) => item.id === Number(rigId));
  if (!rig) return '0';
  const securityMultiplier = SECURITY_BANDS.find((band) => band.id === securityBand)?.multiplier ?? 1;
  const base = kind === 'material' ? rig.material : rig.time;
  return String(Math.round(base * securityMultiplier * 100) / 100);
}

function normalize(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function bilingual(type: IndustryType | undefined) {
  if (!type) return translate('未知物品', 'Unknown item');
  return bilingualName(type.zh, type.en);
}

function localizedPair(value: string) {
  const separator = value.indexOf(' / ');
  return separator < 0 ? value : translate(value.slice(0, separator), value.slice(separator + 3));
}

function facilityPresetLabel(preset: (typeof FACILITY_PRESETS)[number]) {
  return bilingualName(preset.zh, preset.en);
}

function skillRequirements(recipe: Recipe, index: IndustryIndex | null) {
  if (recipe.skills.length === 0) return translate('无额外技能要求', 'No additional skill requirement');
  return recipe.skills.map(([typeId, level]) => `${bilingual(index?.byType.get(typeId))} Lv.${level}`).join(' · ');
}

function signedReduction(value: string | number) {
  const number = typeof value === 'number' ? value : bounded(value, 0, 99, 0);
  return number > 0 ? `-${decimal.format(number)}%` : '0%';
}

function rigLabel(rig: IndustryRig) {
  const bonuses = [rig.material > 0 ? translate(`材料 -${rig.material}%`, `Material -${rig.material}%`) : '', rig.time > 0 ? translate(`时间 -${rig.time}%`, `Time -${rig.time}%`) : ''].filter(Boolean).join(' · ');
  return `${bilingualName(rig.zh, rig.en)} (${bonuses})`;
}

function bounded(value: string, minimum: number, maximum: number, fallback = minimum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function formatIsk(value: number) {
  return Number.isFinite(value) ? `${compact.format(value)} ISK` : '—';
}

function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return translate('0 秒', '0 sec');
  const seconds = Math.round(totalSeconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(translate(`${days} 天`, `${days}d`));
  if (hours) parts.push(translate(`${hours} 小时`, `${hours}h`));
  if (minutes || parts.length === 0) parts.push(translate(`${minutes} 分钟`, `${minutes}m`));
  return parts.join(' ');
}

function priceModeLabel(mode: PriceMode, purpose: 'material' | 'product') {
  if (mode === 'split') return translate('买卖中间价（估算）', 'Buy/sell midpoint (estimate)');
  if (purpose === 'material') return mode === 'sell' ? translate('最低卖单（立即买入）', 'Lowest sell (immediate buy)') : translate('最高买单（挂单收购参考）', 'Highest buy (purchase order reference)');
  return mode === 'buy' ? translate('最高买单（立即卖出）', 'Highest buy (immediate sale)') : translate('最低卖单（挂单出售参考）', 'Lowest sell (sell order reference)');
}

function priceModeShort(mode: PriceMode) {
  if (mode === 'buy') return translate('最高买单', 'Highest buy');
  if (mode === 'sell') return translate('最低卖单', 'Lowest sell');
  return translate('买卖中间价', 'Buy/sell midpoint');
}

function blueprintTimeSummary(jobs: JobRow[]) {
  const values = Array.from(new Set(jobs.filter((job) => job.recipe.activity === 0).map((job) => job.timeEfficiency))).sort((a, b) => a - b);
  return values.length > 0 ? values.map((value) => signedReduction(value)).join(' / ') : translate('不适用', 'N/A');
}

function decodePayload(payload: IndustryPayload): IndustryIndex {
  const byType = new Map<number, IndustryType>();
  for (const [id, zh, en, volume, groupId, categoryId, metaGroupId] of payload.types) {
    byType.set(id, { id, zh, en, volume, groupId, categoryId, metaGroupId });
  }
  const groups = new Map<number, string>();
  for (const [id, zh, en] of payload.groups) groups.set(id, zh === en ? zh : `${zh}（${en}）`);
  const recipes = new Map<number, Recipe>();
  for (const [productId, blueprintId, outputQuantity, time, activity, groupId, materials, skills] of payload.recipes) {
    if (!recipes.has(productId)) recipes.set(productId, { productId, blueprintId, outputQuantity, time, activity, groupId, materials, skills: skills ?? [] });
  }
  const catalog = Array.from(recipes.values()).sort((a, b) => {
    const left = byType.get(a.productId)?.zh ?? '';
    const right = byType.get(b.productId)?.zh ?? '';
    return left.localeCompare(right, 'zh-CN');
  });
  const rigs = (payload.rigs ?? []).map(([id, zh, en, size, tech, material, time]) => ({ id, zh, en, size, tech, material, time }));
  return { byType, recipes, groups, catalog, rigs, source: payload.source, sde: payload.sde };
}

export default function IndustryTool({
  onSwitch,
}: {
  onSwitch: (tool: ToolId) => void;
}) {
  const { language } = useLanguage();
  const [index, setIndex] = useState<IndustryIndex | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [dataAttempt, setDataAttempt] = useState(0);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'all' | 'manufacturing' | 'reaction'>('all');
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [settings, setSettings] = useState<SavedIndustrySettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [advancedSettings, setAdvancedSettings] = useState(false);
  const [calculation, setCalculation] = useState<Calculation | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [copied, setCopied] = useState(false);
  const [planning, setPlanning] = useState<PlanningPreferences>(DEFAULT_PLANNING);
  const [scheduleRequested, setScheduleRequested] = useState(false);
  const request = useRef<AbortController | null>(null);
  const resultTotals = useRef<HTMLElement | null>(null);
  useEffect(() => { if (calculation) revealToolResult(resultTotals.current); }, [calculation]);
  const adjustedPriceCache = useRef<{ fetchedAt: number; values: Map<number, number> } | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<SavedIndustrySettings> | null;
      // oxlint-disable-next-line react/react-compiler -- Hydrate persisted user settings after the browser mounts.
      if (saved) {
        const restored = { ...DEFAULT_SETTINGS, ...saved };
        const facility = FACILITY_PRESETS.find((preset) => preset.id === restored.facilityPreset) ?? FACILITY_PRESETS[0];
        if (saved.structureMaterialBonus === undefined) restored.structureMaterialBonus = facility.material;
        if (saved.materialRigId === undefined && Number(saved.materialBonus) > 0) restored.materialRigId = 'custom';
        if (saved.timeRigId === undefined && Number(saved.timeBonus) > 0) restored.timeRigId = 'custom';
        if (saved.combinedRigId === undefined && restored.facilityPreset !== 'raitaru' && (Number(saved.materialBonus) > 0 || Number(saved.timeBonus) > 0)) restored.combinedRigId = 'custom';
        // oxlint-disable-next-line react/react-compiler -- Hydrate persisted user settings after the browser mounts.
        setSettings(restored);
      }
      // oxlint-disable-next-line react/react-compiler -- Restore optional local planning preferences.
      setPlanning(restorePlanning(JSON.parse(window.localStorage.getItem('glory-navy.industry.planning.v1') ?? 'null')));
    } catch {
      // Ignore broken local settings and continue with safe defaults.
    }
    // oxlint-disable-next-line react/react-compiler -- Mark local-storage hydration complete after the browser mounts.
    setSettingsLoaded(true);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      window.localStorage.setItem('glory-navy.industry.planning.v1', JSON.stringify(planning));
    } catch {
      // Storage may be blocked or full; calculation remains usable in this session.
    }
  }, [settings, settingsLoaded, planning]);

  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- This effect owns the data request lifecycle.
    setLoadingData(true);
    // oxlint-disable-next-line react/react-compiler -- Clear stale request errors before retrying.
    setError('');
    let cancelled = false;
    cachedJson<IndustryPayload>('/industry-data.json?v=20260908-2')
      .then((payload) => { if (!cancelled) setIndex(decodePayload(payload)); })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : translate('制造数据库加载失败。', 'Failed to load the industry database.'));
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false);
      });
    return () => { cancelled = true; };
  }, [dataAttempt]);

  useEffect(() => () => request.current?.abort(), []);

  const searchResults = useMemo(() => {
    if (!index) return [];
    const needle = normalize(query);
    if (!needle) return [];
    const numeric = /^\d+$/.test(needle) ? Number(needle) : 0;
    return index.catalog
      .filter((recipe) => {
        if (activityFilter === 'manufacturing' && recipe.activity !== 0) return false;
        if (activityFilter === 'reaction' && recipe.activity !== 1) return false;
        const type = index.byType.get(recipe.productId);
        if (!type) return false;
        return numeric === type.id || normalize(`${type.zh} ${type.en}`).includes(needle);
      })
      .slice(0, 12);
  }, [activityFilter, index, query]);

  function invalidate() {
    request.current?.abort();
    setCalculating(false);
    setLoadingStage('');
    setCalculation(null);
    setCopied(false);
    setError('');
  }

  function updateSettings(patch: Partial<SavedIndustrySettings>) {
    invalidate();
    setSettings((current) => ({ ...current, ...patch }));
  }

  function selectFacilityPreset(presetId: FacilityPreset) {
    const preset = FACILITY_PRESETS.find((item) => item.id === presetId) ?? FACILITY_PRESETS[0];
    updateSettings({
      facilityPreset: preset.id,
      structureMaterialBonus: preset.id === 'custom' ? settings.structureMaterialBonus : preset.material,
      structureTimeBonus: preset.id === 'custom' ? settings.structureTimeBonus : preset.time,
      structureJobCostBonus: preset.id === 'custom' ? settings.structureJobCostBonus : preset.cost,
      materialRigId: preset.id === 'custom' ? 'custom' : 'none',
      timeRigId: preset.id === 'custom' ? 'custom' : 'none',
      combinedRigId: preset.id === 'custom' ? 'custom' : 'none',
      materialBonus: preset.id === 'custom' ? settings.materialBonus : '0',
      timeBonus: preset.id === 'custom' ? settings.timeBonus : '0',
    });
  }

  function selectSecurityBand(securityBand: SecurityBand) {
    const materialRigId = settings.facilityPreset === 'raitaru' ? settings.materialRigId : settings.combinedRigId;
    const timeRigId = settings.facilityPreset === 'raitaru' ? settings.timeRigId : settings.combinedRigId;
    updateSettings({
      securityBand,
      materialBonus: rigBonus(materialRigId, 'material', securityBand, index) ?? settings.materialBonus,
      timeBonus: rigBonus(timeRigId, 'time', securityBand, index) ?? settings.timeBonus,
    });
  }

  function selectSeparateRig(kind: 'material' | 'time', rigId: string) {
    updateSettings(kind === 'material'
      ? { materialRigId: rigId, materialBonus: rigBonus(rigId, 'material', settings.securityBand, index) ?? settings.materialBonus }
      : { timeRigId: rigId, timeBonus: rigBonus(rigId, 'time', settings.securityBand, index) ?? settings.timeBonus });
  }

  function selectCombinedRig(rigId: string) {
    updateSettings({
      combinedRigId: rigId,
      materialBonus: rigBonus(rigId, 'material', settings.securityBand, index) ?? settings.materialBonus,
      timeBonus: rigBonus(rigId, 'time', settings.securityBand, index) ?? settings.timeBonus,
    });
  }

  function addProduct(productId: number) {
    if (!index) return;
    const recipe = index.recipes.get(productId);
    if (!recipe) return;
    if (plan.length >= 30) {
      setError(translate('一个生产计划最多添加 30 种产品，请分批计算。', 'A production plan supports up to 30 products. Please split the calculation.'));
      return;
    }
    setPlan((current) => {
      const existing = current.find((item) => item.productId === productId);
      if (existing) {
        return current.map((item) => item.key === existing.key
          ? { ...item, quantity: String(bounded(item.quantity, 1, 1e12, 1) + recipe.outputQuantity) }
          : item);
      }
      return [...current, {
        key: nextKey,
        productId,
        quantity: String(recipe.outputQuantity),
        me: '0',
        te: '0',
      }];
    });
    setNextKey((value) => value + 1);
    setQuery('');
    setSearchOpen(false);
    invalidate();
  }

  function updatePlan(key: number, patch: Partial<PlanItem>) {
    invalidate();
    setPlan((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function removePlan(key: number) {
    invalidate();
    setPlan((current) => current.filter((item) => item.key !== key));
  }

  const graphState = useMemo(() => {
    void language;
    const preset = FACILITY_PRESETS.find((item) => item.id === settings.facilityPreset) ?? FACILITY_PRESETS[0];
    const manufacturing: FacilityProfile = {
      id: 'current-manufacturing', name: facilityPresetLabel(preset), activity: 0, structure: settings.facilityPreset, security: settings.securityBand,
      structureMaterial: bounded(settings.structureMaterialBonus, 0, 99), rigMaterial: bounded(settings.materialBonus, 0, 99),
      structureTime: bounded(settings.structureTimeBonus, 0, 99), rigTime: bounded(settings.timeBonus, 0, 99),
      costReduction: bounded(settings.structureJobCostBonus, 0, 100), costIndex: bounded(settings.systemCostIndex, 0, 100), tax: bounded(settings.facilityTax, 0, 100),
    };
    const reaction: FacilityProfile = {
      id: 'current-reaction', name: translate('反应设施（当前参数）', 'Reaction facility (current settings)'), activity: 1, structure: 'refinery', security: 'unknown',
      structureMaterial: 0, rigMaterial: bounded(settings.reactionMaterialBonus, 0, 99),
      structureTime: bounded(settings.reactionStructureTimeBonus, 0, 99), rigTime: bounded(settings.reactionTimeBonus, 0, 99),
      costReduction: bounded(settings.reactionStructureJobCostBonus, 0, 100), costIndex: bounded(settings.reactionCostIndex, 0, 100), tax: bounded(settings.reactionFacilityTax, 0, 100),
    };
    try {
      const graph = index && plan.length ? buildProductionGraph({ plan, recipes: index.recipes, expansion: settings.expansion, componentMe: bounded(settings.componentMe, 0, 10), componentTe: bounded(settings.componentTe, 0, 20), preferences: planning, manufacturing, reaction, defaultSkills: { manufacturing: bounded(settings.skillTimeBonus, 0, 99), reaction: bounded(settings.reactionSkillTimeBonus, 0, 99) } }) : null;
      return { graph, manufacturing, reaction, error: '' };
    } catch (reason) { return { graph: null, manufacturing, reaction, error: planningError(reason) }; }
    // oxlint-disable-next-line react/react-compiler -- Localization helpers read the active language.
  }, [index, plan, planning, settings, language]);

  const scheduleState = useMemo(() => {
    void language;
    if (!scheduleRequested || !graphState.graph) return { schedule: null, error: '' };
    try {
      return { schedule: scheduleProduction(graphState.graph.nodes, planning.characters, planning.handoffMinutes, { manufacturing: bounded(settings.skillTimeBonus, 0, 99), reaction: bounded(settings.reactionSkillTimeBonus, 0, 99) }), error: '' };
    } catch (reason) { return { schedule: null, error: planningError(reason) }; }
    // oxlint-disable-next-line react/react-compiler -- Error messages follow the active language.
  }, [graphState.graph, planning, scheduleRequested, settings.skillTimeBonus, settings.reactionSkillTimeBonus, language]);

  function updatePlanning(value: PlanningPreferences) {
    invalidate();
    setPlanning(value);
  }

  async function calculate() {
    if (!index) {
      setError(translate('制造数据库尚未加载完成。', 'The industry database is still loading.'));
      return;
    }
    if (plan.length === 0) {
      setError(translate('请先搜索并添加至少一种要制造的产品。', 'Search for and add at least one product first.'));
      return;
    }

    const manufacturingSkillTime = bounded(settings.skillTimeBonus, 0, 99, 0);
    const reactionSkillTime = bounded(settings.reactionSkillTimeBonus, 0, 99, 0);
    if (!graphState.graph) {
      setError(graphState.error || translate('无法展开当前生产计划。', 'Unable to expand the production plan.'));
      return;
    }
    const { rawMaterials, nodes: pendingJobs } = graphState.graph;
    setScheduleRequested(true);
    const outputs = plan.map((item) => {
      const recipe = index.recipes.get(item.productId)!;
      const requested = Math.ceil(bounded(item.quantity, 1, 1e12, 1));
      return { type: index.byType.get(item.productId)!, requested, produced: Math.ceil(requested / recipe.outputQuantity) * recipe.outputQuantity };
    });

    const marketIds = Array.from(new Set([
      ...rawMaterials.keys(),
      ...outputs.map((output) => output.type.id),
      ...pendingJobs.map((job) => job.recipe.productId),
    ]));
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setCalculating(true);
    setLoadingStage(translate(`正在查询 ${integer.format(marketIds.length)} 种物品的市场报价…`, `Fetching market prices for ${integer.format(marketIds.length)} item types…`));
    setError('');

    try {
      let costSchedule = null;
      try {
        costSchedule = scheduleProduction(pendingJobs, planning.characters, planning.handoffMinutes, { manufacturing: manufacturingSkillTime, reaction: reactionSkillTime });
      } catch {
        // Scheduling errors are shown above; they must not prevent material and price calculation.
      }
      const scheduledDurations = new Map<string, number>();
      for (const job of costSchedule?.jobs ?? []) scheduledDurations.set(job.nodeId, (scheduledDurations.get(job.nodeId) ?? 0) + job.end - job.start);
      const [marketResponses, adjusted] = await Promise.all([
        Promise.all(chunks(marketIds, 80).map((group) => fetchJson<MarketMap>(marketUrl(settings.region, group), { signal: controller.signal }, 30_000))),
        loadAdjustedPrices(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const markets = Object.assign({}, ...marketResponses) as MarketMap;

      const materialRows = Array.from(rawMaterials, ([typeId, quantity]) => {
        const type = index.byType.get(typeId) ?? { id: typeId, zh: `Type ${typeId}`, en: `Type ${typeId}`, volume: 0, groupId: 0, categoryId: 0, metaGroupId: 0 };
        const unitPrice = marketPrice(markets[String(typeId)], settings.materialPrice);
        const highestBuyPrice = marketPrice(markets[String(typeId)], 'buy');
        const lowestSellPrice = marketPrice(markets[String(typeId)], 'sell');
        return { type, quantity, unitPrice, highestBuyPrice, lowestSellPrice, value: unitPrice * quantity };
      }).sort((a, b) => b.value - a.value || a.type.zh.localeCompare(b.type.zh, 'zh-CN'));

      const jobRows: JobRow[] = pendingJobs.map((job, position) => {
        const product = index.byType.get(job.recipe.productId) ?? { id: job.recipe.productId, zh: `Type ${job.recipe.productId}`, en: `Type ${job.recipe.productId}`, volume: 0, groupId: 0, categoryId: 0, metaGroupId: 0 };
        const duration = scheduledDurations.get(job.id) ?? null;
        const baseValuePerRun = job.recipe.materials.reduce((sum, [typeId, quantity]) => sum + (adjusted.get(typeId) ?? 0) * quantity, 0);
        const estimatedItemValue = baseValuePerRun * job.runs;
        const costIndex = job.facility.costIndex / 100;
        const facilityTaxRate = job.facility.tax / 100;
        const structureCostBonus = job.facility.costReduction / 100;
        const systemCostFee = estimatedItemValue * costIndex;
        const structureCostAdjustment = -systemCostFee * structureCostBonus;
        const facilityTaxAmount = estimatedItemValue * facilityTaxRate;
        const sccSurcharge = estimatedItemValue * SCC_SURCHARGE_RATE;
        const jobFee = systemCostFee + structureCostAdjustment + facilityTaxAmount + sccSurcharge;
        return {
          ...job,
          key: `${job.recipe.productId}-${job.level}-${position}`,
          planningId: job.id,
          product,
          duration,
          estimatedItemValue,
          systemCostFee,
          structureCostAdjustment,
          facilityTaxAmount,
          sccSurcharge,
          jobFee,
          highestBuyPrice: marketPrice(markets[String(job.recipe.productId)], 'buy'),
          lowestSellPrice: marketPrice(markets[String(job.recipe.productId)], 'sell'),
        };
      });

      const outputRows = outputs.map((output) => {
        const unitPrice = marketPrice(markets[String(output.type.id)], settings.productPrice);
        const highestBuyPrice = marketPrice(markets[String(output.type.id)], 'buy');
        const lowestSellPrice = marketPrice(markets[String(output.type.id)], 'sell');
        return { ...output, unitPrice, highestBuyPrice, lowestSellPrice, value: unitPrice * output.produced };
      });
      const materialCost = materialRows.reduce((sum, row) => sum + row.value, 0);
      const jobFees = jobRows.reduce((sum, row) => sum + row.jobFee, 0);
      const estimatedItemValue = jobRows.reduce((sum, row) => sum + row.estimatedItemValue, 0);
      const systemCostFees = jobRows.reduce((sum, row) => sum + row.systemCostFee, 0);
      const structureCostAdjustments = jobRows.reduce((sum, row) => sum + row.structureCostAdjustment, 0);
      const facilityTaxes = jobRows.reduce((sum, row) => sum + row.facilityTaxAmount, 0);
      const sccSurcharges = jobRows.reduce((sum, row) => sum + row.sccSurcharge, 0);
      const revenue = outputRows.reduce((sum, row) => sum + row.value, 0);
      const profit = revenue - materialCost - jobFees;
      setCalculation({
        jobs: jobRows,
        materials: materialRows,
        outputs: outputRows,
        materialCost,
        jobFees,
        estimatedItemValue,
        systemCostFees,
        structureCostAdjustments,
        facilityTaxes,
        sccSurcharges,
        revenue,
        profit,
        margin: revenue > 0 ? profit / revenue : null,
        missingMaterialPrices: materialRows.filter((row) => row.unitPrice <= 0).length,
        missingOutputPrices: outputRows.filter((row) => row.unitPrice <= 0).length,
        calculatedAt: new Date(),
      });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : translate('制造估价失败，请重试。', 'Industry calculation failed. Please retry.'));
    } finally {
      if (!controller.signal.aborted) {
        setCalculating(false);
        setLoadingStage('');
      }
    }
  }

  async function loadAdjustedPrices(signal: AbortSignal) {
    const cached = adjustedPriceCache.current;
    if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000) return cached.values;
    const payload = await fetchJson<Array<{ type_id: number; adjusted_price?: number }>>('/api/adjusted-prices', { signal }, 30_000);
    const values = new Map(payload.map((price) => [price.type_id, price.adjusted_price ?? 0]));
    adjustedPriceCache.current = { fetchedAt: Date.now(), values };
    return values;
  }

  async function copyShoppingList() {
    if (!calculation) return;
    const text = calculation.materials.map((row) => `${row.type.en}\t${Math.ceil(row.quantity)}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError(translate('无法自动复制，请从材料表中手动复制。', 'Automatic copy failed. Copy from the material table manually.'));
    }
  }

  const mediumMaterialRigs = index?.rigs.filter((rig) => rig.size === 2 && rig.material > 0 && rig.time === 0) ?? [];
  const mediumTimeRigs = index?.rigs.filter((rig) => rig.size === 2 && rig.time > 0 && rig.material === 0) ?? [];
  const combinedRigs = index?.rigs.filter((rig) => rig.size === (settings.facilityPreset === 'azbel' ? 3 : 4) && rig.material > 0 && rig.time > 0) ?? [];
  const selectedMaterialRig = index?.rigs.find((rig) => rig.id === Number(settings.materialRigId));
  const selectedTimeRig = index?.rigs.find((rig) => rig.id === Number(settings.timeRigId));
  const selectedCombinedRig = index?.rigs.find((rig) => rig.id === Number(settings.combinedRigId));
  const selectedFacilityPreset = FACILITY_PRESETS.find((preset) => preset.id === settings.facilityPreset);

  return (
    <main className="site-shell min-h-screen text-foreground">
      <header className="site-header border-b border-border/80 bg-card/80 backdrop-blur-xl">
        <div className="site-header-grid mx-auto max-w-[1500px] px-4 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="brand-mark grid size-10 place-items-center border border-cyan-400/40 bg-cyan-400/10 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,.12)]">
              <Factory className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="glory-wordmark font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Glory Navy</p>
              <h1 className="text-lg font-semibold tracking-tight">{translate('工业制造终端', 'Industry Terminal')}</h1>
            </div>
          </div>
          <ServerStatus />
          <ToolNavigation active="industry" onSelect={onSwitch} />
        </div>
      </header>

      <div className="site-content mx-auto max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">
        <section className="hud-panel mb-5 flex flex-wrap items-center justify-between gap-3 border border-border bg-card/80 p-4"><div><h2 className="text-sm font-semibold">{translate('制造与反应成本', 'Manufacturing & reaction costs')}</h2><p className="mt-1 text-sm text-muted-foreground">{translate('添加成品，填写蓝图 ME / TE，选择直接采购材料或展开生产链。', 'Add products, enter blueprint ME / TE, and choose direct material purchases or an expanded production chain.')}</p></div><Button variant="outline" size="sm" onClick={() => onSwitch('reprocessing')}><FlaskConical />{translate('独立化矿', 'Reprocessing')}</Button></section>

        {error && (
          <div className="mb-5 flex items-start justify-between gap-4 border border-red-400/25 bg-red-400/8 px-4 py-3 text-sm text-red-200">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} aria-label={translate('关闭错误提示', 'Dismiss error')}><X className="size-4" /></button>
          </div>
        )}

        <section className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(370px,.75fr)]">
          <div className="hud-panel min-w-0 border border-border bg-card/80 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-cyan-300">01 / Production queue</p>
                <h2 className="mt-1 text-lg font-semibold">{translate('生产计划', 'Production plan')}</h2>
              </div>
              <Badge variant="outline">{plan.length} / 30 {translate('项', 'items')}</Badge>
            </div>

            <div className="mb-4 grid gap-2 sm:grid-cols-[170px_minmax(0,1fr)]">
              <NativeSelect value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as typeof activityFilter)}>
                <NativeSelectOption value="all">{translate('全部活动', 'All activities')}</NativeSelectOption>
                <NativeSelectOption value="manufacturing">{translate('制造蓝图', 'Manufacturing')}</NativeSelectOption>
                <NativeSelectOption value="reaction">{translate('反应配方', 'Reactions')}</NativeSelectOption>
              </NativeSelect>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && searchResults[0]) addProduct(searchResults[0].productId); }}
                  placeholder={loadingData ? translate('正在载入蓝图数据库…', 'Loading blueprint database…') : translate('搜索成品中文名、英文名或 Type ID…', 'Search by Chinese name, English name or Type ID…')}
                  className="pl-9"
                  disabled={loadingData || !index}
                />
                {searchOpen && query.trim() && (
                  <div className="industry-search-results absolute inset-x-0 top-[calc(100%+6px)] z-30 max-h-80 overflow-y-auto border border-cyan-400/25 bg-popover shadow-2xl shadow-black/50">
                    {searchResults.length > 0 ? searchResults.map((recipe) => {
                      const type = index?.byType.get(recipe.productId);
                      return (
                        <button key={recipe.productId} type="button" onClick={() => addProduct(recipe.productId)} className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left last:border-b-0 hover:bg-cyan-400/8">
                          <EveTypeIcon typeId={recipe.productId} />
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-sm text-slate-100">{bilingual(type)}</strong>
                            <span className="block truncate text-xs text-muted-foreground">{index?.groups.get(recipe.groupId) ?? `Group ${recipe.groupId}`} · {translate('每流程', 'per run')} {integer.format(recipe.outputQuantity)}</span>
                          </span>
                          <Badge variant="outline" className={recipe.activity === 1 ? 'border-violet-400/30 text-violet-200' : 'border-cyan-400/30 text-cyan-200'}>{recipe.activity === 1 ? translate('反应', 'Reaction') : translate('制造', 'Manufacturing')}</Badge>
                          <Plus className="size-4 text-cyan-300" />
                        </button>
                      );
                    }) : <p className="px-3 py-5 text-center text-sm text-muted-foreground">{translate('没有找到可制造成品', 'No manufacturable products found')}</p>}
                  </div>
                )}
              </div>
            </div>

            {loadingData ? (
              <div className="grid min-h-48 place-items-center text-sm text-muted-foreground"><RefreshCw className="mb-3 size-5 animate-spin text-cyan-300" />{translate('载入制造数据库', 'Loading industry database')}</div>
            ) : !index ? (
              <div className="grid min-h-48 place-items-center text-center"><Button variant="outline" onClick={() => setDataAttempt((value) => value + 1)}>{translate('重试载入数据库', 'Retry database')}</Button></div>
            ) : plan.length === 0 ? (
              <div className="industry-empty grid min-h-48 place-items-center border border-dashed border-border/80 px-4 text-center">
                <div><Boxes className="mx-auto mb-3 size-8 text-cyan-300/70" /><p className="font-medium text-slate-200">{translate('搜索并添加要制造的成品', 'Search for products to manufacture')}</p><p className="mt-1 text-xs text-muted-foreground">{translate('支持 4,000+ 制造蓝图与反应配方', 'Supports 4,000+ manufacturing blueprints and reaction formulas')}</p></div>
              </div>
            ) : (
              <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                {plan.map((item) => {
                  const recipe = index.recipes.get(item.productId)!;
                  const type = index.byType.get(item.productId);
                  const runs = Math.ceil(bounded(item.quantity, 1, 1e12, 1) / recipe.outputQuantity);
                  return (
                    <article key={item.key} className="industry-plan-row grid items-end gap-3 border border-border/80 bg-background/35 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_38px] 2xl:grid-cols-[minmax(260px,1.7fr)_110px_110px_110px_38px]">
                      <div className="flex min-w-0 items-center gap-3 sm:col-span-4 2xl:col-span-1">
                        <EveTypeIcon typeId={item.productId} />
                        <div className="min-w-0"><p className="text-sm font-medium text-slate-100">{bilingual(type)}</p><p className="mt-1 text-xs text-muted-foreground">{recipe.activity === 1 ? translate('反应配方', 'Reaction formula') : translate('制造蓝图', 'Manufacturing blueprint')} · {integer.format(runs)} {translate('流程', 'runs')} · {translate('每流程', 'per run')} {integer.format(recipe.outputQuantity)}</p><p className="mt-1 text-xs leading-5 text-violet-200/80">{translate('技能要求：', 'Required skills: ')}{skillRequirements(recipe, index)}</p></div>
                      </div>
                      <LabeledNumber label={translate('目标产量', 'Target quantity')} value={item.quantity} min="1" max="1000000000000" onChange={(value) => updatePlan(item.key, { quantity: value })} />
                      <LabeledNumber label={translate('蓝图材料效率（ME）', 'Blueprint material efficiency (ME)')} value={item.me} min="0" max="10" suffix="%" disabled={recipe.activity === 1} onChange={(value) => updatePlan(item.key, { me: value })} />
                      <LabeledNumber label={translate('蓝图时间效率（TE）', 'Blueprint time efficiency (TE)')} value={item.te} min="0" max="20" suffix="%" disabled={recipe.activity === 1} onChange={(value) => updatePlan(item.key, { te: value })} />
                      <Button variant="ghost" size="icon" aria-label={translate(`移除 ${type?.zh ?? item.productId}`, `Remove ${type?.en ?? item.productId}`)} onClick={() => removePlan(item.key)}><Trash2 /></Button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="hud-panel border border-border bg-card/80 p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div><p className="text-xs uppercase tracking-[0.16em] text-violet-300">02 / Facility config</p><h2 className="mt-1 text-lg font-semibold">{translate('生产参数', 'Facility configuration')}</h2></div>
              <div className="flex border border-border bg-background/40 p-0.5"><Button type="button" size="sm" variant={!advancedSettings ? 'secondary' : 'ghost'} onClick={() => setAdvancedSettings(false)}>{translate('简单', 'Simple')}</Button><Button type="button" size="sm" variant={advancedSettings ? 'secondary' : 'ghost'} onClick={() => setAdvancedSettings(true)}>{translate('高级', 'Advanced')}</Button></div>
            </div>
            <Button className="xl:sticky xl:top-[var(--tool-header-clearance)] z-10 mb-4 h-10 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300" onClick={() => void calculate()} disabled={calculating || loadingData || !index}>
              <RefreshCw className={calculating ? 'animate-spin' : ''} data-icon="inline-start" />{calculating ? loadingStage || translate('计算中…', 'Calculating…') : translate('计算制造成本', 'Calculate industry cost')}
            </Button>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              <label className="field-block sm:col-span-2" htmlFor="industry-market"><span>{translate('市场 · 默认吉他', 'Market · Jita by default')}</span><NativeSelect id="industry-market" value={settings.region} onChange={(event) => updateSettings({ region: event.target.value })}>{MARKETS.map((market) => <NativeSelectOption key={market.id} value={market.id}>{market.name}</NativeSelectOption>)}</NativeSelect></label>
              <label className="field-block" htmlFor="industry-material-price"><span>{translate('采购材料价格', 'Input price')}</span><NativeSelect id="industry-material-price" value={settings.materialPrice} onChange={(event) => updateSettings({ materialPrice: event.target.value as PriceMode })}><NativeSelectOption value="sell">{translate('最低卖单（立即采购）', 'Lowest sell (immediate purchase)')}</NativeSelectOption><NativeSelectOption value="buy">{translate('最高买单（挂收购单参考）', 'Highest buy (purchase order reference)')}</NativeSelectOption><NativeSelectOption value="split">{translate('买卖中间价（估算）', 'Buy/sell midpoint (estimate)')}</NativeSelectOption></NativeSelect></label>
              <label className="field-block" htmlFor="industry-product-price"><span>{translate('成品收入价格', 'Output price')}</span><NativeSelect id="industry-product-price" value={settings.productPrice} onChange={(event) => updateSettings({ productPrice: event.target.value as PriceMode })}><NativeSelectOption value="buy">{translate('最高买单（立即出售）', 'Highest buy (immediate sale)')}</NativeSelectOption><NativeSelectOption value="sell">{translate('最低卖单（挂卖单参考）', 'Lowest sell (sell order reference)')}</NativeSelectOption><NativeSelectOption value="split">{translate('买卖中间价（估算）', 'Buy/sell midpoint (estimate)')}</NativeSelectOption></NativeSelect></label>
              <label className="field-block sm:col-span-2" htmlFor="industry-expansion"><span>{translate('生产链展开', 'Build depth')}</span><NativeSelect id="industry-expansion" value={settings.expansion} onChange={(event) => updateSettings({ expansion: event.target.value as ExpansionMode })}><NativeSelectOption value="direct">{translate('不展开：直接采购蓝图所需材料', 'Direct: buy blueprint materials')}</NativeSelectOption><NativeSelectOption value="one">{translate('展开一层：中间组件强制自制', 'One level: build intermediate components')}</NativeSelectOption><NativeSelectOption value="all">{translate('完全展开：可制造组件全部自制', 'Full chain: build every manufacturable component')}</NativeSelectOption></NativeSelect></label>
              <div className="sm:col-span-2 border border-cyan-400/20 bg-cyan-400/5 px-3 py-2.5 text-xs leading-5 text-cyan-50/80">
                <p>{translate('采购成本按 ', 'Input cost uses ')}<strong className="font-medium text-cyan-200">{priceModeLabel(settings.materialPrice, 'material')}</strong>; {translate('成品收入按 ', 'output revenue uses ')}<strong className="font-medium text-cyan-200">{priceModeLabel(settings.productPrice, 'product')}</strong>.</p>
                <p className="mt-1 text-muted-foreground">{translate('展开后的组件视为自行制造，只把最末端采购材料计入市场成本；组件的最高买单和最低卖单会在结果中列出供比较，不会自动改成采购。订单簿极值不模拟大批量吃单深度。', 'Expanded components are treated as self-built; only leaf materials count toward market cost. Component buy and sell quotes are shown for comparison. Order-book depth is not simulated.')}</p>
              </div>
              {advancedSettings && <><LabeledNumber label={translate('中间件蓝图材料效率（ME）', 'Component blueprint ME')} value={settings.componentMe} min="0" max="10" step="1" suffix="%" onChange={(value) => updateSettings({ componentMe: value })} /><LabeledNumber label={translate('中间件蓝图时间效率（TE）', 'Component blueprint TE')} value={settings.componentTe} min="0" max="20" step="1" suffix="%" onChange={(value) => updateSettings({ componentTe: value })} /></>}

              <div className="sm:col-span-2 mt-1 border-t border-border/70 pt-3 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-300">{translate('制造', 'Manufacturing')}</div>
              <label className="field-block sm:col-span-2" htmlFor="industry-facility"><span>{translate('建筑预设', 'Structure preset')}</span><NativeSelect id="industry-facility" value={settings.facilityPreset} onChange={(event) => selectFacilityPreset(event.target.value as FacilityPreset)}>{FACILITY_PRESETS.map((preset) => <NativeSelectOption key={preset.id} value={preset.id}>{facilityPresetLabel(preset)}</NativeSelectOption>)}</NativeSelect></label>
              {(advancedSettings || settings.facilityPreset === 'custom') && <><LabeledNumber label={translate('建筑材料减免', 'Structure material reduction')} value={settings.structureMaterialBonus} min="0" max="99" step="0.1" suffix="%" disabled={settings.facilityPreset !== 'custom'} onChange={(value) => updateSettings({ structureMaterialBonus: value })} /><LabeledNumber label={translate('建筑时间减免', 'Structure time reduction')} value={settings.structureTimeBonus} min="0" max="99" step="0.1" suffix="%" disabled={settings.facilityPreset !== 'custom'} onChange={(value) => updateSettings({ structureTimeBonus: value })} /><LabeledNumber label={translate('建筑指数费减免', 'Structure job-cost reduction')} value={settings.structureJobCostBonus} min="0" max="100" step="0.1" suffix="%" disabled={settings.facilityPreset !== 'custom'} onChange={(value) => updateSettings({ structureJobCostBonus: value })} /></>}

              {settings.facilityPreset !== 'npc' && settings.facilityPreset !== 'custom' && <>
                <label className="field-block sm:col-span-2" htmlFor="industry-security"><span>{translate('建筑所在安全等级', 'Structure security band')}</span><NativeSelect id="industry-security" value={settings.securityBand} onChange={(event) => selectSecurityBand(event.target.value as SecurityBand)}>{SECURITY_BANDS.map((band) => <NativeSelectOption key={band.id} value={band.id}>{localizedPair(band.name)}</NativeSelectOption>)}</NativeSelect></label>
                {settings.facilityPreset === 'raitaru' ? <>
                  <label className="field-block sm:col-span-2" htmlFor="industry-material-rig"><span>{translate('中型材料效率改装件', 'M-set material rig')}</span><NativeSelect id="industry-material-rig" value={settings.materialRigId} onChange={(event) => selectSeparateRig('material', event.target.value)}><NativeSelectOption value="none">{translate('未安装', 'None')}</NativeSelectOption>{mediumMaterialRigs.map((rig) => <NativeSelectOption key={rig.id} value={String(rig.id)}>{rigLabel(rig)}</NativeSelectOption>)}<NativeSelectOption value="custom">{translate('自定义数值', 'Custom value')}</NativeSelectOption></NativeSelect></label>
                  <label className="field-block sm:col-span-2" htmlFor="industry-time-rig"><span>{translate('中型时间效率改装件', 'M-set time rig')}</span><NativeSelect id="industry-time-rig" value={settings.timeRigId} onChange={(event) => selectSeparateRig('time', event.target.value)}><NativeSelectOption value="none">{translate('未安装', 'None')}</NativeSelectOption>{mediumTimeRigs.map((rig) => <NativeSelectOption key={rig.id} value={String(rig.id)}>{rigLabel(rig)}</NativeSelectOption>)}<NativeSelectOption value="custom">{translate('自定义数值', 'Custom value')}</NativeSelectOption></NativeSelect></label>
                </> : <label className="field-block sm:col-span-2" htmlFor="industry-combined-rig"><span>{settings.facilityPreset === 'azbel' ? translate('大型制造改装件', 'L-set manufacturing rig') : translate('超大型制造改装件', 'XL-set manufacturing rig')}</span><NativeSelect id="industry-combined-rig" value={settings.combinedRigId} onChange={(event) => selectCombinedRig(event.target.value)}><NativeSelectOption value="none">{translate('未安装', 'None')}</NativeSelectOption>{combinedRigs.map((rig) => <NativeSelectOption key={rig.id} value={String(rig.id)}>{rigLabel(rig)}</NativeSelectOption>)}<NativeSelectOption value="custom">{translate('自定义数值', 'Custom value')}</NativeSelectOption></NativeSelect></label>}
                <p className="sm:col-span-2 text-xs leading-5 text-muted-foreground">{translate('列表来自当前 SDE，只显示该建筑尺寸可安装的真实制造改装件；名称中的产品范围决定它会不会作用于当前蓝图，数值会再乘建筑所在安全等级系数。', 'The current SDE supplies real industry rigs for the selected structure size. The rig name defines which blueprints it affects, and the bonus is multiplied by the security-band modifier.')}</p>
              </>}

              {(advancedSettings || settings.facilityPreset === 'custom') && <><LabeledNumber label="改装件材料减免 / Rig material" value={settings.materialBonus} min="0" max="99" step="0.1" suffix="%" disabled={settings.facilityPreset === 'npc' || (settings.facilityPreset !== 'custom' && (settings.facilityPreset === 'raitaru' ? settings.materialRigId !== 'custom' : settings.combinedRigId !== 'custom'))} onChange={(value) => updateSettings({ materialRigId: 'custom', combinedRigId: 'custom', materialBonus: value })} /><LabeledNumber label="改装件时间减免 / Rig time" value={settings.timeBonus} min="0" max="99" step="0.1" suffix="%" disabled={settings.facilityPreset === 'npc' || (settings.facilityPreset !== 'custom' && (settings.facilityPreset === 'raitaru' ? settings.timeRigId !== 'custom' : settings.combinedRigId !== 'custom'))} onChange={(value) => updateSettings({ timeRigId: 'custom', combinedRigId: 'custom', timeBonus: value })} /></>}
              <LabeledNumber label="技能和植入体时间减免 / Skills & implant" value={settings.skillTimeBonus} min="0" max="99" step="0.1" suffix="%" onChange={(value) => updateSettings({ skillTimeBonus: value })} />
              <LabeledNumber label="星系制造成本指数 / System cost index" value={settings.systemCostIndex} min="0" max="100" step="0.01" suffix="%" onChange={(value) => updateSettings({ systemCostIndex: value })} />
              <LabeledNumber label="制造设施税 / Facility tax" value={settings.facilityTax} min="0" max="100" step="0.1" suffix="%" onChange={(value) => updateSettings({ facilityTax: value })} />

              {advancedSettings ? <><div className="sm:col-span-2 mt-1 border-t border-border/70 pt-3 text-xs font-semibold uppercase tracking-[0.12em] text-violet-300">{translate('反应', 'Reactions')}</div><LabeledNumber label="改装件材料减免 / Rig material" value={settings.reactionMaterialBonus} min="0" max="99" step="0.1" suffix="%" onChange={(value) => updateSettings({ reactionMaterialBonus: value })} /><LabeledNumber label="改装件时间减免 / Rig time" value={settings.reactionTimeBonus} min="0" max="99" step="0.1" suffix="%" onChange={(value) => updateSettings({ reactionTimeBonus: value })} /><LabeledNumber label="技能和植入体时间减免 / Skills & implant" value={settings.reactionSkillTimeBonus} min="0" max="99" step="0.1" suffix="%" onChange={(value) => updateSettings({ reactionSkillTimeBonus: value })} /><LabeledNumber label="建筑特有时间加成 / Structure time" value={settings.reactionStructureTimeBonus} min="0" max="99" step="0.1" suffix="%" onChange={(value) => updateSettings({ reactionStructureTimeBonus: value })} /><LabeledNumber label="建筑成本指数费减免 / Structure job cost" value={settings.reactionStructureJobCostBonus} min="0" max="100" step="0.1" suffix="%" onChange={(value) => updateSettings({ reactionStructureJobCostBonus: value })} /><LabeledNumber label="星系反应成本指数 / System cost index" value={settings.reactionCostIndex} min="0" max="100" step="0.01" suffix="%" onChange={(value) => updateSettings({ reactionCostIndex: value })} /><LabeledNumber label="反应设施税 / Facility tax" value={settings.reactionFacilityTax} min="0" max="100" step="0.1" suffix="%" onChange={(value) => updateSettings({ reactionFacilityTax: value })} /></> : plan.some((item) => index?.recipes.get(item.productId)?.activity === 1) && <p className="sm:col-span-2 border border-violet-400/20 bg-violet-400/5 p-3 text-xs leading-5 text-violet-100/80">{translate('计划中包含反应配方。当前使用已保存的反应参数；切换“高级”可逐项修改。', 'The plan includes reaction formulas. Saved reaction settings are active; switch to Advanced to edit them.')}</p>}
              <p className="sm:col-span-2 text-xs leading-5 text-cyan-200/80">{translate('蓝图份数、角色制造 / 反应线与开工时间请在下方“角色与生产排程”中设置。', 'Set blueprint copies, character manufacturing / reaction slots and start time in Characters and production schedule below.')}</p>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{translate('参数自动保存在当前设备。最终成品使用生产计划行内的蓝图 ME / TE；高级模式可设置展开生产链后的中间件与反应参数。固定 SCC 附加费 4% 自动计入。', 'Settings are saved on this device. Final products use the ME and TE in each plan row; Advanced mode configures expanded components and reactions. The fixed 4% SCC surcharge is included automatically.')}</p>

            <Button className="xl:hidden mt-4 h-10 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300" onClick={() => void calculate()} disabled={calculating || loadingData || !index}>
              <RefreshCw className={calculating ? 'animate-spin' : ''} data-icon="inline-start" />{calculating ? loadingStage || translate('计算中…', 'Calculating…') : translate('计算制造成本', 'Calculate industry cost')}
            </Button>
          </aside>
        </section>

        {calculation && <>
            {(calculation.missingMaterialPrices > 0 || calculation.missingOutputPrices > 0) && <div className="mb-5 border border-amber-400/25 bg-amber-400/8 px-4 py-3 text-sm text-amber-100">{translate(`当前市场缺少 ${calculation.missingMaterialPrices} 种材料、${calculation.missingOutputPrices} 种成品报价；对应价值按 0 计算，请结合表格判断。`, `The market is missing prices for ${calculation.missingMaterialPrices} materials and ${calculation.missingOutputPrices} outputs. Their values are counted as zero.`)}</div>}
            {settings.expansion !== 'direct' && (Number(settings.materialBonus) > 0 || Number(settings.timeBonus) > 0) && <div className="mb-5 border border-violet-400/25 bg-violet-400/8 px-4 py-3 text-sm leading-6 text-violet-100">{translate('未指定设施方案的组件沿用上方制造参数。请在“多设施方案与工序设置”里给不同建筑、不同改装件分类的组件指定合适方案；网页尚不自动验证改装件适用分类。', 'Components without a facility profile inherit the manufacturing settings above. Assign suitable profiles to components using different structures or rig categories. Rig category eligibility is not automatically verified.')}</div>}

            <section ref={resultTotals} tabIndex={-1} className="tool-result-anchor mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <SummaryCard icon={<Boxes />} label={translate('采购材料', 'Input materials')} value={formatIsk(calculation.materialCost)} meta={`${priceModeLabel(settings.materialPrice, 'material')} · ${integer.format(calculation.materials.length)} ${translate('种', 'types')}`} />
              <SummaryCard icon={<Calculator />} label={translate('作业费用', 'Job fees')} value={formatIsk(calculation.jobFees)} meta={translate(`${integer.format(calculation.jobs.length)} 个生产节点 · 含 SCC 4%`, `${integer.format(calculation.jobs.length)} production nodes · includes SCC 4%`)} />
              <SummaryCard icon={<Coins />} label={translate('成品估值', 'Output value')} value={formatIsk(calculation.revenue)} meta={`${priceModeLabel(settings.productPrice, 'product')} · ${MARKETS.find((market) => market.id === settings.region)?.name ?? settings.region}`} />
              <SummaryCard icon={<Clock3 />} label={translate('预计完工时间', 'Estimated completion')} value={scheduleState.schedule?.elapsedSeconds != null ? formatDuration(scheduleState.schedule.elapsedSeconds) : translate('排程未完成', 'Schedule incomplete')} meta={translate('按角色槽位、蓝图和工序依赖排程', 'Based on character slots, blueprints and dependencies')} />
              <SummaryCard icon={<Factory />} label={translate('预计利润', 'Estimated profit')} value={formatIsk(calculation.profit)} meta={calculation.margin === null ? translate('缺少成品估值', 'Missing output value') : translate(`利润率 ${decimal.format(calculation.margin * 100)}%`, `Margin ${decimal.format(calculation.margin * 100)}%`)} accent={calculation.profit >= 0} negative={calculation.profit < 0} />
            </section>

        </>}

        {calculation && (<section id="industry-shopping" className="tool-table-scroll tool-result-anchor hud-panel mb-6 overflow-hidden border border-border bg-card/85">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div><p className="text-xs uppercase tracking-[0.14em] text-cyan-300">Shopping list</p><h2 className="mt-1 font-semibold">{translate('最终采购清单', 'Final shopping list')}</h2></div>
                <Button size="sm" variant="outline" onClick={() => void copyShoppingList()}><ClipboardCopy data-icon="inline-start" />{copied ? translate('已复制，可粘贴到游戏', 'Copied, ready to paste into EVE') : translate('复制游戏多买清单', 'Copy EVE multibuy list')}</Button>
              </div>
              <Table>
                <TableHeader><TableRow className="bg-muted/25 hover:bg-muted/25"><TableHead className="pl-4">{translate('材料', 'Material')}</TableHead><TableHead className="text-right">{translate('数量', 'Quantity')}</TableHead><TableHead className="text-right">{translate('最高买单', 'Highest buy')}</TableHead><TableHead className="text-right">{translate('最低卖单', 'Lowest sell')}</TableHead><TableHead className="text-right">{translate('本次单价', 'Unit price')} · {priceModeShort(settings.materialPrice)}</TableHead><TableHead className="pr-4 text-right">{translate('采购合计', 'Input total')}</TableHead></TableRow></TableHeader>
                <TableBody>{calculation.materials.map((row) => <TableRow key={row.type.id}><TableCell className="pl-4"><div className="flex items-center gap-3"><EveTypeIcon typeId={row.type.id} /><div><p className="font-medium text-slate-100">{bilingual(row.type)}</p><p className="text-xs text-muted-foreground">Type {row.type.id} · {index?.groups.get(row.type.groupId) ?? `Group ${row.type.groupId}`}</p></div></div></TableCell><TableCell className="text-right font-mono">{integer.format(row.quantity)}</TableCell><TableCell className={`text-right font-mono ${settings.materialPrice === 'buy' ? 'text-cyan-200' : 'text-muted-foreground'}`}>{row.highestBuyPrice > 0 ? formatIsk(row.highestBuyPrice) : translate('缺价', 'No price')}</TableCell><TableCell className={`text-right font-mono ${settings.materialPrice === 'sell' ? 'text-cyan-200' : 'text-muted-foreground'}`}>{row.lowestSellPrice > 0 ? formatIsk(row.lowestSellPrice) : translate('缺价', 'No price')}</TableCell><TableCell className="text-right font-mono text-slate-100">{row.unitPrice > 0 ? formatIsk(row.unitPrice) : translate('缺价', 'No price')}</TableCell><TableCell className="pr-4 text-right font-mono text-cyan-200">{row.unitPrice > 0 ? formatIsk(row.value) : translate('缺价', 'No price')}</TableCell></TableRow>)}</TableBody>
              </Table>
            </section>)}

        <IndustryScheduleSetup
          value={planning} onChange={updatePlanning} nodes={graphState.graph?.nodes ?? []}
          nameOf={(productId) => bilingual(index?.byType.get(productId))}
          skillsOf={(node) => skillRequirements(node.recipe, index)}
          manufacturing={graphState.manufacturing} reaction={graphState.reaction}
          onSchedule={() => setScheduleRequested(true)} ready={!!graphState.graph && plan.length > 0}
          error={graphState.error || scheduleState.error}
        />

        {scheduleState.schedule && graphState.graph && <IndustryScheduleResults key={`${plan.map((item) => item.key).join('-')}:${scheduleState.schedule.jobs.length}`} nodes={graphState.graph.nodes} schedule={scheduleState.schedule} preferences={planning} nameOf={(id) => bilingual(index?.byType.get(id))} />}

        {calculation && (
          <>
            <section className="mb-6 grid gap-4 lg:grid-cols-2">
              <div className="hud-panel overflow-hidden border border-border bg-card/85">
                <div className="border-b border-border px-4 py-3"><p className="text-xs uppercase tracking-[0.14em] text-cyan-300">Job cost breakdown</p><h2 className="mt-1 font-semibold">{translate('作业费用明细', 'Job cost')}</h2></div>
                <div className="divide-y divide-border/60 px-4">
                  <DetailRow label="估计物品价值 / Estimated Item Value (EIV)" value={formatIsk(calculation.estimatedItemValue)} />
                  <DetailRow label="星系成本指数费 / System cost index" value={formatIsk(calculation.systemCostFees)} />
                  <DetailRow label="建筑特有加成 / Structure role bonus" value={calculation.structureCostAdjustments < 0 ? `-${formatIsk(Math.abs(calculation.structureCostAdjustments))}` : formatIsk(0)} accent={calculation.structureCostAdjustments < 0} />
                  <DetailRow label="设施税 / Facility tax" value={formatIsk(calculation.facilityTaxes)} />
                  <DetailRow label="SCC 固定附加费 / SCC surcharge (4% EIV)" value={formatIsk(calculation.sccSurcharges)} />
                  <DetailRow label="作业总费用 / Total job cost" value={formatIsk(calculation.jobFees)} strong />
                </div>
                <p className="border-t border-border/60 px-4 py-3 text-xs leading-5 text-muted-foreground">{translate('建筑成本减免只作用于星系成本指数费；设施税与 SCC 4% 均按 EIV 单独计算。', 'Structure job-cost reductions apply only to the system cost-index fee. Facility tax and the 4% SCC surcharge are calculated separately from EIV.')}</p>
              </div>

              <div className="hud-panel overflow-hidden border border-border bg-card/85">
                <div className="border-b border-border px-4 py-3"><p className="text-xs uppercase tracking-[0.14em] text-violet-300">Default production modifiers</p><h2 className="mt-1 font-semibold">{translate('默认生产参数与排程汇总', 'Default modifiers and schedule summary')}</h2></div>
                <p className="border-b border-border/60 px-4 py-3 text-xs leading-5 text-muted-foreground">{translate('以下减免为默认值；单独指定的设施与角色以工序时间表为准。', 'Reductions below are defaults; job-specific facilities and characters are shown in the production timeline.')}</p>
                <div className="divide-y divide-border/60 px-4">
                  <DetailRow label="制造建筑 / Manufacturing structure" value={selectedFacilityPreset ? facilityPresetLabel(selectedFacilityPreset) : settings.facilityPreset} />
                  <DetailRow label="建筑材料减免 / Structure material" value={signedReduction(settings.structureMaterialBonus)} />
                  {settings.facilityPreset === 'raitaru' && <DetailRow label="材料改装件 / Material rig" value={selectedMaterialRig ? bilingualName(selectedMaterialRig.zh, selectedMaterialRig.en) : settings.materialRigId === 'custom' ? translate('自定义', 'Custom') : translate('未安装', 'None')} />}
                  {settings.facilityPreset === 'raitaru' && <DetailRow label="时间改装件 / Time rig" value={selectedTimeRig ? bilingualName(selectedTimeRig.zh, selectedTimeRig.en) : settings.timeRigId === 'custom' ? translate('自定义', 'Custom') : translate('未安装', 'None')} />}
                  {(settings.facilityPreset === 'azbel' || settings.facilityPreset === 'sotiyo') && <DetailRow label="制造改装件 / Manufacturing rig" value={selectedCombinedRig ? bilingualName(selectedCombinedRig.zh, selectedCombinedRig.en) : settings.combinedRigId === 'custom' ? translate('自定义', 'Custom') : translate('未安装', 'None')} />}
                  <DetailRow label="改装件材料减免 / Rig material" value={signedReduction(settings.materialBonus)} />
                  <DetailRow label="蓝图时间效率 / Blueprint TE" value={blueprintTimeSummary(calculation.jobs)} />
                  <DetailRow label="制造技能和植入体 / Manufacturing skills & implant" value={signedReduction(settings.skillTimeBonus)} />
                  <DetailRow label="制造改装件 / Manufacturing rigs" value={signedReduction(settings.timeBonus)} />
                  <DetailRow label="制造建筑特有加成 / Manufacturing structure" value={signedReduction(settings.structureTimeBonus)} />
                  {calculation.jobs.some((job) => job.recipe.activity === 1) && <>
                    <DetailRow label="反应技能和植入体 / Reaction skills & implant" value={signedReduction(settings.reactionSkillTimeBonus)} />
                    <DetailRow label="反应改装件 / Reaction rigs" value={signedReduction(settings.reactionTimeBonus)} />
                    <DetailRow label="反应建筑特有加成 / Reaction structure" value={signedReduction(settings.reactionStructureTimeBonus)} />
                  </>}
                  <DetailRow label="已配置角色 / Configured characters" value={String(planning.characters.length)} />
                  <DetailRow label="已排作业工时 / Scheduled slot hours" value={formatDuration(scheduleState.schedule?.totalJobSeconds ?? 0)} />
                  <DetailRow label="预计完工时间 / Estimated elapsed time" value={scheduleState.schedule?.elapsedSeconds != null ? formatDuration(scheduleState.schedule.elapsedSeconds) : translate('存在未分配工序', 'Unassigned jobs remain')} strong />
                </div>
                <p className="border-t border-border/60 px-4 py-3 text-xs leading-5 text-muted-foreground">{translate('蓝图、技能/植入体、改装件和建筑时间修正按游戏方式逐项相乘；技能数值当前手动填写，接入 ESI 后可从角色读取。', 'Blueprint, skills and implants, rigs, and structure time modifiers are multiplied as in EVE. Skill values are entered manually until ESI support is added.')}</p>
              </div>
            </section>



            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]">
              <div className="hud-panel overflow-hidden border border-border bg-card/85">
                <div className="border-b border-border px-4 py-3"><p className="text-xs uppercase tracking-[0.14em] text-violet-300">Production tree</p><h2 className="mt-1 font-semibold">{translate('生产节点', 'Production nodes')}</h2></div>
                <Table><TableHeader><TableRow className="bg-muted/25 hover:bg-muted/25"><TableHead className="pl-4">{translate('产出', 'Output')}</TableHead><TableHead className="text-right">{translate('流程 / 产量', 'Runs / output')}</TableHead><TableHead className="text-right">ME / TE</TableHead><TableHead className="text-right">{translate('工时', 'Duration')}</TableHead><TableHead className="text-right">{translate('市场参考 / 个', 'Market / unit')}</TableHead><TableHead className="pr-4 text-right">{translate('作业费', 'Job fee')}</TableHead></TableRow></TableHeader><TableBody>{calculation.jobs.map((job) => <TableRow key={job.key}><TableCell className="pl-4"><div className="flex items-start gap-2" style={{ paddingLeft: `${Math.min(job.level, 5) * 14}px` }}>{job.level > 0 && <ChevronRight className="mt-3 size-3 shrink-0 text-violet-300" />}<EveTypeIcon typeId={job.product.id} /><div><p className="font-medium text-slate-100">{bilingual(job.product)}</p><p className="text-xs text-muted-foreground">{job.recipe.activity === 1 ? translate('反应', 'Reaction') : job.level === 0 ? translate('最终成品', 'Final product') : translate(`第 ${job.level} 层组件`, `Level ${job.level} component`)}</p><p className="mt-1 max-w-xl text-xs leading-5 text-violet-200/75">{translate('技能要求：', 'Required skills: ')}{skillRequirements(job.recipe, index)}</p></div></div></TableCell><TableCell className="text-right font-mono">{integer.format(job.runs)} / {integer.format(job.produced)}</TableCell><TableCell className="text-right font-mono text-muted-foreground">{job.recipe.activity === 1 ? translate('不适用', 'N/A') : `${decimal.format(job.materialEfficiency)} / ${decimal.format(job.timeEfficiency)}`}</TableCell><TableCell className="text-right font-mono">{job.duration === null ? translate("未分配", "Unassigned") : formatDuration(job.duration)}</TableCell><TableCell className="text-right font-mono text-xs"><p className="text-emerald-200">{translate('买', 'Buy')} {job.highestBuyPrice > 0 ? formatIsk(job.highestBuyPrice) : translate('缺价', 'No price')}</p><p className="mt-1 text-amber-200">{translate('卖', 'Sell')} {job.lowestSellPrice > 0 ? formatIsk(job.lowestSellPrice) : translate('缺价', 'No price')}</p><p className="mt-1 text-muted-foreground">{translate('仅比较，不计成本', 'Comparison only')}</p></TableCell><TableCell className="pr-4 text-right font-mono"><p>{formatIsk(job.jobFee)}</p><p className="mt-1 text-xs text-muted-foreground">EIV {formatIsk(job.estimatedItemValue)}</p></TableCell></TableRow>)}</TableBody></Table>
              </div>

              <div className="hud-panel overflow-hidden border border-border bg-card/85">
                <div className="border-b border-border px-4 py-3"><p className="text-xs uppercase tracking-[0.14em] text-emerald-300">Outputs</p><h2 className="mt-1 font-semibold">{translate('成品估值', 'Output valuation')}</h2></div>
                <div className="divide-y divide-border/70">{calculation.outputs.map((output) => <article key={output.type.id} className="flex items-center gap-3 p-4"><EveTypeIcon typeId={output.type.id} /><div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-100">{bilingual(output.type)}</p><p className="mt-1 text-xs text-muted-foreground">{translate(`目标 ${integer.format(output.requested)} · 实产 ${integer.format(output.produced)}`, `Target ${integer.format(output.requested)} · produced ${integer.format(output.produced)}`)}</p><p className="mt-1 text-xs text-muted-foreground">{translate('最高买单', 'Highest buy')} {output.highestBuyPrice > 0 ? formatIsk(output.highestBuyPrice) : translate('缺价', 'No price')} · {translate('最低卖单', 'Lowest sell')} {output.lowestSellPrice > 0 ? formatIsk(output.lowestSellPrice) : translate('缺价', 'No price')}</p></div><div className="text-right"><p className="font-mono text-cyan-200">{output.unitPrice > 0 ? formatIsk(output.value) : translate('缺价', 'No price')}</p><p className="mt-1 text-xs text-muted-foreground">{output.unitPrice > 0 ? `${priceModeShort(settings.productPrice)} ${formatIsk(output.unitPrice)} / ${translate('个', 'unit')}` : translate('无市场报价', 'No market quote')}</p></div></article>)}</div>
              </div>
            </section>
          </>
        )}

        <footer className="flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{translate('蓝图、材料与技能：', 'Blueprints, materials and skills: ')}{index?.source ?? 'CCP SDE'}; {translate('市场报价：', 'market prices: ')}Fuzzwork (buy.max / sell.min); EIV: ESI adjusted price; SCC: 4%.</p>
          <p>{calculation ? translate(`计算于 ${calculation.calculatedAt.toLocaleTimeString(languageLocale(), { hour: '2-digit', minute: '2-digit' })}`, `Calculated ${calculation.calculatedAt.toLocaleTimeString(languageLocale(), { hour: '2-digit', minute: '2-digit' })}`) : translate('制造参数只保存在当前浏览器', 'Industry settings are stored only in this browser')}</p>
        </footer>
      </div>
    </main>
  );
}

function LabeledNumber({ label, value, onChange, min, max, step = '1', suffix, disabled = false, className = '' }: { label: string; value: string; onChange: (value: string) => void; min: string; max: string; step?: string; suffix?: string; disabled?: boolean; className?: string }) {
  return <label className={`field-block ${className}`}><span>{localizedPair(label)}</span><div className="relative"><Input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={suffix ? 'pr-8' : ''} />{suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}</div></label>;
}

function SummaryCard({ icon, label, value, meta, accent = false, negative = false }: { icon: React.ReactNode; label: string; value: string; meta: string; accent?: boolean; negative?: boolean }) {
  return <article className={`hud-card relative overflow-hidden border bg-card/80 p-4 ${accent ? 'border-emerald-400/35' : negative ? 'border-red-400/30' : 'border-border'}`}><div className="mb-3 flex items-center justify-between text-muted-foreground"><span className="text-xs uppercase tracking-[0.14em]">{label}</span><span className="[&_svg]:size-4">{icon}</span></div><p className={`font-mono text-xl font-semibold ${accent ? 'text-emerald-200' : negative ? 'text-red-300' : 'text-slate-100'}`}>{value}</p><p className="mt-1 truncate text-xs text-muted-foreground" title={meta}>{meta}</p></article>;
}

function DetailRow({ label, value, strong = false, accent = false }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className={strong ? 'font-medium text-slate-100' : 'text-muted-foreground'}>{localizedPair(label)}</span><span className={`font-mono ${strong ? 'font-semibold text-cyan-200' : accent ? 'text-emerald-300' : 'text-slate-200'}`}>{value}</span></div>;
}
