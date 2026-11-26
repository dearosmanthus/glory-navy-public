'use client';

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Check, ClipboardList, Save, Search, ShieldCheck, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  ATTENDANCE_MAX_MEMBERS,
  ATTENDANCE_STORAGE_KEY,
  emptyAttendanceStore,
  groupAttendanceCorporations,
  mostRecentAttendanceCorporation,
  recordAttendance,
  validateAttendanceStore,
  type AttendanceStore,
} from '@/lib/attendance';
import { parseMemberNames, type ScanMember } from '@/lib/battle-scan';
import { scanFetch } from '@/lib/scan-fetch';
import { revealToolResult } from '@/lib/tool-flow';
import { formatLocalizedNumber, languageLocale, translate, useLanguage } from './language-provider';
import ServerStatus from './server-status';
import ToolNavigation, { type ToolId } from './tool-navigation';

function attendanceError(code: string) {
  const messages: Record<string, [string, string]> = {
    EMPTY_MEMBERS: ['没有识别到角色名，请每行粘贴一位角色。', 'No character names found. Paste one character per line.'],
    TOO_MANY_MEMBERS: [`单次最多统计 ${ATTENDANCE_MAX_MEMBERS} 人，请拆分名单。`, `Analyze up to ${ATTENDANCE_MAX_MEMBERS} characters at a time.`],
    RATE_LIMIT: ['查询过于频繁，请稍后再试。', 'Too many lookups. Please try again later.'],
    REQUEST_TIMEOUT: ['角色军团查询超时，请重试。', 'The corporation lookup timed out. Please retry.'],
    ESI_UNAVAILABLE: ['欧服 ESI 暂时不可用，请稍后重试。', 'Tranquility ESI is temporarily unavailable. Try again later.'],
  };
  return messages[code]
    ? translate(...messages[code])
    : translate('统计没有完成，请检查名单后重试。', 'The attendance analysis did not finish. Check the list and retry.');
}

