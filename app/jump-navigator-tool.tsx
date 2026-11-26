'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  Database,
  ExternalLink,
  Fuel,
  Gauge,
  MapPinned,
  Navigation,
  Route,
  Search,
  X,
} from 'lucide-react';
import { cachedJson } from '@/lib/static-json';
import { revealToolResult } from '@/lib/tool-flow';
import {
  calculateJumpRange,
  displaySecurity,
  isJumpNavigatorData,
  unpackJumpShip,
  unpackJumpSystem,
  type JumpNavigatorData,
  type JumpShip as JumpShipData,
  type JumpSystem,
  type JumpReachableResult,
  type ReachableSystem,
} from '@/lib/jump-navigator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { bilingualName, formatLocalizedNumber, translate, useLanguage } from './language-provider';
import ServerStatus from './server-status';
import ToolNavigation, { type ToolId } from './tool-navigation';

const PAGE_SIZE = 25;
const DATA_URL = '/jump-data.json?v=3500372';
const SOURCE_URL = 'https://developers.eveonline.com/static-data';
const integer = { format: (value: number) => formatLocalizedNumber(value, { maximumFractionDigits: 0 }) };
const decimal = { format: (value: number) => formatLocalizedNumber(value, { maximumFractionDigits: 2 }) };

function securityClass(security: number) {
  if (security >= 0.5) return 'border-emerald-400/30 text-emerald-200';
  if (security > 0) return 'border-amber-400/30 text-amber-200';
  return 'border-red-400/30 text-red-200';
}

function shipName(ship: JumpShipData) {
  return bilingualName(ship.zh, ship.en);
}

function shipLabel(ship: JumpShipData) {
  return translate(
    `${ship.categoryZh} - ${ship.race} - ${ship.zh}`,
    `${ship.categoryEn} - ${ship.race} - ${ship.en}`,
  );
}

function systemName(system: JumpSystem) {
  return bilingualName(system.zh, system.en);
}

function regionName(system: JumpSystem) {
  return bilingualName(system.regionZh, system.regionEn);
}

