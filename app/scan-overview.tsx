'use client';

import { useState } from 'react';
import { Boxes, Info, Shield, Users, Radar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type {
  ScanIndex,
  ScanMember,
  ScanSnapshot,
  summarizeDirectionalScan,
} from '@/lib/battle-scan';
import EveTypeIcon from './eve-type-icon';
import {
  bilingualName,
  formatLocalizedNumber as number,
  translate,
} from './language-provider';

type Summary = ReturnType<typeof summarizeDirectionalScan>;
export function scanOrganizations(
  members: ScanMember[],
  kind: 'alliance' | 'corporation',
) {
  const groups = new Map<number, { id: number; name: string; count: number }>();
  for (const member of members) {
    if (member.status !== 'resolved') continue;
    const id =
      (kind === 'alliance' ? member.allianceId : member.corporationId) ?? 0;
    const name =
      (kind === 'alliance' ? member.alliance : member.corporation) ??
      (id ? `ID ${id}` : translate('无联盟', 'No alliance'));
    const row = groups.get(id) ?? { id, name, count: 0 };
    row.count++;
    groups.set(id, row);
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}

function Panel({
  title,
  count,
  icon,
  children,
  className = '',
}: {
  title: string;
  count?: number;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`hud-panel min-w-0 overflow-hidden border border-border bg-card/85 ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-cyan-300 [&_svg]:size-4">{icon}</span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold">{title}</h3>
        {count !== undefined && (
          <span className="font-mono text-lg font-semibold text-cyan-200">
            {number(count)}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export function ScanShipOverview({
  summary,
  index,
  onUnresolved,
}: {
  summary: Summary;
  index: ScanIndex;
  onUnresolved: () => void;
}) {
  const [pinned, setPinned] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? pinned;
  const related = (group: number) =>
    active === group
      ? 'border-l-cyan-300 bg-cyan-400/12 text-cyan-100'
      : 'border-l-transparent hover:bg-cyan-400/5';
  const interactions = (group: number) => ({
    onMouseEnter: () => setHovered(group),
    onMouseLeave: () => setHovered(null),
    onFocus: () => setHovered(group),
    onBlur: () => setHovered(null),
    onClick: () => {
      setPinned((previous) => (previous === group ? null : group));
      setHovered(null);
    },
    'aria-pressed': pinned === group,
  });
  const others = summary.types.filter(
    (row) => index.groups.get(row.type[3])?.[3] !== 6,
  );
  const system = summary.systems.length === 1 ? summary.systems[0] : null;
  const region = system
    ? index.data.regions.find((row) => row[0] === system[3])
    : null;
  return (
    <>
      <div className="mb-3 flex min-h-7 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          {translate(
            '指向或点击舰型 / 级别可关联高亮，再次点击取消。',
            'Hover or select a hull/class to highlight related rows. Select again to clear.',
          )}
        </p>
        {pinned !== null && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPinned(null);
              setHovered(null);
            }}
          >
            {translate('取消高亮', 'Clear highlight')}
          </Button>
        )}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,.9fr)]">
        <Panel
          title={translate('舰船型号', 'Ships')}
          count={summary.shipCount}
          icon={<Radar />}
        >
          <ScrollArea className="scan-summary-scroll max-h-[38rem] h-[clamp(18rem,55vh,38rem)]">
            {summary.ships.map((row) => (
              <button
                key={row.type[0]}
                type="button"
                {...interactions(row.type[3])}
                className={`flex w-full items-center gap-3 border-b border-l-2 border-b-border/50 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 ${related(row.type[3])}`}
              >
                <EveTypeIcon typeId={row.type[0]} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {bilingualName(row.type[1], row.type[2])}
                  </span>
                  {row.manual > 0 && (
                    <span className="mt-1 block text-xs text-amber-200">
                      {translate(
                        `手动补充 ${row.manual}`,
                        `${row.manual} manually added`,
                      )}
                    </span>
                  )}
                </span>
                <strong className="shrink-0 font-mono text-lg text-cyan-200">
                  {number(row.scanned + row.manual)}
                </strong>
              </button>
            ))}
            {!summary.ships.length && (
              <p className="p-4 text-sm text-muted-foreground">
                {translate(
                  '没有识别到舰船，请查看其他对象或未识别行。',
                  'No ships identified. Check other objects or unresolved rows.',
                )}
              </p>
            )}
          </ScrollArea>
        </Panel>
        <div className="grid min-w-0 gap-4">
          <Panel
            title={translate('舰船级别', 'Ship classes')}
            count={summary.classes.length}
            icon={<Shield />}
          >
            <ScrollArea className="scan-summary-scroll max-h-80 h-[clamp(10rem,28vh,20rem)]">
              {summary.classes.map((row) => (
                <button
                  key={row.group[0]}
                  type="button"
                  {...interactions(row.group[0])}
                  className={`flex w-full items-center gap-3 border-b border-l-2 border-b-border/50 px-4 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 ${related(row.group[0])}`}
                >
                  <span className="min-w-0 flex-1">
                    {bilingualName(row.group[1], row.group[2])}
                  </span>
                  <strong className="font-mono text-lg text-cyan-200">
                    {number(row.count)}
                  </strong>
                </button>
              ))}
              {!summary.classes.length && (
                <p className="p-4 text-sm text-muted-foreground">—</p>
              )}
            </ScrollArea>
          </Panel>
          <Panel
            title={translate('设施与其他对象', 'Structures & other objects')}
            count={others.reduce((sum, row) => sum + row.scanned, 0)}
            icon={<Boxes />}
          >
            <ScrollArea className="scan-summary-scroll h-[clamp(8rem,22vh,17rem)]">
              {others.map((row) => (
                <div
                  key={row.type[0]}
                  className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    {bilingualName(row.type[1], row.type[2])}
                  </span>
                  <strong className="font-mono text-cyan-200">
                    {number(row.scanned)}
                  </strong>
                </div>
              ))}
              {!others.length && (
                <p className="p-4 text-sm text-muted-foreground">
                  {translate('未扫描到其他对象', 'No other objects scanned')}
                </p>
              )}
            </ScrollArea>
          </Panel>
        </div>
        <Panel title={translate('扫描信息', 'Information')} icon={<Info />}>
          <div className="space-y-4 p-4 text-sm">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                {translate('星系线索', 'System clue')}
              </p>
              {system ? (
                <>
                  <p className="font-medium text-cyan-200">
                    {bilingualName(system[1], system[2])}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {region ? bilingualName(region[1], region[2]) : '—'} ·{' '}
                    {number(system[4], {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                  </p>
                </>
              ) : (
                <p>
                  {summary.systems.length > 1
                    ? translate(
                        '多个星系线索，可能混合了扫描',
                        'Multiple clues; possibly mixed scans',
                      )
                    : translate('无法确定', 'Unknown')}
                </p>
              )}
            </div>
            <dl className="space-y-3 border-y border-border py-4">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {translate('舰船 / 型号', 'Ships / types')}
                </dt>
                <dd className="font-mono text-cyan-100">
                  {number(summary.shipCount)} / {summary.ships.length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {translate('手动补充', 'Manually added')}
                </dt>
                <dd className="font-mono text-amber-200">
                  {number(summary.manualCount)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {translate('舰船基础质量', 'Hull base mass')}
                </dt>
                <dd className="mt-1 font-mono text-lg text-cyan-200">
                  {number(summary.mass / 1_000_000, {
                    maximumFractionDigits: 2,
                  })}{' '}
                  M kg
                </dd>
              </div>
            </dl>
            {summary.missingMass && (
              <p className="text-amber-200">
                {translate(
                  '部分船体缺少质量数据',
                  'Some hull masses are unavailable',
                )}
              </p>
            )}
            {summary.unknown.length > 0 && (
              <Button
                className="h-auto w-full justify-between whitespace-normal py-2 text-left text-amber-200"
                variant="outline"
                onClick={onUnresolved}
              >
                <span>
                  {translate('未识别行 · 未计入统计', 'Unresolved · excluded')}
                </span>
                <strong>{summary.unknown.length}</strong>
              </Button>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              {translate(
                '星系根据固定天体 / 空间站名称推断。基础质量不含装配与推进效果，不是实际过洞质量。',
                'System clues come from fixed celestial/station names. Base mass excludes fittings and propulsion; it is not actual wormhole transit mass.',
              )}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {translate(
                '扫描无法判断敌友、配装或隐形舰船，也不代表完整敌方编成。',
                'Scans do not reveal standings, fittings or cloaked ships and may not represent the full fleet.',
              )}
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}

type Organization = { kind: 'alliance' | 'corporation'; id: number };
export function ScanMemberOverview({
  scan,
  busy,
}: {
  scan: ScanSnapshot;
  busy: boolean;
}) {
  const [pinned, setPinned] = useState<Organization | null>(null),
    [hovered, setHovered] = useState<Organization | null>(null);
  const active = hovered ?? pinned;
  const resolved = scan.members.filter((row) => row.status === 'resolved');
  const associated = active
    ? resolved.filter(
        (row) =>
          ((active.kind === 'alliance' ? row.allianceId : row.corporationId) ??
            0) === active.id,
      )
    : [];
  return (
    <>
      <div className="mb-3 flex min-h-7 flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          {translate(
            `共 ${scan.members.length} 人 · 已取得 ${resolved.length} 人归属`,
            `${scan.members.length} members · ${resolved.length} affiliations resolved`,
          )}
          {busy ? translate(' · 查询中…', ' · Looking up…') : ''}
        </p>
        {pinned && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPinned(null);
              setHovered(null);
            }}
          >
            {translate('取消高亮', 'Clear highlight')}
          </Button>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(['alliance', 'corporation'] as const).map((kind) => {
          const rows = scanOrganizations(scan.members, kind);
          return (
            <Panel
              key={kind}
              title={
                kind === 'alliance'
                  ? translate('联盟', 'Alliances')
                  : translate('军团', 'Corporations')
              }
              count={rows.filter((row) => row.id !== 0).length}
              icon={<Users />}
            >
              <ScrollArea className="scan-summary-scroll h-[clamp(18rem,55vh,38rem)]">
                {rows.map((row) => {
                  const related =
                    active &&
                    associated.some(
                      (member) =>
                        ((kind === 'alliance'
                          ? member.allianceId
                          : member.corporationId) ?? 0) === row.id,
                    );
                  return (
                    <button
                      key={row.id}
                      type="button"
                      aria-pressed={
                        pinned?.kind === kind && pinned.id === row.id
                      }
                      onMouseEnter={() => setHovered({ kind, id: row.id })}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered({ kind, id: row.id })}
                      onBlur={() => setHovered(null)}
                      onClick={() => {
                        setPinned(
                          pinned?.kind === kind && pinned.id === row.id
                            ? null
                            : { kind, id: row.id },
                        );
                        setHovered(null);
                      }}
                      className={`flex w-full items-center gap-3 border-b border-l-2 border-b-border/50 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 ${related ? 'border-l-cyan-300 bg-cyan-400/12' : 'border-l-transparent hover:bg-cyan-400/5'}`}
                    >
                      <span className="min-w-0 flex-1 text-sm font-medium">
                        {row.name}
                      </span>
                      <strong className="font-mono text-xl text-cyan-200">
                        {number(row.count)}
                      </strong>
                    </button>
                  );
                })}
                {!rows.length && (
                  <p className="p-4 text-sm text-muted-foreground">
                    {busy
                      ? translate(
                          '正在查询公开归属…',
                          'Looking up affiliations…',
                        )
                      : translate(
                          '暂无归属信息，可在人员明细查看完整名单。',
                          'No affiliations available. The full list is in character details.',
                        )}
                  </p>
                )}
              </ScrollArea>
            </Panel>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {translate(
          '指向或点击组织，查看关联的联盟 / 军团。未取得归属的成员保留在人员明细中。公开查询缓存最多 10 分钟，也受 ESI 缓存影响，不代表敌友。',
          'Hover or select an organization to highlight its related alliance/corporations. Unresolved members remain in character details. Public lookups are cached for up to 10 minutes and by ESI; no standings are inferred.',
        )}
      </p>
    </>
  );
}
