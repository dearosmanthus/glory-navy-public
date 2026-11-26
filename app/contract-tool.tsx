'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';
import { cachedJson } from '@/lib/static-json';
import { normalizeContractName } from '@/lib/contract-name';
import { locateClipboardLines, type ClipboardLine } from '@/lib/clipboard-lines';
import { revealToolResult } from '@/lib/tool-flow';
import { MARKETS as REGIONS, marketUrl, marketPrice, type MarketAggregate, type MarketMap } from '@/lib/eve-market';
import {
  AlertTriangle,
  Calculator,
  Check,
  ClipboardCopy,
  Database,
  FlaskConical,
  Link2,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  Share2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { CourierQuote } from './courier-quote';
import EveTypeIcon from './eve-type-icon';
import { bilingualName, formatLocalizedNumber, languageLocale, translate, useLanguage } from './language-provider';
import ServerStatus from './server-status';
import ToolNavigation, { type ToolId } from './tool-navigation';

type CompactType = [
  id: number,
  zh: string,
  en: string,
  volume: number,
  portionSize: number,
  categoryId: number,
  materials: Array<[number, number]> | null,
];
type ContractData = { schema: number; source: string; types: CompactType[] };
type EveType = {
  id: number;
  zh: string;
  en: string;
  volume: number;
  portionSize: number;
  categoryId: number;
  materials: Array<[number, number]>;
};
type ContractIndex = {
  byId: Map<number, EveType>;
  byName: Map<string, EveType[]>;
  count: number;
  source: string;
};
type ContractItem = { type: EveType; quantity: number };
type SavedContractSettings = {
  region: string;
  oreReprocessing: boolean;
  equipmentReprocessing: boolean;
  oreYield: string;
  scrapYield: string;
  contractDiscount: string;
};
type SharedAppraisal = {
  v: 1;
  createdAt: string;
  pricedAt?: string;
  marketScope?: 'station' | 'region';
  types?: CompactType[];
  region: string;
  settings: {
    ore: boolean;
    equipment: boolean;
    oreYield: number;
    scrapYield: number;
    discount: number;
  };
  items: Array<[number, number]>;
  prices: Record<string, [number, number]>;
};
type PriceMode = 'buy' | 'split' | 'sell';
type PriceValues = Record<PriceMode, number>;
type RefiningUnit = {
  id: number;
  quantity: number;
  unitPrices: PriceValues;
  values: PriceValues;
};
type ValuationRow = {
  item: ContractItem;
  rawUnitPrices: PriceValues;
  rawValues: PriceValues;
  refiningValues: PriceValues;
  refiningPriced: boolean;
  refining: RefiningUnit[];
  remainder: number;
  recommended: 'raw' | 'refine' | 'unknown';
  reprocessingEnabled: boolean;
  reprocessingLabel: string;
};

const SAMPLE = `Pithum A-Type Medium Remote Shield Booster\t1\tRemote Shield Booster\tModule
19th Tier Overseer's Personal Effects\t1\tOverseer Personal Effects\tCommodity`;
const PRICE_MODES: PriceMode[] = ['buy', 'split', 'sell'];
const SETTINGS_KEY = 'glory-navy.contract.settings.v1';
const compactNumber = { format: (value: number) => formatLocalizedNumber(value, { notation: 'compact', maximumFractionDigits: 2 }) };
const fullNumber = { format: (value: number) => formatLocalizedNumber(value, { maximumFractionDigits: 2 }) };

function typeName(type: EveType | undefined) {
  if (!type) return translate('未知物品', 'Unknown item');
  return bilingualName(type.zh, type.en);
}

function formatIsk(value: number) {
  if (!Number.isFinite(value)) return '—';
  return `${compactNumber.format(value)} ISK`;
}

function formatQuantity(value: number) {
  return fullNumber.format(value);
}

function copyableIsk(value: number) {
  return new Intl.NumberFormat('en-US', {
    useGrouping: false,
    maximumFractionDigits: 2,
  }).format(value);
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function allMarketPrices(market: MarketAggregate | undefined): PriceValues {
  return {
    buy: marketPrice(market, 'buy'),
    split: marketPrice(market, 'split'),
    sell: marketPrice(market, 'sell'),
  };
}

function parseQuantity(value: string) {
  const normalized = value.normalize('NFKC').trim();
  if (!/^\d+$/.test(normalized) && !/^\d{1,3}([,._ ])\d{3}(?:\1\d{3})*$/.test(normalized)) return 0;
  const numeric = Number(normalized.replace(/[,._ ]/g, ''));
  return Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 1e12 ? numeric : 0;
}

function findType(index: ContractIndex, name: string) {
  const numericId = Number(name.trim());
  if (/^\d+$/.test(name.trim()) && index.byId.has(numericId)) {
    return index.byId.get(numericId);
  }
  const candidates = index.byName.get(normalizeContractName(name));
  return candidates?.length === 1 ? candidates[0] : undefined;
}

function parseContractColumns(line: string, index: ContractIndex) {
  const tabColumns = line.split('\t').map((part) => part.trim());
  const columns = tabColumns.length >= 2
    ? tabColumns
    : line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
  if (columns.length >= 2) {
    const standardType = findType(index, columns[0]);
    const standardQuantity = parseQuantity(columns[1]);
    if (standardType && standardQuantity > 0) {
      return { type: standardType, quantity: standardQuantity };
    }

    const leadingQuantity = parseQuantity(columns[0]);
    const leadingType = findType(index, columns[1]);
    if (leadingType && leadingQuantity > 0) {
      return { type: leadingType, quantity: leadingQuantity };
    }

    // Explicit columns must not fall through to guessing a quantity from volume/group columns.
    if (line.includes('\t') || standardType || leadingType) return null;

    for (let indexOfQuantity = 1; indexOfQuantity < columns.length; indexOfQuantity += 1) {
      const quantity = parseQuantity(columns[indexOfQuantity]);
      if (quantity <= 0) continue;
      const type = findType(index, columns.slice(0, indexOfQuantity).join(' '));
      if (type) return { type, quantity };
    }
  }

  const tokens = line.split(/\s+/).filter(Boolean);
  for (let nameEnd = tokens.length - 1; nameEnd >= 1; nameEnd -= 1) {
    const wholeQuantity = parseQuantity(tokens.slice(nameEnd).join(' '));
    const wholeType = findType(index, tokens.slice(0, nameEnd).join(' '));
    if (wholeType && wholeQuantity > 0) return { type: wholeType, quantity: wholeQuantity };
    const quantity = parseQuantity(tokens[nameEnd]);
    if (quantity <= 0) continue;
    const type = findType(index, tokens.slice(0, nameEnd).join(' '));
    if (type) return { type, quantity };
  }

  const leadingQuantity = parseQuantity(tokens[0] ?? '');
  if (leadingQuantity > 0) {
    for (let nameEnd = tokens.length; nameEnd >= 2; nameEnd -= 1) {
      const type = findType(index, tokens.slice(1, nameEnd).join(' '));
      if (type) return { type, quantity: leadingQuantity };
    }
  }

  return null;
}

function parseContractInput(input: string, index: ContractIndex) {
  if (input.length > 500_000 || input.split(/\r?\n/).length > 5_000) throw new Error(translate('清单过长：最多 5000 行、50 万字符，请分批估价。', 'The list is too large. Appraise at most 5,000 lines or 500,000 characters at a time.'));
  const aggregated = new Map<number, ContractItem>();
  const unmatched: string[] = [];

  for (const originalLine of input.split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line) continue;

    let type = findType(index, line);
    let quantity = 1;

    if (!type) {
      const parsedColumns = parseContractColumns(line, index);
      if (parsedColumns) {
        type = parsedColumns.type;
        quantity = parsedColumns.quantity;
      }
    }

    if (!type && !line.includes('\t')) {
      const suffix = line.match(/^(.*?)(?:\s+[x×]\s*|\s{2,}|\s+)([\d,._，]+)$/i);
      if (suffix) {
        quantity = parseQuantity(suffix[2]);
        type = findType(index, suffix[1]);
      }
    }

    if (!type && !line.includes('\t')) {
      const prefix = line.match(/^([\d,._，]+)\s*[x×]?\s+(.+)$/i);
      if (prefix) {
        quantity = parseQuantity(prefix[1]);
        type = findType(index, prefix[2]);
      }
    }

    if (!type || quantity <= 0) {
      unmatched.push(originalLine);
      continue;
    }

    const existing = aggregated.get(type.id);
    if ((existing?.quantity ?? 0) + quantity > 1e12) throw new Error(translate('同一种物品数量最多 1 万亿，请分批估价。', 'A single item is limited to 1 trillion units. Please split the appraisal.'));
    aggregated.set(type.id, {
      type,
      quantity: (existing?.quantity ?? 0) + quantity,
    });
  }

  if (aggregated.size > 500) throw new Error(translate('一次最多估价 500 种物品，请分批粘贴。', 'Each appraisal supports up to 500 item types. Please split the list.'));
  return { items: Array.from(aggregated.values()), unmatched };
}

function unpackType(row: CompactType): EveType {
  return { id: row[0], zh: row[1], en: row[2], volume: row[3], portionSize: row[4], categoryId: row[5], materials: row[6] ?? [] };
}

function refiningQuantity(batches: number, perBatch: number, percent: string) {
  const scaledPercent = Math.round(Math.min(100, Math.max(0, Number(percent) || 0)) * 10_000);
  return Number(BigInt(batches) * BigInt(perBatch) * BigInt(scaledPercent) / BigInt(1_000_000));
}

export default function ContractTool({ onSwitch }: { onSwitch: (tool: ToolId) => void }) {
  const { language } = useLanguage();
  const [index, setIndex] = useState<ContractIndex | null>(null);
  const [input, setInput] = useState('');
  const [items, setItems] = useState<ContractItem[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [markets, setMarkets] = useState<MarketMap>({});
  const [region, setRegion] = useState('10000002');
  const [oreReprocessing, setOreReprocessing] = useState(true);
  const [equipmentReprocessing, setEquipmentReprocessing] = useState(true);
  const [oreYield, setOreYield] = useState('89');
  const [scrapYield, setScrapYield] = useState('55');
  const [contractDiscount, setContractDiscount] = useState('0');
  const [loadingData, setLoadingData] = useState(true);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [loadingShare, setLoadingShare] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [sharedCreatedAt, setSharedCreatedAt] = useState<Date | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [shareCode, setShareCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedPrice, setCopiedPrice] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [sharedSettings, setSharedSettings] = useState(false);
  const [shareTarget, setShareTarget] = useState('');
  const [marketScope, setMarketScope] = useState<'station' | 'region'>('station');
  const [snapshotTypes, setSnapshotTypes] = useState<Map<number, EveType>>(new Map());
  const [dataAttempt, setDataAttempt] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const shareRequest = useRef<AbortController | null>(null);
  const contractInput = useRef<HTMLTextAreaElement | null>(null);
  const [showAllUnmatched, setShowAllUnmatched] = useState(false);
  const appraisalTotals = useRef<HTMLElement | null>(null);
  const unmatchedLines = useMemo(() => locateClipboardLines(input, unmatched), [input, unmatched]);

  function returnToInput(line?: ClipboardLine) {
    const field = contractInput.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'center' });
    if (line) field.setSelectionRange(line.start, line.end);
  }

  useEffect(() => {
    if (updatedAt) revealToolResult(appraisalTotals.current);
  }, [updatedAt]);

  function invalidateShare() {
    shareRequest.current?.abort();
    setSharing(false);
    setShareTarget('');
    setShareUrl('');
    setShareCode('');
    setSharedCreatedAt(null);
    setCopied(false);
    setCopiedPrice('');
    setLinkCopied(false);
    if (window.location.hash.startsWith('#contract/a/')) window.history.replaceState(null, '', `${window.location.pathname}#contract`);
  }

  function editSettings() {
    invalidateShare();
    setSharedSettings(false);
  }

  function invalidateResults() {
    invalidateShare();
    activeRequest.current?.abort();
    setLoadingPrices(false);
    setLoadingShare(false);
    setItems([]);
    setMarkets({});
    setSnapshotTypes(new Map());
    setUpdatedAt(null);
    setUnmatched([]);
    setShowAllUnmatched(false);
    setError('');
  }

  useEffect(() => {
    const sync = () => setShareTarget(window.location.hash.match(/^#contract\/a\/([a-f0-9]{12})$/i)?.[1].toLowerCase() ?? '');
    sync();
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      activeRequest.current?.abort();
      shareRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    let saved: Partial<SavedContractSettings> | null = null;
    try {
      saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<SavedContractSettings> | null;
    } catch { /* Storage can be disabled; defaults remain usable. */ }
    const frame = window.requestAnimationFrame(() => {
      if (saved) {
        if (REGIONS.some((item) => item.id === saved.region)) setRegion(saved.region as string);
        if (typeof saved.oreReprocessing === 'boolean') setOreReprocessing(saved.oreReprocessing);
        if (typeof saved.equipmentReprocessing === 'boolean') setEquipmentReprocessing(saved.equipmentReprocessing);
        if (typeof saved.oreYield === 'string') setOreYield(saved.oreYield);
        if (typeof saved.scrapYield === 'string') setScrapYield(saved.scrapYield);
        if (typeof saved.contractDiscount === 'string') setContractDiscount(saved.contractDiscount);
      }
      setSettingsLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!settingsLoaded || sharedSettings) return;
    const settings: SavedContractSettings = {
      region,
      oreReprocessing,
      equipmentReprocessing,
      oreYield,
      scrapYield,
      contractDiscount,
    };
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Calculations still work without storage. */ }
  }, [contractDiscount, equipmentReprocessing, oreReprocessing, oreYield, region, scrapYield, settingsLoaded, sharedSettings]);

  useEffect(() => {
    let cancelled = false;
    async function loadIndex() {
      setLoadingData(true);
      try {
        const data = await cachedJson<ContractData>('/contract-data.json?v=20260908-2');
        const byId = new Map<number, EveType>();
        const byName = new Map<string, EveType[]>();
        for (const row of data.types) {
          const type = unpackType(row);
          byId.set(type.id, type);
          for (const name of new Set([normalizeContractName(type.zh), normalizeContractName(type.en)])) {
            byName.set(name, [...(byName.get(name) ?? []), type]);
          }
        }
        if (!cancelled) {
          setIndex({ byId, byName, count: data.types.length, source: data.source });
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : translate('物品数据库加载失败。', 'Failed to load the item database.'));
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }
    void loadIndex();
    return () => {
      cancelled = true;
    };
  }, [dataAttempt]);

  useEffect(() => {
    if (!index || !settingsLoaded) return;
    const contractIndex = index;
    if (!shareTarget) return;
    const code = shareTarget;
    let cancelled = false;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;

    async function loadSharedAppraisal() {
      setLoadingShare(true);
      setItems([]);
      setMarkets({});
      setShareUrl('');
      setUpdatedAt(null);
      setError('');
      try {
        const data = await fetchJson<SharedAppraisal>(`/api/appraisals/${code}`, { cache: 'no-store', signal: controller.signal });
        const savedTypes = new Map((data.types ?? []).map((row) => [row[0], unpackType(row)]));
        const sharedItems = data.items.map(([typeId, quantity]) => {
          const type = savedTypes.get(typeId) ?? contractIndex.byId.get(typeId);
          if (!type) throw new Error(translate(`分享中 Type ${typeId} 已不在数据库中，无法完整恢复估价。`, `Type ${typeId} from this shared appraisal is no longer in the database.`));
          return { type, quantity };
        });
        if (sharedItems.length === 0) throw new Error(translate('分享估价中的物品已不在当前数据库中。', 'The items in this shared appraisal are no longer in the current database.'));
        const sharedMarkets: MarketMap = {};
        for (const [typeId, [buy, sell]] of Object.entries(data.prices)) {
          sharedMarkets[typeId] = {
            buy: { max: String(buy) },
            sell: { min: String(sell) },
          };
        }
        if (cancelled) return;
        setSharedSettings(true);
        setSnapshotTypes(savedTypes);
        setMarketScope(data.marketScope ?? 'region');
        setRegion(data.region);
        setOreReprocessing(data.settings.ore);
        setEquipmentReprocessing(data.settings.equipment);
        setOreYield(String(data.settings.oreYield));
        setScrapYield(String(data.settings.scrapYield));
        setContractDiscount(String(data.settings.discount));
        setItems(sharedItems);
        setUnmatched([]);
        setMarkets(sharedMarkets);
        setInput(sharedItems.map((item) => `${item.type.en}\t${item.quantity}`).join('\n'));
        const createdAt = new Date(data.createdAt);
        setUpdatedAt(new Date(data.pricedAt ?? data.createdAt));
        setSharedCreatedAt(createdAt);
        setShareCode(code);
        setShareUrl(`${window.location.origin}${window.location.pathname}#contract/a/${code}`);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : translate('分享估价加载失败。', 'Failed to load the shared appraisal.'));
      } finally {
        if (!cancelled) setLoadingShare(false);
      }
    }

    void loadSharedAppraisal();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [index, settingsLoaded, shareTarget]);

  async function analyze() {
    if (!index) {
      setError(translate('物品数据库仍在加载，请稍候。', 'The item database is still loading. Please wait.'));
      return;
    }

    invalidateResults();
    let parsed: ReturnType<typeof parseContractInput>;
    try { parsed = parseContractInput(input, index); } catch (reason) {
      setError(reason instanceof Error ? reason.message : translate('清单解析失败。', 'Failed to parse the list.'));
      return;
    }
    setUnmatched(parsed.unmatched);
    setCopied(false);
    setLinkCopied(false);
    setShareUrl('');
    setShareCode('');
    setSharedCreatedAt(null);
    setError('');
    if (parsed.items.length === 0) {
      setMarkets({});
      setError(translate('没有识别到物品。支持游戏合同复制的多列格式，也支持“物品名称 + 数量”。', 'No items were recognized. Paste a multi-column EVE contract or one item name and quantity per line.'));
      return;
    }

    const typeIds = new Set<number>();
    for (const item of parsed.items) {
      typeIds.add(item.type.id);
      for (const [materialId] of item.type.materials) typeIds.add(materialId);
    }

    setLoadingPrices(true);
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const responses = await Promise.all(
        chunks(Array.from(typeIds), 80).map((group) => fetchJson<MarketMap>(marketUrl(region, group), { signal: controller.signal })),
      );
      if (controller.signal.aborted) return;
      const nextMarkets: MarketMap = Object.assign({}, ...responses);
      for (const id of typeIds) nextMarkets[String(id)] ??= {};
      setItems(parsed.items);
      setMarkets(nextMarkets);
      setMarketScope('station');
      setUpdatedAt(new Date());
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : translate('市场价格加载失败。', 'Failed to load market prices.'));
    } finally {
      if (!controller.signal.aborted) setLoadingPrices(false);
    }
  }

  const analysis = useMemo(() => {
    void language;
    const rows: ValuationRow[] = items.map((item) => {
      const rawUnitPrices = allMarketPrices(markets[String(item.type.id)]);
      const rawValues: PriceValues = {
        buy: rawUnitPrices.buy * item.quantity,
        split: rawUnitPrices.split * item.quantity,
        sell: rawUnitPrices.sell * item.quantity,
      };
      const batches = Math.floor(item.quantity / item.type.portionSize);
      const remainder = item.quantity - batches * item.type.portionSize;
      const isOre = item.type.categoryId === 25;
      const reprocessingEnabled = isOre ? oreReprocessing : equipmentReprocessing;
      const reprocessingLabel = isOre ? translate('化矿', 'Reprocess') : translate('回收', 'Recycle');
      const refining = (reprocessingEnabled ? item.type.materials : []).map(([id, perBatch]) => {
        const quantity = refiningQuantity(batches, perBatch, isOre ? oreYield : scrapYield);
        const unitPrices = allMarketPrices(markets[String(id)]);
        return {
          id,
          quantity,
          unitPrices,
          values: {
            buy: quantity * unitPrices.buy,
            split: quantity * unitPrices.split,
            sell: quantity * unitPrices.sell,
          },
        };
      });
      const refiningPriced =
        batches > 0 &&
        refining.length > 0 &&
        refining.every((material) => material.quantity === 0 || material.unitPrices.split > 0) &&
        (remainder === 0 || rawUnitPrices.split > 0);
      const refiningValues = PRICE_MODES.reduce(
        (values, mode) => {
          values[mode] =
            refining.reduce((sum, material) => sum + material.values[mode], 0) +
            remainder * rawUnitPrices[mode];
          return values;
        },
        { buy: 0, split: 0, sell: 0 } as PriceValues,
      );
      const recommended = rawUnitPrices.split <= 0 || (refining.length > 0 && batches > 0 && !refiningPriced)
        ? 'unknown' : refiningPriced && refiningValues.split > rawValues.split ? 'refine' : 'raw';
      return {
        item,
        rawUnitPrices,
        rawValues,
        refiningValues,
        refiningPriced,
        refining,
        remainder,
        recommended,
        reprocessingEnabled,
        reprocessingLabel,
      };
    });

    const refiningMap = new Map<number, RefiningUnit>();
    for (const row of rows) {
      for (const output of row.refining) {
        if (output.quantity <= 0) continue;
        const current = refiningMap.get(output.id);
        const quantity = (current?.quantity ?? 0) + output.quantity;
        refiningMap.set(output.id, {
          id: output.id,
          quantity,
          unitPrices: output.unitPrices,
          values: {
            buy: quantity * output.unitPrices.buy,
            split: quantity * output.unitPrices.split,
            sell: quantity * output.unitPrices.sell,
          },
        });
      }
    }

    const discount = Math.min(100, Math.max(0, Number(contractDiscount) || 0)) / 100;
    const rawTotals = PRICE_MODES.reduce(
      (totals, mode) => {
        totals[mode] = rows.reduce((sum, row) => sum + row.rawValues[mode], 0);
        return totals;
      },
      { buy: 0, split: 0, sell: 0 } as PriceValues,
    );
    const bestTotals = PRICE_MODES.reduce(
      (totals, mode) => {
        totals[mode] = rows.reduce(
          (sum, row) => sum + Math.max(row.rawValues[mode], row.refiningPriced ? row.refiningValues[mode] : 0),
          0,
        );
        return totals;
      },
      { buy: 0, split: 0, sell: 0 } as PriceValues,
    );
    const discountedTotals: PriceValues = {
      buy: rawTotals.buy * (1 - discount),
      split: rawTotals.split * (1 - discount),
      sell: rawTotals.sell * (1 - discount),
    };

    return {
      rows,
      missing: Object.fromEntries(PRICE_MODES.map((mode) => [mode, rows.filter((row) => row.rawUnitPrices[mode] <= 0).length])) as PriceValues,
      bestIncomplete: rows.some((row) => row.recommended === 'unknown'),
      refining: Array.from(refiningMap.values()).sort((a, b) => b.values.split - a.values.split),
      rawTotals,
      bestTotals,
      discountedTotals,
      totalVolume: rows.reduce((sum, row) => sum + row.item.type.volume * row.item.quantity, 0),
    };
  // oxlint-disable-next-line react/react-compiler -- Imported localization helpers read this language state.
  }, [contractDiscount, equipmentReprocessing, items, language, markets, oreReprocessing, oreYield, scrapYield]);

  async function copySummary() {
    const market = REGIONS.find((item) => item.id === region)?.name ?? region;
    const lines = language === 'zh' ? [
      'Glory Navy 合同计价',
      `物品：${analysis.rows.length} 种`,
      `未识别 ${unmatched.length} 行；缺买价 ${analysis.missing.buy} 项，缺中间价 ${analysis.missing.split} 项，缺卖价 ${analysis.missing.sell} 项。缺价时总额仅为已知部分。`,
      `买单总价：${fullNumber.format(analysis.rawTotals.buy)} ISK；折价后 ${fullNumber.format(analysis.discountedTotals.buy)} ISK`,
      `中间总价：${fullNumber.format(analysis.rawTotals.split)} ISK；折价后 ${fullNumber.format(analysis.discountedTotals.split)} ISK`,
      `卖单总价：${fullNumber.format(analysis.rawTotals.sell)} ISK；折价后 ${fullNumber.format(analysis.discountedTotals.sell)} ISK`,
      `处理后最佳中间价：${fullNumber.format(analysis.bestTotals.split)} ISK`,
      `市场：${market}${marketScope === 'region' ? '（旧版星域报价）' : ''}`,
      `报价时间：${updatedAt?.toLocaleString(languageLocale()) ?? '未知'}`,
    ] : [
      'Glory Navy Contract Appraisal',
      `Items: ${analysis.rows.length} types`,
      `Unrecognized: ${unmatched.length} lines; missing buy ${analysis.missing.buy}, split ${analysis.missing.split}, sell ${analysis.missing.sell}. Totals with missing prices include known items only.`,
      `Buy total: ${fullNumber.format(analysis.rawTotals.buy)} ISK; after discount ${fullNumber.format(analysis.discountedTotals.buy)} ISK`,
      `Split total: ${fullNumber.format(analysis.rawTotals.split)} ISK; after discount ${fullNumber.format(analysis.discountedTotals.split)} ISK`,
      `Sell total: ${fullNumber.format(analysis.rawTotals.sell)} ISK; after discount ${fullNumber.format(analysis.discountedTotals.sell)} ISK`,
      `Best processed split value: ${fullNumber.format(analysis.bestTotals.split)} ISK`,
      `Market: ${market}${marketScope === 'region' ? ' (legacy regional quote)' : ''}`,
      `Priced at: ${updatedAt?.toLocaleString(languageLocale()) ?? 'Unknown'}`,
    ];
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied(true); }
    catch { setError(translate('无法自动复制，请允许浏览器使用剪贴板。', 'Automatic copy failed. Allow clipboard access in your browser.')); }
  }

  async function copyExactPrice(key: string, value: number) {
    try {
      await navigator.clipboard.writeText(copyableIsk(value));
      setCopiedPrice(key);
      setError('');
    } catch {
      setError(translate('无法复制精确价格，请允许浏览器使用剪贴板。', 'Could not copy the exact price. Allow clipboard access in your browser.'));
    }
  }

  async function createShareLink() {
    if (items.length === 0 || !updatedAt || loadingPrices || loadingShare || unmatched.length > 0) return;
    shareRequest.current?.abort();
    const controller = new AbortController();
    shareRequest.current = controller;
    setSharing(true);
    setLinkCopied(false);
    setError('');
    try {
      const prices: Record<string, [number, number]> = {};
      for (const [typeId, market] of Object.entries(markets)) {
        prices[typeId] = [marketPrice(market, 'buy'), marketPrice(market, 'sell')];
      }
      const savedTypes = Object.keys(prices).map((id): CompactType => {
        const type = snapshotTypes.get(Number(id)) ?? index?.byId.get(Number(id));
        return type ? [type.id, type.zh, type.en, type.volume, type.portionSize, type.categoryId, type.materials] : [Number(id), `Type ${id}`, `Type ${id}`, 0, 1, 0, null];
      });
      const result = await fetchJson<{ code?: string; createdAt?: string; error?: string }>('/api/appraisals', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          region,
          marketScope,
          pricedAt: updatedAt.toISOString(),
          types: savedTypes,
          settings: {
            ore: oreReprocessing,
            equipment: equipmentReprocessing,
            oreYield: Math.min(100, Math.max(0, Number(oreYield) || 0)),
            scrapYield: Math.min(100, Math.max(0, Number(scrapYield) || 0)),
            discount: Math.min(100, Math.max(0, Number(contractDiscount) || 0)),
          },
          items: items.map((item) => [item.type.id, item.quantity]),
          prices,
        }),
      });
      if (controller.signal.aborted) return;
      if (!result.code) throw new Error(result.error ?? translate('分享链接创建失败。', 'Failed to create the share link.'));
      const url = `${window.location.origin}${window.location.pathname}#contract/a/${result.code}`;
      window.history.replaceState(null, '', `${window.location.pathname}#contract/a/${result.code}`);
      setShareCode(result.code);
      setShareUrl(url);
      setSharedCreatedAt(result.createdAt ? new Date(result.createdAt) : new Date());
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : translate('分享链接创建失败。', 'Failed to create the share link.'));
    } finally {
      if (!controller.signal.aborted) setSharing(false);
    }
  }

  async function copyShareLink() {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); setLinkCopied(true); }
    catch { setError(translate('无法自动复制，请选中上方链接手动复制。', 'Automatic copy failed. Select the link above and copy it manually.')); }
  }

  return (
    <main className="site-shell min-h-screen text-foreground">
      <header className="site-header border-b border-border/80 bg-card/80 backdrop-blur-xl">
        <div className="site-header-grid mx-auto max-w-[1500px] px-4 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="brand-mark grid size-10 place-items-center border border-cyan-400/40 bg-cyan-400/10 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,.12)]">
              <Calculator className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="glory-wordmark font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Glory Navy</p>
              <h1 className="text-lg font-semibold tracking-tight">{translate('合同计价终端', 'Contract Appraisal Terminal')}</h1>
            </div>
          </div>
          <ServerStatus />
          <ToolNavigation active="contract" onSelect={onSwitch} />
        </div>
      </header>

      <div className="site-content mx-auto max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">
        <section className="hud-panel mb-6 grid gap-4 border border-border bg-card/80 p-4 shadow-2xl shadow-black/10 lg:grid-cols-[minmax(0,1.45fr)_minmax(360px,1fr)] sm:p-5">
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="contract-input" className="text-sm font-medium">{translate('粘贴物品清单', 'Paste item list')}</label>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-xs text-muted-foreground">{translate('支持 EVE 多列合同、中文、英文、Type ID', 'Supports EVE contract columns, Chinese, English and Type IDs')}</span>
                <Badge variant="outline" className="hidden border-emerald-400/25 text-emerald-200 sm:inline-flex">
                  {loadingData ? translate('SDE 加载中', 'Loading SDE') : `${fullNumber.format(index?.count ?? 0)} TYPES`}
                </Badge>
              </div>
            </div>
            <Textarea
              ref={contractInput}
              id="contract-input"
              value={input}
              onChange={(event) => { invalidateResults(); setInput(event.target.value); }}
              placeholder={translate('直接粘贴游戏合同清单，例如：\nPithum A-Type Medium Remote Shield Booster    1    Remote Shield Booster    Module', 'Paste an EVE contract list, for example:\nPithum A-Type Medium Remote Shield Booster    1    Remote Shield Booster    Module')}
              className="field-sizing-fixed h-72 min-h-48 max-h-[36rem] resize-y overflow-y-auto font-mono text-sm leading-6 lg:h-[32rem]"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => { invalidateResults(); setInput(SAMPLE); }}>
                <PackageOpen data-icon="inline-start" />{translate('载入示例', 'Load example')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { invalidateResults(); setInput(''); }}>
                <RotateCcw data-icon="inline-start" />{translate('清空', 'Clear')}
              </Button>
            </div>
          </div>

          <div className="grid min-w-0 content-start gap-3 sm:grid-cols-2">
            <label className="field-block sm:col-span-2" htmlFor="contract-region">
              <span>{translate('估值市场 · 默认吉他', 'Valuation market · Jita by default')}</span>
              <NativeSelect id="contract-region" value={region} onChange={(event) => { invalidateResults(); editSettings(); setRegion(event.target.value); }}>
                {REGIONS.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
              </NativeSelect>
            </label>
            <ReprocessingOption
              id="ore-reprocessing"
              label={translate('矿石化矿', 'Ore reprocessing')}
              description={translate('按矿石批量与综合收率计算', 'Uses ore batch sizes and the configured yield')}
              checked={oreReprocessing}
              onCheckedChange={(value) => { editSettings(); setOreReprocessing(value); }}
              yieldId="ore-yield"
              yieldValue={oreYield}
              onYieldChange={(value) => { editSettings(); setOreYield(value); }}
            />
            <ReprocessingOption
              id="equipment-reprocessing"
              label={translate('装备回收', 'Equipment recycling')}
              description={translate('按装备与舰船回收率计算', 'Uses the equipment and ship recycling yield')}
              checked={equipmentReprocessing}
              onCheckedChange={(value) => { editSettings(); setEquipmentReprocessing(value); }}
              yieldId="scrap-yield"
              yieldValue={scrapYield}
              onYieldChange={(value) => { editSettings(); setScrapYield(value); }}
            />
            <PercentInput id="contract-discount" label={translate('合同折价', 'Contract discount')} value={contractDiscount} onChange={(value) => { editSettings(); setContractDiscount(value); }} className="sm:col-span-2" />
            <p className="-mt-1 text-xs text-muted-foreground sm:col-span-2">{translate('市场、收率、处理开关与折价会自动保存在这台设备。', 'Market, yields, processing choices and discount are saved on this device.')}</p>
                    {error && (
          <div role="alert" className="sm:col-span-2 flex items-start gap-3 border border-red-400/25 bg-red-400/8 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
            <Button
              className="h-10 bg-cyan-400 text-slate-950 hover:bg-cyan-300 sm:col-span-2"
              onClick={() => { if (!index) { setError(''); setDataAttempt((value) => value + 1); } else void analyze(); }}
              disabled={loadingData || loadingPrices || loadingShare}
            >
              <RefreshCw className={loadingPrices || loadingShare ? 'animate-spin' : ''} data-icon="inline-start" />
              {loadingData ? translate('载入物品数据库', 'Loading item database') : !index ? translate('重试载入物品数据库', 'Retry item database') : loadingShare ? translate('载入分享估价', 'Loading shared appraisal') : loadingPrices ? translate('获取市场价格', 'Fetching market prices') : translate('解析并计算合同', 'Parse and appraise')}
            </Button>
            {analysis.rows.length > 0 && Object.keys(markets).length > 0 && (
              <section ref={appraisalTotals} tabIndex={-1} aria-label={translate('估价结果', 'Appraisal totals')} className="grid gap-3 border-t border-border/70 pt-3 sm:col-span-2 min-[420px]:grid-cols-2">
                {unmatched.length > 0 && <p className="text-sm text-amber-200 min-[420px]:col-span-2">{translate(`以下总价未包含 ${unmatched.length} 行未识别物品，请核对下方提示。`, `Totals exclude ${unmatched.length} unrecognized lines. Check the details below.`)}</p>}
                {shareUrl && <p className="text-xs text-muted-foreground min-[420px]:col-span-2">{translate('分享快照 · 报价时间：', 'Shared snapshot · Priced at: ')}{updatedAt?.toLocaleString(languageLocale())}{marketScope === 'region' ? translate(' · 旧版星域报价', ' · legacy regional quote') : ''}</p>}
                <SummaryCard
                  icon={<Database />}
                  label={analysis.missing.buy ? translate(`买单已知小计 · 缺 ${analysis.missing.buy} 项`, `Known buy subtotal · ${analysis.missing.buy} missing`) : translate('买单总价', 'Buy total')}
                  value={formatIsk(analysis.rawTotals.buy)}
                  meta={translate(`折价后 ${formatIsk(analysis.discountedTotals.buy)}`, `After discount ${formatIsk(analysis.discountedTotals.buy)}`)}
                  copy={{ label: translate('复制精确买单总价', 'Copy exact buy total'), copied: copiedPrice === 'buy', onCopy: () => void copyExactPrice('buy', analysis.rawTotals.buy) }}
                  metaCopy={{ label: translate('复制折价后精确买单价格', 'Copy exact discounted buy price'), copied: copiedPrice === 'buy-discounted', onCopy: () => void copyExactPrice('buy-discounted', analysis.discountedTotals.buy) }}
                />
                <SummaryCard
                  icon={<Calculator />}
                  label={analysis.missing.split ? translate(`中间已知小计 · 缺 ${analysis.missing.split} 项`, `Known split subtotal · ${analysis.missing.split} missing`) : translate('中间总价', 'Split total')}
                  value={formatIsk(analysis.rawTotals.split)}
                  meta={translate(`折价后 ${formatIsk(analysis.discountedTotals.split)}`, `After discount ${formatIsk(analysis.discountedTotals.split)}`)}
                  copy={{ label: translate('复制精确中间总价', 'Copy exact split total'), copied: copiedPrice === 'split', onCopy: () => void copyExactPrice('split', analysis.rawTotals.split) }}
                  metaCopy={{ label: translate('复制折价后精确中间价格', 'Copy exact discounted split price'), copied: copiedPrice === 'split-discounted', onCopy: () => void copyExactPrice('split-discounted', analysis.discountedTotals.split) }}
                  accent
                />
                <SummaryCard
                  icon={<PackageOpen />}
                  label={analysis.missing.sell ? translate(`卖单已知小计 · 缺 ${analysis.missing.sell} 项`, `Known sell subtotal · ${analysis.missing.sell} missing`) : translate('卖单总价', 'Sell total')}
                  value={formatIsk(analysis.rawTotals.sell)}
                  meta={translate(`折价后 ${formatIsk(analysis.discountedTotals.sell)}`, `After discount ${formatIsk(analysis.discountedTotals.sell)}`)}
                  copy={{ label: translate('复制精确卖单总价', 'Copy exact sell total'), copied: copiedPrice === 'sell', onCopy: () => void copyExactPrice('sell', analysis.rawTotals.sell) }}
                  metaCopy={{ label: translate('复制折价后精确卖单价格', 'Copy exact discounted sell price'), copied: copiedPrice === 'sell-discounted', onCopy: () => void copyExactPrice('sell-discounted', analysis.discountedTotals.sell) }}
                />
                <SummaryCard
                  icon={<FlaskConical />}
                  label={analysis.bestIncomplete ? translate('处理后已知小计 · 报价不完整', 'Known processed subtotal · prices incomplete') : translate('处理后最佳中间价', 'Best processed split value')}
                  value={formatIsk(analysis.bestTotals.split)}
                  meta={translate(`原物中间价 ${formatIsk(analysis.rawTotals.split)}`, `Raw split value ${formatIsk(analysis.rawTotals.split)}`)}
                  copy={{ label: translate('复制处理后精确价格', 'Copy exact processed price'), copied: copiedPrice === 'processed', onCopy: () => void copyExactPrice('processed', analysis.bestTotals.split) }}
                  metaCopy={{ label: translate('复制原物精确中间价', 'Copy exact raw split value'), copied: copiedPrice === 'processed-raw', onCopy: () => void copyExactPrice('processed-raw', analysis.rawTotals.split) }}
                />
                <div className="flex flex-wrap gap-2 min-[420px]:col-span-2">
                  <Button variant="outline" size="sm" onClick={() => void createShareLink()} disabled={sharing || loadingPrices || loadingShare || unmatched.length > 0} title={unmatched.length > 0 ? translate('请先修正未识别行，再生成完整的分享估价', 'Fix unrecognized lines before creating a complete shared appraisal.') : undefined}>
                    <Share2 className={sharing ? 'animate-pulse' : ''} data-icon="inline-start" />
                    {sharing ? translate('正在生成', 'Creating') : translate('生成分享链接', 'Create share link')}
                  </Button>
                  <Button variant="outline" size="sm" disabled={loadingPrices || loadingShare} onClick={() => void copySummary()}>
                    {copied ? <Check data-icon="inline-start" /> : <ClipboardCopy data-icon="inline-start" />}
                    {copied ? translate('已复制', 'Copied') : translate('复制结算摘要', 'Copy summary')}
                  </Button>
                </div>
                {unmatched.length > 0 && <p className="text-sm text-amber-200 min-[420px]:col-span-2">{translate(`先修正 ${unmatched.length} 行未识别内容，才能生成完整分享。`, `Fix ${unmatched.length} unrecognized lines before sharing.`)} <Button variant="link" className="h-auto p-0 text-cyan-200" onClick={() => returnToInput(unmatchedLines[0])}>{translate('返回清单修正', 'Edit input')}</Button></p>}
                <Button variant="ghost" className="min-[420px]:col-span-2" onClick={() => document.getElementById('contract-breakdown')?.scrollIntoView({ block: 'start' })}>{translate('查看逐项结算 ↓', 'View item breakdown ↓')}</Button>
            {shareUrl && (
              <section className="hud-panel min-[420px]:col-span-2 flex flex-col gap-3 border border-cyan-400/30 bg-cyan-400/6 p-4 ">
                <div className="grid size-9 shrink-0 place-items-center border border-cyan-400/30 bg-cyan-400/10 text-cyan-200">
                  <Link2 className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-cyan-100">{translate('分享估价', 'Shared appraisal')} {shareCode}</p>
                  <a className="block truncate font-mono text-xs text-cyan-300 hover:text-cyan-200" href={shareUrl}>{shareUrl}</a>
                  <p className="mt-1 text-xs text-muted-foreground">{translate('提交者的估价快照，保存物品、配方、报价与设置，有效期 90 天。', 'This snapshot preserves items, recipes, prices and settings for 90 days.')} {translate('报价时间：', 'Priced at: ')}{updatedAt?.toLocaleString(languageLocale())}{marketScope === 'region' ? translate(' · 旧版星域报价', ' · legacy regional quote') : ''}.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void copyShareLink()}>
                  {linkCopied ? <Check data-icon="inline-start" /> : <ClipboardCopy data-icon="inline-start" />}
                  {linkCopied ? translate('链接已复制', 'Link copied') : translate('复制链接', 'Copy link')}
                </Button>
              </section>
            )}
              </section>
            )}
          </div>
        </section>



        {unmatched.length > 0 && (
          <div className="mb-6 border border-amber-400/25 bg-amber-400/8 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-200">
              <AlertTriangle className="size-4" />{translate(`未识别 ${unmatched.length} 行`, `${unmatched.length} unrecognized lines`)}
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">{(showAllUnmatched ? unmatchedLines : unmatchedLines.slice(0, 20)).map((line, i) => <button type="button" key={i} className="block w-full break-words px-2 py-2 text-left font-mono text-sm text-amber-100/80 hover:bg-amber-400/10 focus-visible:outline-2 focus-visible:outline-cyan-300" onClick={() => returnToInput(line)}><span className="mr-3 text-amber-200">{translate(`第 ${line.line} 行`, `Line ${line.line}`)}</span>{line.text}</button>)}</div>{unmatched.length > 20 && <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowAllUnmatched((value) => !value)}>{showAllUnmatched ? translate('收起', 'Show less') : translate(`展开全部 ${unmatched.length} 行`, `Show all ${unmatched.length} lines`)}</Button>}
            <p className="mt-2 text-xs text-amber-100/80">{translate('未识别行未计入总价。重名物品请使用 Type ID 或唯一英文名；数量只接受正整数及千分位格式。', 'Unrecognized lines are excluded. For duplicate names, use a Type ID or unique English name. Quantities must be positive whole numbers.')}</p>
          </div>
        )}

        {analysis.rows.length > 0 && Object.keys(markets).length > 0 && (
          <>

            <CourierQuote
              volume={analysis.totalVolume}
              collateral={analysis.rawTotals.sell}
              missingCollateralPrices={analysis.missing.sell}
            />


            <section id="contract-breakdown" className="tool-table-scroll tool-result-anchor hud-panel mb-6 overflow-hidden border border-border bg-card/85 shadow-2xl shadow-black/10">
              <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold">{translate('逐项结算', 'Item breakdown')}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{translate('化矿价值包含不足一批的剩余原物价值。', 'Processed value includes the raw value of quantities below one full batch.')}</p>
                </div>

              </div>
              <Table className="mobile-row-table contract-result-table">
                <TableHeader>
                  <TableRow className="bg-muted/25 hover:bg-muted/25">
                    <TableHead className="min-w-72 pl-4">{translate('物品', 'Item')}</TableHead>
                    <TableHead className="text-right">{translate('数量', 'Quantity')}</TableHead>
                    <TableHead className="text-right">{translate('买单总值', 'Buy value')}</TableHead>
                    <TableHead className="text-right">{translate('中间总值', 'Split value')}</TableHead>
                    <TableHead className="text-right">{translate('卖单总值', 'Sell value')}</TableHead>
                    <TableHead className="text-right">{translate('重处理中间值', 'Processed split')}</TableHead>
                    <TableHead className="pr-4 text-right">{translate('建议', 'Recommendation')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.rows.map((row) => (
                    <TableRow key={row.item.type.id}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-3">
                          <EveTypeIcon typeId={row.item.type.id} blueprint={row.item.type.categoryId === 9} />
                          <div className="min-w-0">
                            <div className="font-medium text-slate-100">{typeName(row.item.type)}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Type {row.item.type.id} · {formatQuantity(row.item.type.volume)} m³/{translate('件', 'unit')}
                              {row.reprocessingEnabled && row.remainder > 0 && row.item.type.materials.length > 0 ? translate(` · 余料 ${formatQuantity(row.remainder)}`, ` · remainder ${formatQuantity(row.remainder)}`) : ''}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell data-label={translate('数量', 'Quantity')} className="text-right font-mono">{formatQuantity(row.item.quantity)}</TableCell>
                      <TableCell data-label={translate('买单总值', 'Buy value')} className="text-right font-mono">{row.rawUnitPrices.buy > 0 ? formatIsk(row.rawValues.buy) : translate('缺价', 'No price')}</TableCell>
                      <TableCell data-label={translate('中间总值', 'Split value')} className="text-right font-mono text-cyan-100">{row.rawUnitPrices.split > 0 ? formatIsk(row.rawValues.split) : translate('缺价', 'No price')}</TableCell>
                      <TableCell data-label={translate('卖单总值', 'Sell value')} className="text-right font-mono">{row.rawUnitPrices.sell > 0 ? formatIsk(row.rawValues.sell) : translate('缺价', 'No price')}</TableCell>
                      <TableCell data-label={translate('重处理中间值', 'Processed split')} className="text-right font-mono">
                        {!row.reprocessingEnabled ? translate('未启用', 'Disabled') : row.refiningPriced ? formatIsk(row.refiningValues.split) : translate('不可处理/缺价', 'Unavailable / no price')}
                      </TableCell>
                      <TableCell data-label={translate('建议', 'Recommendation')} className="pr-4 text-right">
                        <Badge variant="outline" className={row.recommended === 'refine' ? 'border-cyan-400/30 text-cyan-200' : 'border-emerald-400/30 text-emerald-200'}>
                          {row.recommended === 'unknown' ? translate('缺价待定', 'Price needed') : row.recommended === 'refine' ? row.reprocessingLabel : translate('卖原物', 'Sell raw')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            {analysis.refining.length > 0 && (
              <section className="hud-panel overflow-hidden border border-border bg-card/85">
                <div className="border-b border-border p-4">
                  <h2 className="font-semibold">{translate('全部重处理产物', 'All reprocessing outputs')}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{translate('按设定收率向下取整；实际结果请以游戏重处理窗口为准。', 'Quantities are rounded down at the configured yield. Confirm the final result in the EVE reprocessing window.')}</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/25 hover:bg-muted/25">
                      <TableHead className="pl-4">{translate('产物', 'Output')}</TableHead>
                      <TableHead className="text-right">{translate('数量', 'Quantity')}</TableHead>
                      <TableHead className="text-right">{translate('买单总值', 'Buy value')}</TableHead>
                      <TableHead className="text-right">{translate('中间总值', 'Split value')}</TableHead>
                      <TableHead className="pr-4 text-right">{translate('卖单总值', 'Sell value')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.refining.map((material) => (
                      <TableRow key={material.id}>
                        <TableCell className="pl-4 font-medium">
                          <div className="flex items-center gap-3">
                            <EveTypeIcon typeId={material.id} />
                            <span>{typeName(snapshotTypes.get(material.id) ?? index?.byId.get(material.id))} · {material.id}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatQuantity(material.quantity)}</TableCell>
                        <TableCell className="text-right font-mono">{material.unitPrices.buy > 0 ? formatIsk(material.values.buy) : translate('缺价', 'No price')}</TableCell>
                        <TableCell className="text-right font-mono text-cyan-200">{material.unitPrices.split > 0 ? formatIsk(material.values.split) : translate('缺价', 'No price')}</TableCell>
                        <TableCell className="pr-4 text-right font-mono">{material.unitPrices.sell > 0 ? formatIsk(material.values.sell) : translate('缺价', 'No price')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}
          </>
        )}

        <footer className="flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{translate('物品与重处理配方：', 'Items and reprocessing recipes: ')}{index?.source ?? 'CCP SDE'}; {translate('市场报价：', 'market prices: ')}Fuzzwork.</p>
          <p>{sharedCreatedAt ? translate(`分享估价创建于 ${sharedCreatedAt.toLocaleString(languageLocale())}`, `Shared appraisal created ${sharedCreatedAt.toLocaleString(languageLocale())}`) : updatedAt ? translate(`更新于 ${updatedAt.toLocaleTimeString(languageLocale(), { hour: '2-digit', minute: '2-digit' })}`, `Updated ${updatedAt.toLocaleTimeString(languageLocale(), { hour: '2-digit', minute: '2-digit' })}`) : translate('清单只在当前浏览器中处理', 'The list is processed only in this browser')}</p>
        </footer>
      </div>
    </main>
  );
}

function ReprocessingOption({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  yieldId,
  yieldValue,
  onYieldChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  yieldId: string;
  yieldValue: string;
  onYieldChange: (value: string) => void;
}) {
  return (
    <div className="reprocessing-option" data-enabled={checked}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <label htmlFor={id} className="text-sm font-medium text-slate-100">{label}</label>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          aria-label={label}
          className="mt-0.5"
        />
      </div>
      <PercentInput
        id={yieldId}
        label={translate('处理收率', 'Processing yield')}
        value={yieldValue}
        onChange={onYieldChange}
        disabled={!checked}
      />
    </div>
  );
}

function PercentInput({
  id,
  label,
  value,
  onChange,
  className = '',
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`field-block ${className}`} htmlFor={id}>
      <span>{label}</span>
      <div className="relative">
        <Input id={id} type="number" min="0" max="100" step="0.1" value={value} onChange={(event) => onChange(event.target.value)} className="pr-8" disabled={disabled} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
      </div>
    </label>
  );
}

type PriceCopyAction = {
  label: string;
  copied: boolean;
  onCopy: () => void;
};

function PriceCopyButton({ action }: { action: PriceCopyAction }) {
  const label = action.copied ? translate('精确价格已复制', 'Exact price copied') : action.label;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="relative z-10 shrink-0 text-muted-foreground hover:text-cyan-200"
      onClick={action.onCopy}
      title={label}
    >
      {action.copied ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
      <span className="sr-only" aria-live="polite">{label}</span>
    </Button>
  );
}

function SummaryCard({ icon, label, value, meta, copy, metaCopy, accent = false }: { icon: React.ReactNode; label: string; value: string; meta: string; copy: PriceCopyAction; metaCopy: PriceCopyAction; accent?: boolean }) {
  return (
    <article className={`hud-card relative min-w-0 overflow-hidden border bg-card/80 p-4 ${accent ? 'border-cyan-400/35' : 'border-border'}`}>
      {accent && <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-cyan-400/8 to-transparent" aria-hidden="true" />}
      <div className="mb-3 flex items-start justify-between gap-2 text-muted-foreground">
        <span className="text-xs uppercase tracking-[0.14em]">{label}</span>
        <span className="shrink-0 [&_svg]:size-4">{icon}</span>
      </div>
      <div className="flex min-w-0 items-start gap-1">
        <p className={`min-w-0 flex-1 break-words font-mono text-lg font-semibold xl:text-xl ${accent ? 'text-cyan-200' : 'text-slate-100'}`}>{value}</p>
        <PriceCopyButton action={copy} />
      </div>
      <div className="mt-1 flex min-w-0 items-start gap-1">
        <p className="min-w-0 flex-1 break-words text-xs text-muted-foreground">{meta}</p>
        <PriceCopyButton action={metaCopy} />
      </div>
    </article>
  );
}