export default function JumpNavigatorTool({ onSwitch }: { onSwitch: (tool: ToolId) => void }) {
  const { language } = useLanguage();
  const [data, setData] = useState<JumpNavigatorData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [dataAttempt, setDataAttempt] = useState(0);
  const [shipClass, setShipClass] = useState('');
  const [calibration, setCalibration] = useState('4');
  const [conservation, setConservation] = useState('4');
  const [freighters, setFreighters] = useState('4');
  const [startSystem, setStartSystem] = useState('');
  const [result, setResult] = useState<JumpReachableResult | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const resultPanel = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let current = true;
    cachedJson<JumpNavigatorData>(DATA_URL)
      .then((payload) => {
        if (!current) return;
        if (!isJumpNavigatorData(payload)) throw new Error(translate('跳跃数据格式无效。', 'The jump data is invalid.'));
        setData(payload);
        setShipClass((selected) => selected || String(payload.ships[0]?.[0] ?? ''));
        const defaultSystem = payload.systems.find((system) => system[2] === 'Amamake') ?? payload.systems[0];
        setStartSystem((selected) => selected || defaultSystem?.[1] || '');
      })
      .catch((reason) => {
        if (current) setDataError(reason instanceof Error ? reason.message : translate('跳跃数据加载失败，请稍后重试。', 'Failed to load jump data. Try again later.'));
      })
      .finally(() => {
        if (current) setDataLoading(false);
      });
    return () => { current = false; };
  }, [dataAttempt]);

  const ships = useMemo(() => data?.ships.map(unpackJumpShip) ?? [], [data]);
  const systems = useMemo(() => data?.systems.map(unpackJumpSystem) ?? [], [data]);
  const selectedShip = ships.find((ship) => String(ship.id) === shipClass);

  const suggestions = useMemo(() => {
    const normalized = startSystem.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return systems
      .filter((system) => `${system.zh} ${system.en} ${system.regionZh} ${system.regionEn} ${system.id}`.toLocaleLowerCase().includes(normalized))
      .slice(0, 12);
  }, [startSystem, systems]);

  const canonicalStart = useMemo(() => {
    const normalized = startSystem.trim().toLocaleLowerCase();
    return systems.find((system) => system.zh.toLocaleLowerCase() === normalized
      || system.en.toLocaleLowerCase() === normalized
      || String(system.id) === normalized);
  }, [startSystem, systems]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!result) return [];
    return result.systems.filter((system) => normalized
      ? `${system.zh} ${system.en} ${system.regionZh} ${system.regionEn} ${system.id}`.toLocaleLowerCase().includes(normalized)
      : true);
  }, [query, result]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- Reset pagination whenever the result set changes.
    setPage(1);
  }, [query, result]);

  function calculate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !selectedShip) {
      setError(translate('舰船数据尚未加载完成。', 'Ship data has not finished loading.'));
      return;
    }
    if (!canonicalStart) {
      setError(translate('请选择列表中的有效起始星系。', 'Choose a valid start system from the list.'));
      return;
    }

    setError('');
    try {
      const payload = calculateJumpRange(data, {
        shipTypeId: selectedShip.id,
        startSystemId: canonicalStart.id,
        jumpDriveCalibration: Number(calibration),
        jumpFuelConservation: Number(conservation),
        jumpFreighters: Number(freighters),
      });
      setResult(payload);
      requestAnimationFrame(() => revealToolResult(resultPanel.current));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : translate('计算失败，请检查参数。', 'Calculation failed. Check the parameters.'));
    }
  }

  function changePage(next: number) {
    setPage(next);
    requestAnimationFrame(() => revealToolResult(resultPanel.current));
  }

  return (
    <main className="site-shell min-h-screen text-foreground">
      <div className="scanline" aria-hidden="true" />
      <header className="site-header border-b border-border/80 bg-card/80 backdrop-blur-xl">
        <div className="site-header-grid mx-auto max-w-[1500px] px-4 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="brand-mark grid size-10 place-items-center border border-cyan-400/40 bg-cyan-400/10 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,.12)]">
              <Route className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="glory-wordmark font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Glory Navy</p>
              <h1 className="text-lg font-semibold tracking-tight">{translate('旗舰一跳可达', 'Capital Jump Range')}</h1>
            </div>
          </div>
          <ServerStatus />
          <ToolNavigation active="jump" onSelect={onSwitch} />
        </div>
      </header>

      <div className="site-content mx-auto max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">
        <section className="hud-panel control-grid mb-6 border border-border bg-card/80 p-4 shadow-2xl shadow-black/10 sm:p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-slate-100"><Navigation className="size-4 text-cyan-300" aria-hidden="true" />{translate('跳跃参数', 'Jump parameters')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{translate('本站使用欧服 SDE 坐标与舰船属性，在浏览器内计算一跳范围和燃料消耗。', 'This site calculates one-jump range and fuel locally from Tranquility SDE coordinates and ship attributes.')}</p>
            </div>
            {data && <Badge variant="outline" className="w-fit border-cyan-400/25 text-cyan-200">SDE {data.sde}</Badge>}
          </div>

          {dataError ? (
            <div className="border border-red-400/25 bg-red-400/5 p-4">
              <p className="text-sm text-red-200">{dataError}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => { setDataLoading(true); setDataError(''); setDataAttempt((attempt) => attempt + 1); }}>{translate('重新加载', 'Reload')}</Button>
            </div>
          ) : dataLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" aria-label={translate('正在加载导航参数', 'Loading navigator parameters')}>
              {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
            </div>
          ) : (
            <form onSubmit={calculate}>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <label className="field-block flex flex-col gap-2" htmlFor="jump-ship">
                  <span>{translate('舰船型号', 'Ship')}</span>
                  <NativeSelect id="jump-ship" value={shipClass} onChange={(event) => setShipClass(event.target.value)} required>
                    {ships.map((ship) => <NativeSelectOption key={ship.id} value={String(ship.id)}>{shipLabel(ship)}</NativeSelectOption>)}
                  </NativeSelect>
                </label>
                <SkillSelect id="jump-calibration" label={translate('跳跃引擎校准', 'Jump Drive Calibration')} value={calibration} onChange={setCalibration} minimum={0} />
                <SkillSelect id="jump-conservation" label={translate('跳跃燃料节约', 'Jump Fuel Conservation')} value={conservation} onChange={setConservation} minimum={0} />
                <SkillSelect id="jump-freighters" label={translate('战略货舰操作', 'Jump Freighters')} value={freighters} onChange={setFreighters} minimum={1} disabled={!selectedShip?.jumpFreighter} />
                <label className="field-block flex flex-col gap-2" htmlFor="jump-origin">
                  <span>{translate('起始星系', 'Start system')}</span>
                  <Input
                    id="jump-origin"
                    list="jump-system-suggestions"
                    value={startSystem}
                    onChange={(event) => setStartSystem(event.target.value)}
                    placeholder={translate('输入中文、英文星系名或 ID', 'Enter a system name or ID')}
                    autoComplete="off"
                    required
                    aria-describedby="jump-origin-hint"
                    aria-invalid={Boolean(error && !canonicalStart)}
                  />
                  <datalist id="jump-system-suggestions">
                    {suggestions.map((system) => (
                      <option key={system.id} value={language === 'en' ? system.en : system.zh}>
                        {language === 'en' ? `${system.regionEn} · ${system.zh}` : `${system.regionZh} · ${system.en}`}
                      </option>
                    ))}
                  </datalist>
                </label>
              </div>
              <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p id="jump-origin-hint" className="text-xs text-muted-foreground">
                  {translate(
                    `欧服 SDE 已载入 ${integer.format(systems.length)} 个可用星系；高安星系可作起点，但不会作为诱导终点。`,
                    `${integer.format(systems.length)} usable Tranquility systems loaded. High-sec systems can be origins but are excluded as cyno destinations.`,
                  )}
                </p>
                <Button type="submit" disabled={!data || !selectedShip} className="sm:min-w-36">
                  <Route data-icon="inline-start" aria-hidden="true" />
                  {translate('计算一跳范围', 'Calculate range')}
                </Button>
              </div>
            </form>
          )}

          {error && <p role="alert" className="mt-4 border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</p>}
        </section>

        {result && (
          <>
            <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard icon={<MapPinned />} label={translate('起始星系', 'Origin')} value={systemName(result.startSystem)} meta={regionName(result.startSystem)} />
              <SummaryCard icon={<Gauge />} label={translate('最大跳跃距离', 'Maximum range')} value={`${decimal.format(result.jumpRangeLy)} LY`} meta={shipName(result.ship)} accent />
              <SummaryCard icon={<Navigation />} label={translate('可达星系', 'Reachable systems')} value={integer.format(result.systems.length)} meta={translate('按距离从近到远', 'Sorted nearest first')} />
              <SummaryCard icon={<Fuel />} label={translate('燃料类型', 'Fuel type')} value={bilingualName(result.ship.fuelZh, result.ship.fuelEn)} meta={translate(`基础 ${integer.format(result.ship.baseFuelPerLy)} 单位 / LY`, `Base ${integer.format(result.ship.baseFuelPerLy)} units / LY`)} />
            </section>

            <section ref={resultPanel} tabIndex={-1} className="tool-result-anchor tool-table-scroll hud-panel overflow-hidden border border-border bg-card/85 shadow-2xl shadow-black/10">
              <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold">{translate('一跳可达星系', 'Systems within one jump')}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{translate(
                    `${shipName(result.ship)} · JDC ${result.jumpDriveCalibration} · JFC ${result.jumpFuelConservation}${result.ship.jumpFreighter ? ` · JF ${result.jumpFreighters}` : ''}`,
                    `${shipName(result.ship)} · JDC ${result.jumpDriveCalibration} · JFC ${result.jumpFuelConservation}${result.ship.jumpFreighter ? ` · JF ${result.jumpFreighters}` : ''}`,
                  )}</p>
                </div>
                <div className="relative w-full sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translate('搜索星系、星域或 ID…', 'Search system, region or ID…')} aria-label={translate('筛选可达星系', 'Filter reachable systems')} className="pl-9 pr-10" />
                  {query && <Button type="button" variant="ghost" size="icon-sm" className="absolute right-0 top-0 h-full" onClick={() => setQuery('')} aria-label={translate('清除搜索', 'Clear search')}><X /></Button>}
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="px-5 py-10 text-center" aria-live="polite">
                  <p className="font-medium">{query.trim() ? translate(`没有找到“${query.trim()}”`, `No matches for “${query.trim()}”`) : translate('当前参数下没有一跳可达的星系', 'No systems are within one jump for these parameters')}</p>
                  {query && <Button variant="outline" className="mt-4" onClick={() => setQuery('')}>{translate('清除搜索', 'Clear search')}</Button>}
                </div>
              ) : (
                <Table className="mobile-row-table jump-result-table">
                  <TableHeader>
                    <TableRow className="bg-muted/25 hover:bg-muted/25">
                      <TableHead className="min-w-48 pl-4">{translate('星系', 'System')}</TableHead>
                      <TableHead className="text-right">{translate('距离', 'Distance')}</TableHead>
                      <TableHead className="text-right">{translate('燃料消耗', 'Fuel')}</TableHead>
                      <TableHead>{translate('星域', 'Region')}</TableHead>
                      <TableHead className="pr-4 text-right">{translate('安全等级', 'Security')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map((system) => <ReachableSystemRow key={system.id} system={system} />)}
                  </TableBody>
                </Table>
              )}

              <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>{translate(
                  `显示 ${filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0}–${Math.min(page * PAGE_SIZE, filtered.length)}，共 ${integer.format(filtered.length)} 个星系`,
                  `Showing ${filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0}–${Math.min(page * PAGE_SIZE, filtered.length)}, ${integer.format(filtered.length)} systems`,
                )}</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => changePage(Math.max(1, page - 1))}>{translate('上一页', 'Previous')}</Button>
                  <span className="min-w-16 text-center font-mono">{page} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => changePage(Math.min(totalPages, page + 1))}>{translate('下一页', 'Next')}</Button>
                </div>
              </div>
            </section>
          </>
        )}

        <footer className="flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2"><Database className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{translate('全部计算在当前浏览器完成，不请求第三方导航服务；Pochven、Zarzakh、开发区和高安终点已排除。', 'All calculations run in this browser without a third-party navigator. Pochven, Zarzakh, development regions and high-sec destinations are excluded.')}</p>
          <a className="inline-flex shrink-0 items-center gap-1 text-cyan-300 hover:text-cyan-200" href={SOURCE_URL} target="_blank" rel="noreferrer">
            CCP SDE <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </footer>
      </div>
    </main>
  );
}

