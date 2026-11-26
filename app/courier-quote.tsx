'use client';

import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import {
  calculateCourierQuote,
  type CourierAppraisal,
  type CourierAppraisalResponse,
  type CourierRoutesData,
} from '@/lib/courier';
import { fetchJson } from '@/lib/fetch-json';
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  ExternalLink,
  LoaderCircle,
  PackageSearch,
  Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { formatLocalizedNumber, translate, useLanguage } from './language-provider';

const compactNumber = { format: (value: number) => formatLocalizedNumber(value, { notation: 'compact', maximumFractionDigits: 2 }) };
const fullNumber = { format: (value: number) => formatLocalizedNumber(value, { maximumFractionDigits: 2 }) };

function formatIsk(value: number) {
  if (!Number.isFinite(value)) return '—';
  return `${compactNumber.format(value)} ISK`;
}

function formatQuantity(value: number) {
  return fullNumber.format(value);
}

type CourierGroup<T> = {
  name: string;
  priority: number;
  values: T[];
};

function groupCourierValues<T>(
  values: T[],
  location: (value: T) => string,
  categories: CourierRoutesData['location_categories'],
) {
  const groups = new Map<string, CourierGroup<T>>();
  for (const value of values) {
    const category = categories[location(value)];
    const name = category?.category_name || 'Other';
    const group = groups.get(name) ?? { name, priority: category?.category_priority ?? 999_999, values: [] };
    group.values.push(value);
    groups.set(name, group);
  }
  return Array.from(groups.values()).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

function numericInput(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function validAppraisal(value: unknown): CourierAppraisal | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CourierAppraisal>;
  if (![candidate.buy_price, candidate.sell_price, candidate.volume].every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0)) return null;

  const failedItems = candidate.failed_items && typeof candidate.failed_items === 'object'
    ? Object.fromEntries(Object.entries(candidate.failed_items).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0))
    : {};
  let janiceUrl: string | null = null;
  if (typeof candidate.janice_url === 'string') {
    try {
      const parsed = new URL(candidate.janice_url);
      if (parsed.protocol === 'https:' && parsed.hostname === 'janice.e-351.com') janiceUrl = parsed.toString();
    } catch {
      janiceUrl = null;
    }
  }

  return {
    buy_price: candidate.buy_price as number,
    sell_price: candidate.sell_price as number,
    volume: candidate.volume as number,
    janice_url: janiceUrl,
    failed_items: failedItems,
  };
}

type CopiedField = 'all' | 'corporation' | 'destination' | 'reward' | 'collateral';

function CopyValueButton({
  copied,
  copyLabel,
  copiedLabel,
  onCopy,
}: {
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
  onCopy: () => void;
}) {
  const label = copied ? copiedLabel : copyLabel;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={`size-11 shrink-0 ${copied ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' : ''}`}
      aria-label={label}
      title={label}
      onClick={onCopy}
    >
      {copied ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
    </Button>
  );
}