function localTime(value: string) {
  return new Date(value).toLocaleString(languageLocale(), {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function AttendanceTool({ onSwitch }: { onSwitch: (tool: ToolId) => void }) {
  useLanguage();
  const [input, setInput] = useState('');
  const [members, setMembers] = useState<ScanMember[]>([]);
  const [store, setStore] = useState<AttendanceStore>(emptyAttendanceStore);
  const [selectedCorporationId, setSelectedCorporationId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [parseMeta, setParseMeta] = useState({ duplicates: 0, rejected: 0 });
  const [storageReady, setStorageReady] = useState(false);
  const resultPanel = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(ATTENDANCE_STORAGE_KEY);
        const saved = raw ? validateAttendanceStore(JSON.parse(raw)) : null;
        if (saved) {
          const recent = mostRecentAttendanceCorporation(saved);
          setStore(saved);
          setSelectedCorporationId(recent ? String(recent.corporationId) : '');
          setSelectedSessionId(recent?.attendanceSessions[0]?.id ?? '');
        }
      } catch {
        // Corrupt device-local data is ignored instead of blocking the tool.
      } finally {
        setStorageReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const groups = useMemo(() => groupAttendanceCorporations(members), [members]);
  const savedCorporations = useMemo(() => Object.values(store.corporations)
    .sort((a, b) => b.lastSessionAt.localeCompare(a.lastSessionAt)), [store]);
  const selectedGroup = groups.find((group) => String(group.corporationId) === selectedCorporationId);
  const selectedSaved = store.corporations[selectedCorporationId];
  const selectedSession = selectedSaved?.attendanceSessions.find((session) => session.id === selectedSessionId)
    ?? selectedSaved?.attendanceSessions[0];
  const resolvedCount = members.filter((member) => member.status === 'resolved').length;
  const unresolvedCount = members.length - resolvedCount;

  async function analyze(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    let parsed;
    try {
      parsed = parseMemberNames(input);
    } catch (reason) {
      setError(attendanceError(reason instanceof Error ? reason.message : ''));
      return;
    }
    if (!parsed.names.length) {
      setError(attendanceError('EMPTY_MEMBERS'));
      return;
    }
    if (parsed.names.length > ATTENDANCE_MAX_MEMBERS) {
      setError(attendanceError('TOO_MANY_MEMBERS'));
      return;
    }
    setBusy(true);
    try {
      const payload = await scanFetch<{ members: ScanMember[] }>('/api/scan-characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.names),
      });
      const nextGroups = groupAttendanceCorporations(payload.members);
      setMembers(payload.members);
      setParseMeta({ duplicates: parsed.duplicates, rejected: parsed.rejected.length });
      const nextCorporationId = nextGroups[0] ? String(nextGroups[0].corporationId) : '';
      setSelectedCorporationId(nextCorporationId);
      setSelectedSessionId(store.corporations[nextCorporationId]?.attendanceSessions[0]?.id ?? '');
      if (!nextGroups.length) setError(translate('名单中没有查到可用的军团归属。', 'No corporation affiliations could be resolved from this list.'));
      requestAnimationFrame(() => revealToolResult(resultPanel.current));
    } catch (reason) {
      setError(attendanceError(reason instanceof Error ? reason.message : ''));
    } finally {
      setBusy(false);
    }
  }

  function saveAttendance() {
    if (!selectedGroup) return;
    const occurredAt = new Date().toISOString();
    try {
      const next = recordAttendance(store, selectedGroup, occurredAt);
      window.localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(next));
      setStore(next);
      setSelectedSessionId(next.corporations[String(selectedGroup.corporationId)].attendanceSessions[0].id);
      setNotice(translate(
        `已记录 ${selectedGroup.corporation} 本次 ${selectedGroup.members.length} 人出勤。`,
        `Recorded ${selectedGroup.members.length} attendees for ${selectedGroup.corporation}.`,
      ));
    } catch {
      setError(translate('本次出勤无法保存，请检查浏览器存储权限。', 'Could not save attendance. Check browser storage permissions.'));
    }
  }

  function showSavedCorporation(corporationId: string) {
    setSelectedCorporationId(corporationId);
    setSelectedSessionId(store.corporations[corporationId]?.attendanceSessions[0]?.id ?? '');
    setNotice('');
    requestAnimationFrame(() => revealToolResult(resultPanel.current));
  }

  return (
    <main className="site-shell min-h-screen text-foreground">
      <div className="scanline" aria-hidden="true" />
      <header className="site-header border-b border-border/80 bg-card/80 backdrop-blur-xl">
        <div className="site-header-grid mx-auto max-w-[1500px] px-4 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="brand-mark grid size-10 place-items-center border border-cyan-400/40 bg-cyan-400/10 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,.12)]">
              <ClipboardList className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="glory-wordmark font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Glory Navy</p>
              <h1 className="text-lg font-semibold tracking-tight">{translate('舰队出勤统计', 'Fleet Attendance')}</h1>
            </div>
          </div>
          <ServerStatus />
          <ToolNavigation active="attendance" onSelect={onSwitch} />
        </div>
      </header>

      <div className="site-content mx-auto max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">
        <section className="hud-panel mb-6 border border-border bg-card/80 p-4 shadow-2xl shadow-black/10 sm:p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-semibold"><UsersRound className="size-4 text-cyan-300" aria-hidden="true" />{translate('粘贴出勤人员', 'Paste attendees')}</h2>
              <p id="attendance-input-hint" className="mt-1 text-sm text-muted-foreground">{translate('每行一位欧服角色，自动去重并查询当前军团；角色名只用于本次查询。', 'One Tranquility character per line. Names are deduplicated and their current corporations are resolved.')}</p>
            </div>
            <Badge variant="outline" className="w-fit border-cyan-400/25 text-cyan-200">{translate(`最多 ${ATTENDANCE_MAX_MEMBERS} 人`, `Up to ${ATTENDANCE_MAX_MEMBERS}`)}</Badge>
          </div>
          <form onSubmit={analyze}>
            <label htmlFor="attendance-input" className="sr-only">{translate('出勤人员名单', 'Attendance member list')}</label>
            <Textarea
              id="attendance-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={translate('Chribba\nCCP Explorer\n每行一位角色…', 'Chribba\nCCP Explorer\nOne character per line…')}
              className="min-h-52 resize-y font-mono text-sm"
              aria-describedby="attendance-input-hint"
              aria-invalid={Boolean(error)}
            />
            <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">{translate('军团归属来自 EVE Online 欧服 ESI；历史记录仅保存在当前设备。', 'Corporations come from Tranquility ESI. Attendance history stays on this device.')}</p>
              <Button type="submit" disabled={busy || !input.trim()} className="sm:min-w-36">
                <Search data-icon="inline-start" aria-hidden="true" />
                {busy ? translate('正在查询…', 'Looking up…') : translate('统计军团', 'Find corporations')}
              </Button>
            </div>
          </form>
          {error && <p role="alert" className="mt-4 border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</p>}
        </section>

        {members.length > 0 && (
          <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={translate('本次统计摘要', 'Current analysis summary')}>
            <SummaryCard label={translate('输入角色', 'Characters')} value={members.length} />
            <SummaryCard label={translate('已识别', 'Resolved')} value={resolvedCount} accent />
            <SummaryCard label={translate('军团数量', 'Corporations')} value={groups.length} />
            <SummaryCard label={translate('未识别', 'Unresolved')} value={unresolvedCount + parseMeta.rejected} meta={parseMeta.duplicates ? translate(`另去重 ${parseMeta.duplicates} 人`, `${parseMeta.duplicates} duplicates removed`) : undefined} />
          </section>
        )}

        {(groups.length > 0 || savedCorporations.length > 0) && (
          <section ref={resultPanel} tabIndex={-1} className="tool-result-anchor hud-panel overflow-hidden border border-border bg-card/85 shadow-2xl shadow-black/10">
            <div className="grid gap-4 border-b border-border p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] lg:items-end">
              <div>
                <h2 className="font-semibold">{translate('选择军团并记录', 'Select a corporation and record')}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{translate('一次保存会为本次名单中的每位该军团成员增加 1 次出勤。', 'Each save adds one attendance to every member of the selected corporation in this list.')}</p>
              </div>
              <label className="field-block flex flex-col gap-2" htmlFor="attendance-corporation">
                <span>{translate('军团', 'Corporation')}</span>
                <NativeSelect id="attendance-corporation" value={selectedCorporationId} onChange={(event) => showSavedCorporation(event.target.value)}>
                  {!selectedCorporationId && <NativeSelectOption value="">{translate('请选择军团', 'Select a corporation')}</NativeSelectOption>}
                  {groups.map((group) => <NativeSelectOption key={`current-${group.corporationId}`} value={String(group.corporationId)}>{group.corporation} · {group.members.length}</NativeSelectOption>)}
                  {savedCorporations.filter((corp) => !groups.some((group) => group.corporationId === corp.corporationId)).map((corp) => <NativeSelectOption key={`saved-${corp.corporationId}`} value={String(corp.corporationId)}>{corp.corporation} · {translate('历史', 'Saved')}</NativeSelectOption>)}
                </NativeSelect>
              </label>
            </div>

            {groups.length > 0 && (
              <div className="border-b border-border px-4 py-4">
                <h3 className="text-sm font-medium">{translate('本次识别到的军团', 'Corporations in this list')}</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {groups.map((group) => {
                    const selected = String(group.corporationId) === selectedCorporationId;
                    return (
                      <Button
                        key={group.corporationId}
                        type="button"
                        variant={selected ? 'default' : 'outline'}
                        className={`h-auto min-h-12 justify-between gap-3 px-3 py-2 text-left ${selected ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300' : ''}`}
                        aria-pressed={selected}
                        onClick={() => showSavedCorporation(String(group.corporationId))}
                      >
                        <span className="min-w-0 truncate">{group.corporation}</span>
                        <span className="shrink-0 font-mono">{formatLocalizedNumber(group.members.length)}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedGroup && (
              <div className="flex flex-col gap-3 border-b border-border bg-cyan-400/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-cyan-100">{selectedGroup.corporation}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{translate(`本次名单 ${selectedGroup.members.length} 人`, `${selectedGroup.members.length} members in this list`)}</p>
                </div>
                <Button onClick={saveAttendance} disabled={!storageReady} className="sm:min-w-44">
                  <Save data-icon="inline-start" aria-hidden="true" />{translate('记录本次出勤', 'Record attendance')}
                </Button>
              </div>
            )}
            {notice && <output className="flex items-center gap-2 border-b border-emerald-400/25 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200"><Check className="size-4" aria-hidden="true" />{notice}</output>}

            {selectedSaved ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div>
                    <h3 className="font-medium">{translate(`${selectedSaved.corporation} 出勤名册`, `${selectedSaved.corporation} attendance roster`)}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{translate(`累计 ${selectedSaved.sessions} 次活动 · 最近 ${localTime(selectedSaved.lastSessionAt)}`, `${selectedSaved.sessions} sessions · Latest ${localTime(selectedSaved.lastSessionAt)}`)}</p>
                  </div>
                  <Badge variant="outline" className="border-emerald-400/25 text-emerald-200"><ShieldCheck aria-hidden="true" />{translate(`${selectedSaved.members.length} 名成员`, `${selectedSaved.members.length} members`)}</Badge>
                </div>
                {selectedSaved.attendanceSessions.length > 0 && (
                  <div className="grid border-b border-border lg:grid-cols-[18rem_minmax(0,1fr)]">
                    <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
                      <h4 className="text-sm font-medium">{translate('出勤场次', 'Attendance sessions')}</h4>
                      <div className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
                        {selectedSaved.attendanceSessions.map((session, index) => {
                          const active = session.id === selectedSession?.id;
                          return (
                            <Button
                              key={session.id}
                              type="button"
                              variant={active ? 'default' : 'outline'}
                              className={`h-auto min-h-12 justify-between gap-3 px-3 py-2 text-left ${active ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300' : ''}`}
                              aria-pressed={active}
                              onClick={() => setSelectedSessionId(session.id)}
                            >
                              <span>{translate(`第 ${selectedSaved.sessions - index} 次`, `Session ${selectedSaved.sessions - index}`)}</span>
                              <span className="text-right text-xs"><span className="block">{localTime(session.occurredAt)}</span><span className="block opacity-75">{translate(`${session.memberIds.length} 人`, `${session.memberIds.length} members`)}</span></span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="border-b border-border px-4 py-3">
                        <h4 className="text-sm font-medium">{selectedSession ? translate(`${localTime(selectedSession.occurredAt)} 的出勤名单`, `Attendees on ${localTime(selectedSession.occurredAt)}`) : translate('选择一场出勤', 'Select a session')}</h4>
                      </div>
                      {selectedSession && (
                        <Table>
                          <TableHeader><TableRow><TableHead>{translate('角色', 'Character')}</TableHead><TableHead>{translate('角色 ID', 'Character ID')}</TableHead></TableRow></TableHeader>
                          <TableBody>{selectedSession.memberIds.map((characterId) => {
                            const member = selectedSaved.members.find((item) => item.characterId === characterId);
                            return <TableRow key={characterId}><TableCell className="font-medium">{member?.name ?? `ID ${characterId}`}</TableCell><TableCell className="font-mono text-muted-foreground">{characterId}</TableCell></TableRow>;
                          })}</TableBody>
                        </Table>
                      )}
                    </div>
                  </div>
                )}
                <div className="border-b border-border px-4 py-3">
                  <h4 className="text-sm font-medium">{translate('累计出勤名册', 'Cumulative attendance roster')}</h4>
                </div>
                <Table className="mobile-row-table attendance-result-table">
                  <TableHeader><TableRow><TableHead>{translate('角色', 'Character')}</TableHead><TableHead>{translate('出勤次数', 'Attendance')}</TableHead><TableHead>{translate('首次出勤', 'First seen')}</TableHead><TableHead>{translate('最近出勤', 'Latest')}</TableHead></TableRow></TableHeader>
                  <TableBody>{selectedSaved.members.map((member) => (
                    <TableRow key={member.characterId}>
                      <TableCell className="font-medium">{member.name}</TableCell>
                      <TableCell data-label={translate('出勤次数', 'Attendance')}><span className="font-mono text-cyan-200">{formatLocalizedNumber(member.attendanceCount)}</span></TableCell>
                      <TableCell data-label={translate('首次出勤', 'First seen')}>{localTime(member.firstSeen)}</TableCell>
                      <TableCell data-label={translate('最近出勤', 'Latest')}>{localTime(member.lastSeen)}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </>
            ) : (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {selectedGroup ? translate('尚未保存过该军团的出勤。点击上方按钮记录本次名单。', 'No saved attendance for this corporation yet. Use the button above to record this list.') : translate('请选择一个军团查看出勤名册。', 'Select a corporation to view its attendance roster.')}
              </div>
            )}
          </section>
        )}

        {!members.length && savedCorporations.length > 0 && <p className="mt-4 text-xs text-muted-foreground">{translate('已载入当前设备上的历史出勤记录，可从上方军团选择器查看。', 'Saved attendance history from this device is available in the corporation selector above.')}</p>}
      </div>
    </main>
  );
}

function SummaryCard({ label, value, meta, accent = false }: { label: string; value: number; meta?: string; accent?: boolean }) {
  return <div className={`hud-panel border p-4 ${accent ? 'border-cyan-400/30 bg-cyan-400/8' : 'border-border bg-card/80'}`}><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-2 font-mono text-2xl font-semibold ${accent ? 'text-cyan-200' : ''}`}>{formatLocalizedNumber(value)}</p>{meta && <p className="mt-1 text-xs text-muted-foreground">{meta}</p>}</div>;
}
