'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Check,
  ClipboardCopy,
  Link2,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  ScanShipOverview,
  ScanMemberOverview,
  scanOrganizations,
} from './scan-overview';
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
import { cachedJson } from '@/lib/static-json';
import { scanFetch as fetchJson } from '@/lib/scan-fetch';
import {
  createScanIndex,
  detectScanKind,
  normalizeScanName,
  parseDirectionalScan,
  parseMemberNames,
  SCAN_MAX_INPUT,
  SCAN_MAX_SHARE_BYTES,
  summarizeDirectionalScan,
  validateScanSnapshot,
  type ScanCatalog,
  type ScanMember,
  type ScanSnapshot,
  type ScanType,
} from '@/lib/battle-scan';
import EveTypeIcon from './eve-type-icon';
import ServerStatus from './server-status';
import ToolNavigation, { type ToolId } from './tool-navigation';
import {
  bilingualName,
  formatLocalizedNumber as number,
  languageLocale,
  translate,
  useLanguage,
} from './language-provider';

type InputMode = 'auto' | 'dscan' | 'members';
function errorText(code: string) {
  const errors: Record<string, [string, string]> = {
    SCAN_TOO_LARGE: [
      '扫描内容过大，请控制在 35 万字符以内。',
      'The scan is too large. Limit input to 350,000 characters.',
    ],
    SCAN_TOO_MANY_LINES: [
      '每次最多分析 5,000 行，请分批粘贴。',
      'Analyze up to 5,000 rows at a time.',
    ],
    SCAN_TOO_MANY_MEMBERS: [
      '每次最多查询 3,000 位成员，请分批粘贴。',
      'Look up up to 3,000 members at a time.',
    ],
    EMPTY_SCAN: [
      '没有可分析的内容，请先粘贴游戏内复制的结果。',
      'Paste a scan or member list from EVE first.',
    ],
    EMPTY_MEMBERS: [
      '没有识别到成员名。请从聊天频道成员列表复制，每行一位角色。',
      'No member names found. Copy the chat channel member list, one character per line.',
    ],
    RATE_LIMIT: [
      '查询或分享过于频繁，请稍后再试。',
      'Too many lookups or shares. Please try again later.',
    ],
    ESI_UNAVAILABLE: [
      '部分成员归属暂未查到。名单已保留，可稍后重新查询。',
      'Some affiliations are unavailable. The member list is preserved; retry later.',
    ],
    SCAN_NOT_FOUND: [
      '这个扫描链接不存在或已过期，可以粘贴内容新建扫描。',
      'This scan link is missing or expired. Paste data to create a new scan.',
    ],
    REQUEST_TIMEOUT: [
      '请求超时，请稍后重试。',
      'Request timed out. Please retry.',
    ],
    BODY_TOO_LARGE: [
      '分享内容超过 1 MiB，请缩小本次扫描范围。',
      'The share exceeds 1 MiB. Reduce the scan size.',
    ],
    INVALID_SCAN: [
      '扫描数据无效，请重新分析后分享。',
      'Invalid scan data. Analyze again before sharing.',
    ],
    COPY_FAILED: [
      '无法自动复制，请检查浏览器剪贴板权限。',
      'Could not copy. Check browser clipboard access.',
    ],
    DATA_UNAVAILABLE: [
      '扫描数据库加载失败，请点击重试。',
      'The scan database failed to load. Select Retry.',
    ],
  };
  return errors[code]
    ? translate(...errors[code])
    : translate(
        '操作暂未完成，请重试。',
        'The operation could not complete. Please retry.',
      );
}
function time(value: string) {
  return new Date(value).toLocaleString(languageLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function distance(value: number | null) {
  if (value === null) return '—';
  if (value >= 149_597_870_700 * 0.1)
    return `${number(value / 149_597_870_700, { maximumFractionDigits: 2 })} AU`;
  if (value >= 1000)
    return `${number(value / 1000, { maximumFractionDigits: 1 })} km`;
  return `${number(value, { maximumFractionDigits: 0 })} m`;
}
function entityName(id: number | null, name: string | null) {
  return name ?? (id ? `ID ${id}` : translate('无联盟', 'No alliance'));
}

export default function BattleScanTool({
  onSwitch,
}: {
  onSwitch: (tool: ToolId) => void;
}) {
  useLanguage();
  const [inputOpen, setInputOpen] = useState(true);
  const [resultView, setResultView] = useState('overview');
  const [data, setData] = useState<ScanCatalog | null>(null),
    [dataAttempt, setDataAttempt] = useState(0),
    [dataError, setDataError] = useState(false);
  const [input, setInput] = useState(''),
    [mode, setMode] = useState<InputMode>('auto'),
    [title, setTitle] = useState('');
  const [scan, setScan] = useState<ScanSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState('');
  const [error, setError] = useState(''),
    [copied, setCopied] = useState(''),
    [sharing, setSharing] = useState(false),
    [shareUrl, setShareUrl] = useState(''),
    [expiresAt, setExpiresAt] = useState('');
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('ships'),
    [page, setPage] = useState(1);
  const [manualQuery, setManualQuery] = useState(''),
    [manualId, setManualId] = useState(''),
    [manualQuantity, setManualQuantity] = useState('1');
  const request = useRef<AbortController | null>(null);
  const exampleInput = useRef('');
  const overviewTab = useRef<HTMLButtonElement | null>(null);
  const rawTab = useRef<HTMLButtonElement | null>(null);
  const scanInput = useRef<HTMLTextAreaElement | null>(null);
  const scanDetails = useRef<HTMLDivElement | null>(null);
  const index = useMemo(() => (data ? createScanIndex(data) : null), [data]);
  const analyzedAt = scan?.analyzedAt;
  const hasIndex = index !== null;

  useEffect(() => {
    if (analyzedAt && hasIndex) overviewTab.current?.focus();
  }, [analyzedAt, hasIndex]);

  const parsed = useMemo(
    () =>
      scan?.kind === 'dscan' && index
        ? parseDirectionalScan(scan.raw, index)
        : null,
    [scan, index],
  );
  const summary = useMemo(
    () =>
      parsed && scan && index
        ? summarizeDirectionalScan(parsed.entries, scan.manual, index)
        : null,
    [parsed, scan, index],
  );
  const memberInput = useMemo(
    () => (scan?.kind === 'members' ? parseMemberNames(scan.raw) : null),
    [scan],
  );

  useEffect(() => {
    let active = true;
    cachedJson<ScanCatalog>('/scan-data.json?v=3494416-1')
      .then((payload) => {
        if (active) {
          setData(payload);
          setDataError(false);
        }
      })
      .catch(() => {
        if (active) setDataError(true);
      });
    return () => {
      active = false;
    };
  }, [dataAttempt]);

  useEffect(() => {
    async function loadShare() {
      const permalink = window.location.href;
      const match = window.location.hash.match(/^#dscan\/s\/([a-f0-9]{24})$/);
      request.current?.abort();
      setBusy(false);
      setSharing(false);
      setProgress('');
      setScan(null);
      setShareUrl('');
      setExpiresAt('');
      setCopied('');
      setQuery('');
      setError('');
      setInputOpen(true);
      setResultView('overview');
      if (!match) return;
      setInput('');
      setTitle('');
      const controller = new AbortController();
      request.current = controller;
      setBusy(true);
      setProgress('share');
      setError('');
      try {
        const payload = await fetchJson<{ scan: unknown; expiresAt: string }>(
          `/api/scans/${match[1]}`,
          { signal: controller.signal },
        );
        const saved = validateScanSnapshot(payload.scan);
        if (!saved) throw new Error('INVALID_SCAN');
        if (controller.signal.aborted) return;
        setInputOpen(false);
        setResultView('overview');
        setScan(saved);
        setInput(saved.raw);
        setTitle(saved.title);
        setMode(saved.kind);
        setShareUrl(permalink);
        setExpiresAt(payload.expiresAt);
        setPage(1);
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'SCAN_NOT_FOUND');
      } finally {
        if (!controller.signal.aborted) {
          setBusy(false);
          setProgress('');
        }
      }
    }
    void loadShare();
    window.addEventListener('hashchange', loadShare);
    return () => {
      request.current?.abort();
      window.removeEventListener('hashchange', loadShare);
    };
  }, []);

  function clearLink() {
    setShareUrl('');
    setExpiresAt('');
    setCopied('');
    if (window.location.hash.startsWith('#dscan/s/'))
      window.history.replaceState(null, '', '#dscan');
  }
  function editInput(value: string) {
    if (value.length > SCAN_MAX_INPUT) {
      setError('SCAN_TOO_LARGE');
      return;
    }
    request.current?.abort();
    setBusy(false);
    setSharing(false);
    setProgress('');
    setInput(value);
    exampleInput.current = '';
    setScan(null);
    setQuery('');
    setError('');
    setPage(1);
    clearLink();
  }
  function changeScan(next: ScanSnapshot) {
    request.current?.abort();
    setSharing(false);
    setBusy(false);
    setScan(next);
    setPage(1);
    clearLink();
  }
  function newScan() {
    editInput('');
    setMode('auto');
    setTitle('');
    setCategory('ships');
    setManualQuery('');
    setManualId('');
    setManualQuantity('1');
    setInputOpen(true);
    setResultView('overview');
    requestAnimationFrame(() => scanInput.current?.focus());
  }
  function changeDetailsPage(next: number) {
    setPage(next);
    requestAnimationFrame(() =>
      scanDetails.current?.scrollIntoView({ block: 'start' }),
    );
  }
  function sample() {
    if (!index) return;
    if (mode === 'members') {
      editInput('Chribba\nCCP Explorer\nCCP Swift');
      exampleInput.current = 'Chribba\nCCP Explorer\nCCP Swift';
      return;
    }
    const samples: [string, string, string][] = [
      ['Caracal', 'GN sample A', '24 km'],
      ['Caracal', 'GN sample B', '31 km'],
      ['Basilisk', 'GN logistics', '28 km'],
      ['Rifter', 'GN scout', '1.2 AU'],
      ['Astrahus', 'Example structure', '2.1 AU'],
      ['Moon', 'Jita IV - Moon 4', '3.5 AU'],
    ];
    const raw = samples
      .flatMap(([typeName, name, range]) => {
        const type = index.data.types.find((t) => t[2] === typeName);
        return type ? [`${type[0]}\t${name}\t${type[2]}\t${range}`] : [];
      })
      .join('\n');
    editInput(raw);
    setMode('dscan');
    setInputOpen(false);
    setResultView('overview');
    setScan({
      v: 1,
      kind: 'dscan',
      title: '',
      raw,
      analyzedAt: new Date().toISOString(),
      manual: [],
      members: [],
      example: true,
    });
    setTitle('');
  }
  async function analyze() {
    if (!index || !input.trim()) {
      setError('EMPTY_SCAN');
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError('');
    clearLink();
    setPage(1);
    setQuery('');
    try {
      const kind = mode === 'auto' ? detectScanKind(input, index) : mode;
      const next: ScanSnapshot = {
        v: 1,
        kind,
        title: title.trim(),
        raw: input,
        analyzedAt: new Date().toISOString(),
        manual: [],
        members: [],
        example: Boolean(
          (scan?.example && scan.raw === input) ||
          exampleInput.current === input,
        ),
      };
      if (kind === 'dscan') {
        parseDirectionalScan(input, index);
        setInputOpen(false);
        setResultView('overview');
        setScan(next);
        setBusy(false);
        return;
      }
      const { names } = parseMemberNames(input);
      if (!names.length) throw new Error('EMPTY_MEMBERS');
      const members = new Map(
        names.map((name) => [
          normalizeScanName(name),
          {
            name,
            id: null,
            corporationId: null,
            corporation: null,
            allianceId: null,
            alliance: null,
            status: 'unavailable',
            checkedAt: next.analyzedAt,
          } as ScanMember,
        ]),
      );
      setInputOpen(false);
      setResultView('overview');
      setScan({ ...next, members: [...members.values()] });
      setBusy(true);
      setProgress(`0 / ${names.length}`);
      const batches: string[][] = [];
      for (let i = 0; i < names.length; i += 250)
        batches.push(names.slice(i, i + 250));
      let cursor = 0,
        completed = 0,
        failed = '';
      async function work() {
        while (cursor < batches.length && !controller.signal.aborted) {
          const batch = batches[cursor++];
          try {
            const response = await fetchJson<{ members: ScanMember[] }>(
              '/api/scan-characters',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(batch),
                signal: controller.signal,
              },
              60_000,
            );
            if (controller.signal.aborted) return;
            for (const member of response.members)
              if (members.has(normalizeScanName(member.name)))
                members.set(normalizeScanName(member.name), member);
          } catch (reason) {
            if (!controller.signal.aborted)
              failed =
                reason instanceof Error && reason.message === 'RATE_LIMIT'
                  ? 'RATE_LIMIT'
                  : failed || 'ESI_UNAVAILABLE';
          }
          if (controller.signal.aborted) return;
          completed += batch.length;
          setProgress(`${completed} / ${names.length}`);
          setScan({ ...next, members: [...members.values()] });
        }
      }
      await Promise.all([work(), work()]);
      if (failed && !controller.signal.aborted) setError(failed);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : 'EMPTY_SCAN');
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        setProgress('');
      }
    }
  }
  async function share() {
    if (!scan || busy || sharing) return;
    const payload = JSON.stringify(scan);
    if (new TextEncoder().encode(payload).byteLength > SCAN_MAX_SHARE_BYTES) {
      setError('BODY_TOO_LARGE');
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSharing(true);
    setError('');
    try {
      const result = await fetchJson<{ code: string; expiresAt: string }>(
        '/api/scans',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      const hash = `#dscan/s/${result.code}`;
      window.history.replaceState(null, '', hash);
      setShareUrl(
        `${window.location.origin}${window.location.pathname}${hash}`,
      );
      setExpiresAt(result.expiresAt);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : 'SAVE_FAILED');
    } finally {
      if (!controller.signal.aborted) setSharing(false);
    }
  }
  async function copy(text: string, kind: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setError('COPY_FAILED');
    }
  }
  const label = (type: ScanType) => bilingualName(type[1], type[2]);
  const shipOptions = index
    ? index.data.types
        .filter(
          (type) =>
            index.groups.get(type[3])?.[3] === 6 &&
            `${type[0]} ${type[1]} ${type[2]}`
              .toLowerCase()
              .includes(manualQuery.toLowerCase()),
        )
        .sort((a, b) => a[2].localeCompare(b[2]))
        .slice(0, 30)
    : [];
  const typeRows =
    summary?.types.filter((row) => {
      const categoryId = index?.groups.get(row.type[3])?.[3];
      const allowed =
        category === 'all' ||
        (category === 'ships' && categoryId === 6) ||
        (category === 'structures' &&
          [3, 22, 23, 40, 46, 65].includes(categoryId ?? 0)) ||
        (category === 'other' &&
          ![3, 6, 22, 23, 40, 46, 65].includes(categoryId ?? 0));
      return (
        allowed &&
        `${row.type[0]} ${row.type[1]} ${row.type[2]}`
          .toLowerCase()
          .includes(query.toLowerCase())
      );
    }) ?? [];
  const memberRows =
    scan?.members.filter((r) =>
      `${r.name} ${r.corporation ?? ''} ${r.alliance ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  const resolved =
    scan?.members.filter((row) => row.status === 'resolved').length ?? 0;
  const organizationRows = scanOrganizations(scan?.members ?? [], 'alliance');
  const summaryText = scan
    ? [
        ...(scan.example ? [translate('示例数据', 'Example data')] : []),
        scan.title || 'Glory Navy · Battle Scan',
        `${translate('分析于', 'Analyzed')} ${time(scan.analyzedAt)}`,
        ...(summary
          ? [
              translate(
                `舰船 ${summary.shipCount} 艘（手动补充 ${summary.manualCount}）`,
                `${summary.shipCount} ships (${summary.manualCount} added manually)`,
              ),
              ...summary.ships.map(
                (r) =>
                  `${r.scanned + r.manual} × ${r.type[2]}${r.manual ? ` (+${r.manual} manual)` : ''}`,
              ),
              ...(summary.unknown.length
                ? [
                    translate(
                      `另有 ${summary.unknown.length} 行未识别`,
                      `${summary.unknown.length} unresolved rows`,
                    ),
                  ]
                : []),
            ]
          : [
              translate(
                `成员 ${scan.members.length}，已查到归属 ${resolved}`,
                `${scan.members.length} members; ${resolved} affiliations resolved`,
              ),
              translate('联盟', 'Alliances'),
              ...organizationRows.map((r) => `${r.count} × ${r.name}`),
              translate('军团', 'Corporations'),
              ...scanOrganizations(scan.members, 'corporation').map(
                (r) => `${r.count} × ${r.name}`,
              ),
            ]),
      ].join('\n')
    : '';

  return (
    <main className="site-shell min-h-screen text-foreground">
      <header className="site-header border-b border-border/80 bg-card/80 backdrop-blur-xl">
        <div className="site-header-grid mx-auto max-w-[1500px] px-4 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="brand-mark grid size-10 place-items-center border border-cyan-400/40 bg-cyan-400/10 text-cyan-300">
              <Radar className="size-5" />
            </div>
            <div>
              <p className="glory-wordmark font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">
                Glory Navy
              </p>
              <h1 className="text-lg font-semibold">
                {translate('战场扫描', 'Battle Scanner')}
              </h1>
            </div>
          </div>
          <ServerStatus />
          <ToolNavigation active="dscan" onSelect={onSwitch} />
        </div>
      </header>
      <div className="site-content mx-auto max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">
        <Collapsible
          open={inputOpen}
          onOpenChange={setInputOpen}
          className="hud-panel mb-5 border border-cyan-400/25 bg-card/85"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">
                {translate('扫描输入', 'Scan input')}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {scan
                  ? translate(
                      '结果已保留，可展开修改或粘贴下一轮扫描。',
                      'Results are retained. Expand to edit or paste another scan.',
                    )
                  : translate(
                      '从游戏复制，粘贴后分析。',
                      'Copy from EVE, paste, and analyze.',
                    )}
              </p>
            </div>
            <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>
              <ChevronDown className={inputOpen ? 'rotate-180' : ''} />
              {inputOpen
                ? translate('收起输入', 'Collapse input')
                : translate('编辑 / 重新粘贴', 'Edit / paste again')}
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="border-t border-border p-4 sm:p-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <label
                  htmlFor="battle-scan-input"
                  className="mb-2 block text-sm font-medium"
                >
                  {translate(
                    '粘贴扫描结果或频道成员名单',
                    'Paste a scan or channel member list',
                  )}
                </label>
                <Textarea
                  ref={scanInput}
                  id="battle-scan-input"
                  className="field-sizing-fixed h-56 min-h-40 max-h-80 resize-y overflow-y-auto font-mono text-sm"
                  value={input}
                  onKeyDown={(event) => {
                    if (
                      (event.ctrlKey || event.metaKey) &&
                      event.key === 'Enter' &&
                      !busy &&
                      !sharing
                    ) {
                      event.preventDefault();
                      void analyze();
                    }
                  }}
                  onChange={(event) => editInput(event.target.value)}
                  placeholder={translate(
                    '游戏内：选中一行 → Ctrl+A → Ctrl+C，粘贴到这里。\n方向扫描：物品 ID / 名称 / 类型 / 距离\n本地或舰队频道：每行一个角色名',
                    'In EVE: select a row → Ctrl+A → Ctrl+C, then paste here.\nD-Scan: type ID / name / type / distance\nLocal or fleet channel: one character per line',
                  )}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!index}
                    onClick={sample}
                  >
                    {translate('载入示例', 'Load example')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={newScan}>
                    <Trash2 data-icon="inline-start" />
                    {translate('清空', 'Clear')}
                  </Button>
                  <span className="ml-auto self-center text-xs text-muted-foreground">
                    {number(input.length)} / 350,000
                  </span>
                </div>
              </div>
              <div className="space-y-4">
                <label className="field-block">
                  <span>{translate('输入类型', 'Input type')}</span>
                  <NativeSelect
                    value={mode}
                    onChange={(event) => {
                      editInput(input);
                      setMode(event.target.value as InputMode);
                    }}
                  >
                    <NativeSelectOption value="auto">
                      {translate('自动识别', 'Detect automatically')}
                    </NativeSelectOption>
                    <NativeSelectOption value="dscan">
                      {translate(
                        '方向扫描（D-Scan）',
                        'Directional scan (D-Scan)',
                      )}
                    </NativeSelectOption>
                    <NativeSelectOption value="members">
                      {translate(
                        '本地 / 舰队频道成员',
                        'Local / fleet channel members',
                      )}
                    </NativeSelectOption>
                  </NativeSelect>
                </label>
                <label className="field-block">
                  <span>
                    {translate('扫描备注（可选）', 'Scan label (optional)')}
                  </span>
                  <Input
                    disabled={busy || sharing}
                    maxLength={120}
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      if (scan)
                        changeScan({ ...scan, title: event.target.value });
                    }}
                    placeholder={translate(
                      '例如：目标星系 · 第一轮',
                      'e.g. Target system · first pass',
                    )}
                  />
                </label>
                <Button
                  className="h-11 w-full"
                  disabled={!index || busy || sharing || !input.trim()}
                  onClick={() => void analyze()}
                >
                  {busy ? (
                    <RefreshCw
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <Radar data-icon="inline-start" />
                  )}
                  {busy
                    ? progress === 'share'
                      ? translate('读取分享中…', 'Loading shared scan…')
                      : `${translate('查询成员', 'Looking up members')} ${progress}`
                    : translate('分析战场', 'Analyze scan')}
                </Button>
                <p className="text-sm leading-6 text-muted-foreground">
                  {translate(
                    '方向扫描在浏览器内分析；成员名单只查询公开的军团、联盟信息，无需角色登录。舰队频道名单不包含舰型或装配。',
                    'D-Scan is analyzed in your browser. Member lists use public corporation and alliance data, without character login. Fleet chat lists do not contain ship types or fittings.',
                  )}
                </p>
                <details className="text-sm">
                  <summary className="cursor-pointer text-cyan-200">
                    {translate('怎么从游戏复制？', 'How do I copy from EVE?')}
                  </summary>
                  <p className="mt-2 leading-6 text-muted-foreground">
                    {translate(
                      '方向扫描：打开方向扫描器，选中结果后 Ctrl+A、Ctrl+C。本地 / 舰队名单：点击频道右侧成员列表中的角色，再 Ctrl+A、Ctrl+C。不要复制聊天消息。',
                      'D-Scan: open the directional scanner, select a result, then Ctrl+A and Ctrl+C. For local/fleet lists, select a character in the channel member list, then Ctrl+A and Ctrl+C. Do not copy chat messages.',
                    )}
                  </p>
                </details>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
        {!index && (
          <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
            {dataError
              ? errorText('DATA_UNAVAILABLE')
              : translate('正在载入扫描数据库…', 'Loading scan database…')}
            {dataError && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDataAttempt((v) => v + 1)}
              >
                {translate('重试', 'Retry')}
              </Button>
            )}
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 border border-amber-400/25 bg-amber-400/5 p-3 text-sm text-amber-100"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {errorText(error)}
          </p>
        )}

        {scan && index && (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  {scan.title ||
                    (scan.kind === 'dscan'
                      ? translate('舰船与空间对象', 'Ships and space objects')
                      : translate(
                          '成员与组织组成',
                          'Members and organizations',
                        ))}
                  {scan.example && (
                    <Badge variant="outline" className="ml-3 text-amber-200">
                      {translate('示例数据', 'Example data')}
                    </Badge>
                  )}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {translate('分析于', 'Analyzed')} {time(scan.analyzedAt)} ·{' '}
                  {scan.kind === 'dscan'
                    ? 'D-Scan'
                    : translate('频道成员', 'Channel members')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={newScan}>
                  <Plus />
                  {translate('新扫描', 'New scan')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copy(summaryText, 'summary')}
                >
                  {copied === 'summary' ? <Check /> : <ClipboardCopy />}
                  {translate('复制完整摘要', 'Copy full summary')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || sharing}
                  onClick={() => void share()}
                >
                  <Link2 />
                  {sharing
                    ? translate('保存中…', 'Saving…')
                    : translate('生成分享链接', 'Create share link')}
                </Button>
              </div>
            </div>
            <p className="mb-4 text-xs leading-5 text-muted-foreground">
              {translate(
                '仅点击“生成分享链接”时保存本次结果，链接有效期 30 天，持有链接的人可查看。',
                'The result is saved only when you create a share link. Links last 30 days and can be viewed by anyone who has them.',
              )}
            </p>
            {shareUrl && (
              <div className="mb-5 flex flex-wrap items-center gap-3 border border-cyan-400/25 bg-cyan-400/5 p-4">
                <a
                  href={shareUrl}
                  className="min-w-0 flex-1 break-all text-sm text-cyan-200"
                >
                  {shareUrl}
                </a>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copy(shareUrl, 'link')}
                >
                  {copied === 'link'
                    ? translate('已复制', 'Copied')
                    : translate('复制链接', 'Copy link')}
                </Button>
                {expiresAt && (
                  <span className="w-full text-xs text-muted-foreground">
                    {translate('到期时间', 'Expires')} {time(expiresAt)}
                  </span>
                )}
              </div>
            )}
            <Tabs
              value={resultView}
              onValueChange={(value) => setResultView(String(value))}
            >
              <TabsList className="mb-3 h-auto group-data-horizontal/tabs:h-auto w-full flex-wrap justify-start gap-1 border border-border bg-card/85 p-1">
                <TabsTrigger
                  ref={overviewTab}
                  value="overview"
                  className="min-h-9 flex-none px-4"
                >
                  {translate('编成摘要', 'Summary')}
                </TabsTrigger>
                <TabsTrigger value="details" className="min-h-9 flex-none px-4">
                  {scan.kind === 'dscan'
                    ? translate('详细清单与距离', 'Types & distances')
                    : translate('人员明细', 'Character details')}
                </TabsTrigger>
                {scan.kind === 'dscan' && (
                  <TabsTrigger
                    value="manual"
                    className="min-h-9 flex-none px-4"
                  >
                    {translate('手动补充', 'Manual additions')}
                    {summary?.manualCount ? ' · ' + summary.manualCount : ''}
                  </TabsTrigger>
                )}
                <TabsTrigger
                  ref={rawTab}
                  value="raw"
                  className="min-h-9 flex-none px-4"
                >
                  {translate('原始数据', 'Raw data')}
                  {(summary?.unknown.length ??
                    memberInput?.rejected.length ??
                    0) > 0 && (
                    <span className="text-amber-200">
                      {' '}
                      ·{' '}
                      {summary?.unknown.length ?? memberInput?.rejected.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="overview">
                {summary && (
                  <ScanShipOverview
                    key={scan.analyzedAt}
                    summary={summary}
                    index={index}
                    onUnresolved={() => {
                      setResultView('raw');
                      rawTab.current?.focus();
                    }}
                  />
                )}
                {scan.kind === 'members' && (
                  <ScanMemberOverview
                    key={scan.analyzedAt}
                    scan={scan}
                    busy={busy}
                  />
                )}
              </TabsContent>
              <TabsContent
                ref={scanDetails}
                value="details"
                className="tool-result-anchor"
              >
                {summary && (
                  <>
                    {' '}
                    <section className="hud-panel mb-5 overflow-hidden border border-border bg-card/85">
                      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
                        <div className="relative min-w-48 flex-1">
                          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                          <Input
                            className="pl-9"
                            placeholder={translate(
                              '搜索舰型中文名、英文名或 ID…',
                              'Search type name or ID…',
                            )}
                            value={query}
                            onChange={(e) => {
                              setQuery(e.target.value);
                              setPage(1);
                            }}
                          />
                        </div>
                        <NativeSelect
                          aria-label={translate('对象筛选', 'Object filter')}
                          value={category}
                          onChange={(e) => {
                            setCategory(e.target.value);
                            setPage(1);
                          }}
                        >
                          <NativeSelectOption value="ships">
                            {translate('仅舰船', 'Ships')}
                          </NativeSelectOption>
                          <NativeSelectOption value="all">
                            {translate('全部对象', 'All objects')}
                          </NativeSelectOption>
                          <NativeSelectOption value="structures">
                            {translate(
                              '设施与部署物',
                              'Structures / deployables',
                            )}
                          </NativeSelectOption>
                          <NativeSelectOption value="other">
                            {translate(
                              '探针 / 无人机 / 天体等',
                              'Probes / drones / celestials',
                            )}
                          </NativeSelectOption>
                        </NativeSelect>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="pl-4">
                              {translate('型号', 'Type')}
                            </TableHead>
                            <TableHead>{translate('级别', 'Class')}</TableHead>
                            <TableHead className="text-right">
                              {translate('扫描 / 手动', 'Scanned / manual')}
                            </TableHead>
                            <TableHead className="text-right">
                              {translate('数量', 'Count')}
                            </TableHead>
                            <TableHead className="pr-4 text-right">
                              {translate('最近 — 最远', 'Nearest — farthest')}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {typeRows
                            .slice((page - 1) * 40, page * 40)
                            .map((row) => {
                              const group = index.groups.get(row.type[3]);
                              return (
                                <TableRow key={row.type[0]}>
                                  <TableCell className="pl-4">
                                    <div className="flex items-center gap-3">
                                      <EveTypeIcon typeId={row.type[0]} />
                                      <span className="max-w-lg whitespace-normal font-medium">
                                        {label(row.type)}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="whitespace-normal text-sm text-muted-foreground">
                                    {group
                                      ? bilingualName(group[1], group[2])
                                      : '—'}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {row.scanned} /{' '}
                                    <span
                                      className={
                                        row.manual ? 'text-amber-200' : ''
                                      }
                                    >
                                      {row.manual}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-right font-mono font-semibold text-cyan-200">
                                    {row.scanned + row.manual}
                                  </TableCell>
                                  <TableCell className="pr-4 text-right font-mono text-xs">
                                    {distance(row.nearest)} —{' '}
                                    {distance(row.farthest)}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                        </TableBody>
                      </Table>
                      {!typeRows.length && (
                        <p className="p-5 text-sm text-muted-foreground">
                          {translate(
                            '当前筛选没有结果。',
                            'No results for this filter.',
                          )}
                        </p>
                      )}
                      <ScanPagination
                        page={page}
                        total={typeRows.length}
                        onPage={changeDetailsPage}
                      />
                    </section>
                  </>
                )}
                {scan.kind === 'members' && (
                  <>
                    {' '}
                    <section className="hud-panel mb-5 overflow-hidden border border-border bg-card/85">
                      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
                        <Input
                          className="min-w-52 flex-1"
                          placeholder={translate(
                            '搜索角色、军团或联盟…',
                            'Search characters, corporations or alliances…',
                          )}
                          value={query}
                          onChange={(e) => {
                            setQuery(e.target.value);
                            setPage(1);
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void copy(
                              scan.members.map((r) => r.name).join('\n'),
                              'members',
                            )
                          }
                        >
                          {translate(
                            '复制全部角色名',
                            'Copy all character names',
                          )}
                        </Button>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="pl-4">
                              {translate('角色', 'Character')}
                            </TableHead>
                            <TableHead>
                              {translate('军团', 'Corporation')}
                            </TableHead>
                            <TableHead>
                              {translate('联盟', 'Alliance')}
                            </TableHead>
                            <TableHead className="pr-4">
                              {translate('查询状态', 'Lookup status')}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {memberRows
                            .slice((page - 1) * 40, page * 40)
                            .map((row) => (
                              <TableRow key={normalizeScanName(row.name)}>
                                <TableCell className="pl-4 font-medium">
                                  {row.id ? (
                                    <a
                                      className="text-cyan-200 hover:underline"
                                      href={`https://zkillboard.com/character/${row.id}/`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {row.name} ↗
                                    </a>
                                  ) : (
                                    row.name
                                  )}
                                </TableCell>
                                <TableCell className="max-w-sm whitespace-normal">
                                  {row.corporationId
                                    ? entityName(
                                        row.corporationId,
                                        row.corporation,
                                      )
                                    : '—'}
                                </TableCell>
                                <TableCell className="max-w-sm whitespace-normal">
                                  {row.status === 'resolved'
                                    ? entityName(row.allianceId, row.alliance)
                                    : '—'}
                                </TableCell>
                                <TableCell className="pr-4 text-xs text-muted-foreground">
                                  {row.status === 'resolved'
                                    ? `${translate('已查询', 'Resolved')} · ${time(row.checkedAt)}`
                                    : row.status === 'not-found'
                                      ? translate(
                                          '未找到该角色',
                                          'Character not found',
                                        )
                                      : busy
                                        ? translate(
                                            '等待查询',
                                            'Pending lookup',
                                          )
                                        : translate(
                                            '暂未取得归属',
                                            'Affiliation unavailable',
                                          )}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                      <ScanPagination
                        page={page}
                        total={memberRows.length}
                        onPage={changeDetailsPage}
                      />
                    </section>
                  </>
                )}
              </TabsContent>
              {summary && (
                <TabsContent value="manual">
                  {' '}
                  <section className="hud-panel mb-5 border border-border bg-card/85 p-4">
                    <h3 className="cursor-pointer font-medium">
                      {translate(
                        '手动补充舰船（例如扫描不可见的侦察舰）',
                        'Add ships manually (for example, D-Scan-invisible recons)',
                      )}
                    </h3>
                    <div className="mt-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1.6fr_110px_auto]">
                      <label className="field-block">
                        <span>{translate('搜索舰型', 'Search hull')}</span>
                        <Input
                          value={manualQuery}
                          onChange={(e) => {
                            setManualQuery(e.target.value);
                            setManualId('');
                          }}
                        />
                      </label>
                      <label className="field-block">
                        <span>{translate('选择舰型', 'Select hull')}</span>
                        <NativeSelect
                          value={manualId}
                          onChange={(e) => setManualId(e.target.value)}
                        >
                          <NativeSelectOption value="">
                            {translate('选择一艘舰船…', 'Select a hull…')}
                          </NativeSelectOption>
                          {shipOptions.map((t) => (
                            <NativeSelectOption key={t[0]} value={t[0]}>
                              {label(t)}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </label>
                      <label className="field-block">
                        <span>{translate('数量', 'Quantity')}</span>
                        <Input
                          type="number"
                          min={1}
                          max={10000}
                          value={manualQuantity}
                          onChange={(e) => setManualQuantity(e.target.value)}
                        />
                      </label>
                      <Button
                        disabled={
                          !manualId ||
                          !Number.isInteger(Number(manualQuantity)) ||
                          Number(manualQuantity) < 1 ||
                          Number(manualQuantity) > 10000 ||
                          scan.manual.length >= 100 ||
                          sharing ||
                          busy
                        }
                        onClick={() => {
                          const id = Number(manualId),
                            quantity = Number(manualQuantity);
                          if (
                            !Number.isFinite(quantity) ||
                            quantity < 1 ||
                            quantity > 10000
                          )
                            return;
                          const map = new Map(scan.manual);
                          map.set(
                            id,
                            Math.min(10000, (map.get(id) ?? 0) + quantity),
                          );
                          changeScan({ ...scan, manual: [...map] });
                        }}
                      >
                        <Plus />
                        {translate('添加', 'Add')}
                      </Button>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {translate(
                        '补充项会明确标注为手动，不会伪装成实际扫描结果。',
                        'Manual additions are labeled separately from observed scan results.',
                      )}
                    </p>
                    {scan.manual.map(([id, qty]) => (
                      <div
                        key={id}
                        className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-2 text-sm"
                      >
                        <span>
                          {index.types.has(id)
                            ? label(index.types.get(id)!)
                            : `ID ${id}`}{' '}
                          · {qty}
                        </span>
                        <Button
                          disabled={sharing || busy}
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            changeScan({
                              ...scan,
                              manual: scan.manual.filter((r) => r[0] !== id),
                            })
                          }
                        >
                          {translate('移除补充', 'Remove addition')}
                        </Button>
                      </div>
                    ))}
                  </section>
                </TabsContent>
              )}
              <TabsContent value="raw">
                {summary && parsed && (
                  <>
                    {' '}
                    {summary.unknown.length > 0 && (
                      <details
                        open
                        className="mb-5 border border-amber-400/25 bg-amber-400/5 p-4"
                      >
                        <summary className="cursor-pointer text-sm font-medium text-amber-100">
                          {translate(
                            `未识别 ${summary.unknown.length} 行（未计入舰船统计）`,
                            `${summary.unknown.length} unresolved rows (excluded from ship counts)`,
                          )}
                        </summary>
                        <div className="mt-3 max-h-64 overflow-auto text-sm">
                          {summary.unknown.map((row) => (
                            <p key={row.line} className="mb-2 break-words">
                              <span className="mr-2 text-amber-200">
                                #{row.line}{' '}
                                {row.issue === 'ambiguous'
                                  ? translate(
                                      '同名歧义，需物品 ID',
                                      'Ambiguous name; Type ID required',
                                    )
                                  : translate(
                                      '未知类型 / 格式',
                                      'Unknown type / format',
                                    )}
                              </span>
                              {row.name} · {row.typeText} · {row.distance}
                            </p>
                          ))}
                        </div>
                      </details>
                    )}
                    <section className="mb-5 border border-border bg-card/85 p-4">
                      <h3 className="text-sm font-medium">
                        {translate(
                          `原始扫描明细 · ${parsed.entries.length} 行`,
                          `Raw scan details · ${parsed.entries.length} rows`,
                        )}
                      </h3>
                      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre text-xs">
                        {scan.raw}
                      </pre>
                    </section>
                  </>
                )}
                {scan.kind === 'members' && memberInput && (
                  <>
                    {' '}
                    {memberInput.rejected.length > 0 && (
                      <details className="mb-5 border border-amber-400/25 p-4 text-sm">
                        <summary className="cursor-pointer text-amber-200">
                          {translate(
                            `${memberInput.rejected.length} 行不是有效角色名`,
                            `${memberInput.rejected.length} invalid member rows`,
                          )}
                        </summary>
                        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap">
                          {memberInput.rejected.join('\n')}
                        </pre>
                      </details>
                    )}
                    <section className="border border-border bg-card/85 p-4">
                      <h3 className="mb-3 font-medium">
                        {translate('原始成员名单', 'Original member list')}
                      </h3>
                      <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap text-sm">
                        {scan.raw}
                      </pre>
                    </section>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
        <footer className="py-2 text-xs leading-5 text-muted-foreground">
          SDE {data?.sde ?? '—'} ·{' '}
          {translate(
            '战场扫描是复制内容的分析工具，不会操作游戏，也不会根据舰型推算配装、DPS 或胜率。',
            'Battle Scanner analyzes copied content. It does not control EVE or infer fittings, DPS or win probability from hull types.',
          )}
        </footer>
      </div>
    </main>
  );
}

function ScanPagination({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
      <span>
        {number(total)} {translate('项', 'results')}
      </span>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {translate('上一页', 'Previous')}
        </Button>
        <span>
          {page} / {Math.max(1, Math.ceil(total / 40))}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page * 40 >= total}
          onClick={() => onPage(page + 1)}
        >
          {translate('下一页', 'Next')}
        </Button>
      </div>
    </div>
  );
}