export function CourierQuote({
  volume = 0,
  collateral = 0,
  missingCollateralPrices = 0,
  standalone = false,
}: {
  volume?: number;
  collateral?: number;
  missingCollateralPrices?: number;
  standalone?: boolean;
}) {
  const { language } = useLanguage();
  const [data, setData] = useState<CourierRoutesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [routeError, setRouteError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [origin, setOrigin] = useState('');
  const [routeId, setRouteId] = useState('');
  const [additionalVolume, setAdditionalVolume] = useState('0');
  const [additionalCollateral, setAdditionalCollateral] = useState('0');
  const [appraisalText, setAppraisalText] = useState('');
  const [appraisal, setAppraisal] = useState<CourierAppraisal | null>(null);
  const [appraisalLoading, setAppraisalLoading] = useState(false);
  const [appraisalError, setAppraisalError] = useState('');
  const [appraisalFromCache, setAppraisalFromCache] = useState(false);
  const [copiedField, setCopiedField] = useState<CopiedField | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadRoutes() {
      setLoading(true);
      setRouteError('');
      try {
        const next = await fetchJson<CourierRoutesData>('/api/courier/routes', { signal: controller.signal }, 10_000);
        if (!Array.isArray(next.routes) || !next.location_categories) throw new Error(translate('快递路线数据格式无效。', 'Courier route data is invalid.'));
        if (!controller.signal.aborted) setData(next);
      } catch (reason) {
        if (!controller.signal.aborted) setRouteError(reason instanceof Error ? reason.message : translate('快递路线加载失败。', 'Failed to load courier routes.'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadRoutes();
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!copiedField) return;
    const timer = window.setTimeout(() => setCopiedField(null), 1_500);
    return () => window.clearTimeout(timer);
  }, [copiedField]);

  const activeRoutes = useMemo(() => (data?.routes ?? []).filter((route) => !route.paused), [data]);
  const origins = useMemo(() => Array.from(new Set(activeRoutes.map((route) => route.start))).sort(), [activeRoutes]);
  const originGroups = useMemo(() => groupCourierValues(origins, (value) => value, data?.location_categories ?? {}), [data, origins]);
  const destinationRoutes = useMemo(() => activeRoutes.filter((route) => route.start === origin).sort((a, b) => a.end.localeCompare(b.end) || a.transport_type.localeCompare(b.transport_type)), [activeRoutes, origin]);
  const destinationGroups = useMemo(() => groupCourierValues(destinationRoutes, (route) => route.end, data?.location_categories ?? {}), [data, destinationRoutes]);
  const route = useMemo(() => activeRoutes.find((candidate) => String(candidate.id) === routeId), [activeRoutes, routeId]);
  const appraisalVolume = standalone ? appraisal?.volume ?? 0 : volume;
  const appraisalCollateral = standalone ? appraisal?.sell_price ?? 0 : collateral;
  const quote = useMemo(() => route ? calculateCourierQuote(route, {
    volume: appraisalVolume,
    collateral: appraisalCollateral,
    additionalVolume: numericInput(additionalVolume),
    additionalCollateral: numericInput(additionalCollateral),
  }) : null, [additionalCollateral, additionalVolume, appraisalCollateral, appraisalVolume, route]);
  const failedItems = Object.entries(appraisal?.failed_items ?? {});

  function chooseOrigin(value: string) {
    setOrigin(value);
    setCopiedField(null);
    const matching = activeRoutes.filter((candidate) => candidate.start === value);
    setRouteId(matching.length === 1 ? String(matching[0].id) : '');
  }

  function changeAppraisalText(value: string) {
    setAppraisalText(value);
    setAppraisalError('');
    setAppraisal(null);
    setAppraisalFromCache(false);
    setCopiedField(null);
  }

  async function processAppraisal(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = appraisalText.trim();
    if (!text) {
      setAppraisal(null);
      setAppraisalError(translate('请先粘贴物品名称与数量。', 'Paste item names and quantities first.'));
      return;
    }

    setAppraisalLoading(true);
    setAppraisalError('');
    setAppraisal(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch('/api/courier/appraisal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appraisal_text: text }),
        signal: controller.signal,
      });
      const payload = await response.json() as CourierAppraisalResponse;
      const nextAppraisal = validAppraisal(payload.appraisal);
      if (!response.ok || !payload.success || !nextAppraisal) {
        throw new Error(payload.error || translate('估价服务没有返回有效结果。', 'The appraisal service returned no valid result.'));
      }
      setAppraisal(nextAppraisal);
      setAppraisalFromCache(Boolean(payload.from_cache));
      setCopiedField(null);
    } catch (reason) {
      const message = reason instanceof DOMException && reason.name === 'AbortError'
        ? translate('估价服务响应超时，请重试。', 'The appraisal service timed out. Please retry.')
        : reason instanceof Error ? reason.message : translate('物品估价失败，请稍后重试。', 'Item appraisal failed. Please retry later.');
      setAppraisalError(message);
    } finally {
      window.clearTimeout(timer);
      setAppraisalLoading(false);
    }
  }

  async function copyValue(field: CopiedField, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
    } catch {
      setRouteError(translate('无法自动复制快递合同信息，请允许浏览器使用剪贴板。', 'Automatic copy failed. Allow clipboard access in your browser.'));
    }
  }

  function copyContractDetails() {
    if (!route || !quote) return;
    const lines = language === 'zh' ? [
      'Heavy Assets Logistics 快递合同',
      `路线：${route.start} → ${route.end}`,
      '合同发给：Heavy Assets Logistics',
      `运送至：${route.end}`,
      `报酬：${Math.round(quote.totalCost)} ISK`,
      `押金：${Math.round(quote.totalCollateral)} ISK`,
      `到期 / 完成：${route.expiration} 天 / ${route.completion} 天`,
      `体积：${fullNumber.format(quote.totalVolume)} m³`,
    ] : [
      'Heavy Assets Logistics courier contract',
      `Route: ${route.start} → ${route.end}`,
      'Contract to: Heavy Assets Logistics',
      `Ship to: ${route.end}`,
      `Reward: ${Math.round(quote.totalCost)} ISK`,
      `Collateral: ${Math.round(quote.totalCollateral)} ISK`,
      `Expiration / completion: ${route.expiration} days / ${route.completion} days`,
      `Volume: ${fullNumber.format(quote.totalVolume)} m³`,
    ];
    void copyValue('all', lines.join('\n'));
  }

  return (
    <section className="hud-panel mb-6 overflow-hidden border border-border bg-card/85 shadow-2xl shadow-black/10" aria-busy={loading || appraisalLoading}>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center border border-cyan-400/30 bg-cyan-400/10 text-cyan-200">
            <Truck className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-semibold">{translate('HA Logistics 快递计算', 'HA Logistics courier calculator')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{standalone
              ? translate('估算物品货值和体积，匹配实时路线，并生成可直接照填的合同参数。', 'Appraise item value and volume, match a live route, and generate ready-to-use contract details.')
              : translate('自动使用当前清单体积与卖单总价，按 HA Logistics 实时路线运价计算。', 'Uses the current cargo volume and sell total with live HA Logistics route pricing.')}</p>
          </div>
        </div>
        <a className="inline-flex min-h-11 items-center gap-2 self-start px-2 text-sm text-cyan-300 hover:text-cyan-200 sm:self-auto" href="https://hallogistics.space/" target="_blank" rel="noreferrer">
          {translate('打开服务官网', 'Open service')}<ExternalLink className="size-4" aria-hidden="true" />
        </a>
      </div>

      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,.82fr)]">
        <div className="grid content-start gap-5">
          {standalone && (
            <form className="border border-border bg-background/30 p-4" onSubmit={(event) => void processAppraisal(event)}>
              <div className="mb-3 flex items-start gap-3">
                <PackageSearch className="mt-0.5 size-5 shrink-0 text-cyan-300" aria-hidden="true" />
                <div>
                  <h3 className="font-medium">{translate('1. 估价物品清单', '1. Appraise item list')}</h3>
                  <p id="courier-appraisal-help" className="mt-1 text-xs leading-5 text-muted-foreground">{translate('每行填写物品名称和数量，例如 “Tritanium 10000”。支持从 EVE 清单直接粘贴。', 'Enter an item name and quantity per line, such as “Tritanium 10000”. You can paste an EVE item list directly.')}</p>
                </div>
              </div>
              <label className="field-block" htmlFor="courier-appraisal-text">
                <span>{translate('物品与数量', 'Items and quantities')}</span>
                <Textarea
                  id="courier-appraisal-text"
                  className="mt-2 min-h-36 max-h-72 resize-y font-mono leading-6"
                  value={appraisalText}
                  maxLength={100_000}
                  aria-describedby={`courier-appraisal-help${appraisalError ? ' courier-appraisal-error' : ''}`}
                  aria-invalid={Boolean(appraisalError)}
                  placeholder={'Tritanium 10000\nIsogen 5000'}
                  onChange={(event) => changeAppraisalText(event.target.value)}
                />
              </label>
              {appraisalError && <p id="courier-appraisal-error" role="alert" className="mt-3 flex items-start gap-2 text-sm text-red-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{appraisalError}</p>}
              <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-muted-foreground">{translate('点击估价后，清单会提交至 HA Logistics 的 Janice 估价服务。', 'When you appraise, the list is sent to HA Logistics’ Janice appraisal service.')}</p>
                <Button type="submit" size="lg" className="min-h-11 sm:min-w-32" disabled={appraisalLoading}>
                  {appraisalLoading ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <PackageSearch data-icon="inline-start" aria-hidden="true" />}
                  {appraisalLoading ? translate('正在估价', 'Appraising') : translate('获取估价', 'Get appraisal')}
                </Button>
              </div>

              {appraisal && (
                <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2" aria-live="polite">
                  <div className="border border-cyan-400/20 bg-cyan-400/5 p-3">
                    <p className="text-xs text-muted-foreground">{translate('估算卖价', 'Estimated sell value')}</p>
                    <p className="mt-1 break-words font-mono text-lg font-semibold text-cyan-200">{formatIsk(appraisal.sell_price)}</p>
                  </div>
                  <div className="border border-cyan-400/20 bg-cyan-400/5 p-3">
                    <p className="text-xs text-muted-foreground">{translate('估算体积', 'Estimated volume')}</p>
                    <p className="mt-1 break-words font-mono text-lg font-semibold text-cyan-200">{formatQuantity(appraisal.volume)} m³</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:col-span-2">
                    {appraisal.janice_url && <a className="inline-flex min-h-10 items-center gap-2 text-cyan-300 hover:text-cyan-200" href={appraisal.janice_url} target="_blank" rel="noreferrer">{translate('在 Janice 查看估价', 'View appraisal on Janice')}<ExternalLink className="size-4" aria-hidden="true" /></a>}
                    {appraisalFromCache && <span className="text-xs text-muted-foreground">{translate('使用缓存估价', 'Cached appraisal')}</span>}
                  </div>
                  {failedItems.length > 0 && (
                    <div role="alert" className="border border-amber-400/25 bg-amber-400/8 p-3 text-sm text-amber-100 sm:col-span-2">
                      <p className="font-medium">{translate('以下物品未能识别，未计入货值与体积：', 'These items were not recognized and are excluded from value and volume:')}</p>
                      <ul className="mt-2 grid list-disc gap-1 pl-5 sm:grid-cols-2">
                        {failedItems.map(([name, quantity]) => <li key={name}>{name} × {formatQuantity(quantity)}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </form>
          )}

          <div className="grid content-start gap-3 border border-border bg-background/30 p-4 sm:grid-cols-2">
            <h3 className="font-medium sm:col-span-2">{standalone ? translate('2. 选择路线与附加项', '2. Choose route and extras') : translate('选择路线与附加项', 'Choose route and extras')}</h3>
            {routeError && (
              <div role="alert" className="flex items-start justify-between gap-3 border border-red-400/25 bg-red-400/8 p-4 text-sm text-red-200 sm:col-span-2">
                <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{routeError}</span>
                {!data && <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>{translate('重试', 'Retry')}</Button>}
              </div>
            )}
            <label className="field-block" htmlFor="courier-origin">
              <span>{translate('出发地', 'Origin')}</span>
              <NativeSelect className="mt-2 w-full [&_[data-slot=native-select]]:h-11" id="courier-origin" value={origin} disabled={loading || !data} onChange={(event) => chooseOrigin(event.target.value)}>
                <NativeSelectOption value="">{loading ? translate('正在加载路线', 'Loading routes') : translate('选择出发地', 'Select origin')}</NativeSelectOption>
                {originGroups.map((group) => (
                  <NativeSelectOptGroup key={group.name} label={group.name}>
                    {group.values.map((value) => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}
                  </NativeSelectOptGroup>
                ))}
              </NativeSelect>
            </label>
            <label className="field-block" htmlFor="courier-route">
              <span>{translate('目的地', 'Destination')}</span>
              <NativeSelect className="mt-2 w-full [&_[data-slot=native-select]]:h-11" id="courier-route" value={routeId} disabled={!origin || destinationRoutes.length === 0} onChange={(event) => { setRouteId(event.target.value); setCopiedField(null); }}>
                <NativeSelectOption value="">{translate('选择目的地', 'Select destination')}</NativeSelectOption>
                {destinationGroups.map((group) => (
                  <NativeSelectOptGroup key={group.name} label={group.name}>
                    {group.values.map((value) => <NativeSelectOption key={value.id} value={String(value.id)}>{value.end} · {value.transport_type}</NativeSelectOption>)}
                  </NativeSelectOptGroup>
                ))}
              </NativeSelect>
            </label>
            <label className="field-block" htmlFor="courier-extra-volume">
              <span>{translate('附加体积', 'Additional volume')}</span>
              <div className="relative mt-2">
                <Input id="courier-extra-volume" type="number" min="0" step="0.01" inputMode="decimal" aria-describedby="courier-input-note" value={additionalVolume} onChange={(event) => { setAdditionalVolume(event.target.value); setCopiedField(null); }} className="h-11 pr-12" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">m³</span>
              </div>
            </label>
            <label className="field-block" htmlFor="courier-extra-collateral">
              <span>{translate('附加押金', 'Additional collateral')}</span>
              <div className="relative mt-2">
                <Input id="courier-extra-collateral" type="number" min="0" step="1" inputMode="decimal" aria-describedby="courier-input-note" value={additionalCollateral} onChange={(event) => { setAdditionalCollateral(event.target.value); setCopiedField(null); }} className="h-11 pr-12" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">ISK</span>
              </div>
            </label>
            <p id="courier-input-note" className="text-xs leading-5 text-muted-foreground sm:col-span-2">{standalone
              ? appraisal
                ? translate(`已自动带入 ${formatQuantity(appraisal.volume)} m³ 与 ${formatIsk(appraisal.sell_price)}。附加项仅用于补充清单外货物。`, `Included ${formatQuantity(appraisal.volume)} m³ and ${formatIsk(appraisal.sell_price)}. Extras are only for cargo outside the list.`)
                : translate('未使用物品估价时，可把全部体积和合同押金填入附加项进行手动计算。', 'Without an item appraisal, enter all volume and collateral in the additional fields for a manual quote.')
              : translate(`已带入 ${formatQuantity(volume)} m³ 与 ${formatIsk(collateral)} 卖单估值。附加项用于补充清单外的体积或押金。`, `Included ${formatQuantity(volume)} m³ and ${formatIsk(collateral)} sell valuation. Use additional fields for cargo outside the appraisal.`)}</p>
            {missingCollateralPrices > 0 && <output className="text-sm text-amber-200 sm:col-span-2">{translate(`有 ${missingCollateralPrices} 项缺少卖价，当前押金与运费仅按已知小计计算。`, `${missingCollateralPrices} items have no sell price; collateral and reward use the known subtotal only.`)}</output>}
          </div>
        </div>

        <aside className="border border-border bg-background/35 p-4 lg:sticky lg:top-[var(--tool-header-clearance)] lg:self-start" aria-live="polite">
          <h3 className="font-medium">{standalone ? translate('3. 合同参数', '3. Contract details') : translate('合同参数', 'Contract details')}</h3>
          {!route || !quote ? (
            <div className="grid min-h-56 place-items-center text-center text-sm text-muted-foreground">
              <div><Truck className="mx-auto mb-3 size-7 text-cyan-300/70" aria-hidden="true" /><p>{translate('完成路线选择后，这里会生成合同报酬与填写参数。', 'Choose a route to generate the reward and contract details here.')}</p></div>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{translate('合同报酬', 'Contract reward')}</p>
                  <p className="mt-1 break-words font-mono text-2xl font-semibold text-cyan-200">{formatIsk(quote.totalCost)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{fullNumber.format(Math.round(quote.totalCost))} ISK{quote.minimumApplied ? translate(' · 已应用最低运费', ' · route minimum applied') : ''}</p>
                </div>
                <CopyValueButton
                  copied={copiedField === 'reward'}
                  copyLabel={translate('复制合同报酬', 'Copy contract reward')}
                  copiedLabel={translate('合同报酬已复制', 'Contract reward copied')}
                  onCopy={() => void copyValue('reward', Math.round(quote.totalCost).toString())}
                />
              </div>
              <dl className="divide-y divide-border border-y border-border text-sm">
                <div className="py-3"><dt className="text-xs text-muted-foreground">{translate('路线', 'Route')}</dt><dd className="mt-1 break-words text-slate-100">{route.start} → {route.end}</dd></div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">{translate('合同发给', 'Contract to')}</dt>
                  <dd className="mt-1 flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 break-words text-slate-100">Heavy Assets Logistics</span>
                    <CopyValueButton
                      copied={copiedField === 'corporation'}
                      copyLabel={translate('复制合同收件方', 'Copy contract recipient')}
                      copiedLabel={translate('合同收件方已复制', 'Contract recipient copied')}
                      onCopy={() => void copyValue('corporation', 'Heavy Assets Logistics')}
                    />
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">{translate('运送至', 'Ship to')}</dt>
                  <dd className="mt-1 flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 break-words text-slate-100">{route.end}</span>
                    <CopyValueButton
                      copied={copiedField === 'destination'}
                      copyLabel={translate('复制目的地', 'Copy destination')}
                      copiedLabel={translate('目的地已复制', 'Destination copied')}
                      onCopy={() => void copyValue('destination', route.end)}
                    />
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">{translate('押金', 'Collateral')}</dt>
                  <dd className="mt-1 flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 break-words font-mono text-slate-100">{formatIsk(quote.totalCollateral)}</span>
                    <CopyValueButton
                      copied={copiedField === 'collateral'}
                      copyLabel={translate('复制合同押金', 'Copy contract collateral')}
                      copiedLabel={translate('合同押金已复制', 'Contract collateral copied')}
                      onCopy={() => void copyValue('collateral', Math.round(quote.totalCollateral).toString())}
                    />
                  </dd>
                </div>
                <div className="grid grid-cols-2 gap-4 py-3">
                  <div><dt className="text-xs text-muted-foreground">{translate('运输类型', 'Transport')}</dt><dd className="mt-1 text-slate-100">{route.transport_type}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{translate('到期 / 完成', 'Expires / completes')}</dt><dd className="mt-1 text-slate-100">{route.expiration}d / {route.completion}d</dd></div>
                </div>
                <div className="py-3"><dt className="text-xs text-muted-foreground">{translate('体积 / 上限', 'Volume / capacity')}</dt><dd className={`mt-1 font-mono ${quote.volumeExceedsCapacity ? 'text-red-200' : 'text-slate-100'}`}>{formatQuantity(quote.totalVolume)} / {formatQuantity(quote.transportVolume)} m³</dd></div>
              </dl>
              <div className="space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
                <div className="flex justify-between gap-3"><span>{translate('每 m³ 运价', 'Rate per m³')}</span><span className="font-mono text-slate-200">{formatIsk(route.cost_per_m3)}</span></div>
                <div className="flex justify-between gap-3"><span>{translate('体积运费', 'Volume charge')}</span><span className="font-mono text-slate-200">{formatIsk(quote.volumeCost)}</span></div>
                <div className="flex justify-between gap-3"><span>{translate(`押金费（${route.collateral_percentage}%）`, `Collateral fee (${route.collateral_percentage}%)`)}</span><span className="font-mono text-slate-200">{formatIsk(quote.collateralFee)}</span></div>
                <div className="flex justify-between gap-3"><span>{translate('路线最低运费', 'Route minimum')}</span><span className="font-mono text-slate-200">{formatIsk(quote.minimumCost)}</span></div>
              </div>
              {quote.volumeExceedsCapacity && <p role="alert" className="border border-red-400/25 bg-red-400/8 p-3 text-sm text-red-200">{translate('货物体积超过该路线单次运输上限，请拆分合同。', 'Cargo exceeds this route’s capacity. Split it into multiple contracts.')}</p>}
              <Button variant="outline" className="min-h-11 w-full" onClick={copyContractDetails}>
                {copiedField === 'all' ? <Check data-icon="inline-start" aria-hidden="true" /> : <ClipboardCopy data-icon="inline-start" aria-hidden="true" />}
                {copiedField === 'all' ? translate('合同信息已复制', 'Contract details copied') : translate('复制全部合同信息', 'Copy all contract details')}
              </Button>
            </div>
          )}
        </aside>
      </div>
      <p className="border-t border-border px-4 py-3 text-xs leading-5 text-muted-foreground">{translate('路线、运价和估价由 Heavy Assets Logistics 提供；路线每 5 分钟刷新。创建游戏合同前请在服务官网复核。', 'Routes, rates, and appraisals are provided by Heavy Assets Logistics; routes refresh every five minutes. Verify on the service website before creating the in-game contract.')}</p>
    </section>
  );
}