function SkillSelect({ id, label, value, onChange, minimum, disabled = false }: { id: string; label: string; value: string; onChange: (value: string) => void; minimum: number; disabled?: boolean }) {
  return (
    <label className="field-block flex flex-col gap-2" htmlFor={id}>
      <span>{label}</span>
      <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {Array.from({ length: 6 - minimum }, (_, index) => index + minimum).map((level) => <NativeSelectOption key={level} value={String(level)}>{translate(`${level} 级`, `Level ${level}`)}</NativeSelectOption>)}
      </NativeSelect>
    </label>
  );
}

function SummaryCard({ icon, label, value, meta, accent = false }: { icon: ReactNode; label: string; value: string; meta: string; accent?: boolean }) {
  return (
    <article className={`hud-card relative min-w-0 overflow-hidden border bg-card/80 p-4 ${accent ? 'border-cyan-400/35' : 'border-border'}`}>
      {accent && <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-cyan-400/8 to-transparent" aria-hidden="true" />}
      <div className="mb-3 flex items-start justify-between gap-2 text-muted-foreground"><span className="text-xs uppercase tracking-[0.14em]">{label}</span><span aria-hidden="true" className="shrink-0 [&_svg]:size-4">{icon}</span></div>
      <p className={`break-words font-mono text-lg font-semibold xl:text-xl ${accent ? 'text-cyan-200' : 'text-slate-100'}`}>{value}</p>
      <p className="mt-1 break-words text-xs text-muted-foreground">{meta}</p>
    </article>
  );
}

function ReachableSystemRow({ system }: { system: ReachableSystem }) {
  const security = displaySecurity(system.security);
  return (
    <TableRow>
      <TableCell className="pl-4">
        <p className="font-medium text-cyan-100">{systemName(system)}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{system.id}</p>
      </TableCell>
      <TableCell data-label={translate('距离', 'Distance')} className="text-right font-mono">{decimal.format(system.distanceLy)} LY</TableCell>
      <TableCell data-label={translate('燃料消耗', 'Fuel')} className="text-right font-mono"><span className="inline-flex items-center justify-end gap-1.5"><Fuel className="size-3.5 text-amber-300" aria-hidden="true" />{decimal.format(system.fuel)}</span></TableCell>
      <TableCell data-label={translate('星域', 'Region')}>{regionName(system)}</TableCell>
      <TableCell data-label={translate('安全等级', 'Security')} className="pr-4 text-right"><Badge variant="outline" className={securityClass(security)}>{security.toFixed(1)}</Badge></TableCell>
    </TableRow>
  );
}
