'use client';

import { useState } from 'react';
import { CalendarClock, ClipboardCopy, Factory, Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { clampNumber, type FacilityProfile, type GraphNode, type PlanningPreferences, type ProductionCharacter, type ProductionSchedule, type ProductRule } from '@/lib/industry-planning';
import { formatLocalizedNumber, languageLocale, translate, useLanguage } from './language-provider';

export const DEFAULT_PLANNING: PlanningPreferences = {
  characters: [{ id: 'pilot-1', name: '', manufacturingSlots: 1, reactionSlots: 1, availableHours: 0, manufacturingTime: '', reactionTime: '' }],
  profiles: [], rules: {}, defaultBlueprints: 1, defaultMaxRuns: 0, maxJobHours: 720, handoffMinutes: 0, startAt: '',
};

/** Browser preferences are optional input, so malformed or old values cannot break the planner. */
export function restorePlanning(value: unknown): PlanningPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_PLANNING;
  const raw = value as Partial<PlanningPreferences>;
  const validCharacters = Array.isArray(raw.characters) ? raw.characters.slice(0, 20).filter((item) => item && typeof item === 'object') : DEFAULT_PLANNING.characters;
  const characters = validCharacters.map((item, i) => ({
    id: `pilot-${i + 1}`, name: typeof item.name === 'string' ? item.name.slice(0, 100) : '',
    manufacturingSlots: Math.floor(clampNumber(item.manufacturingSlots, 0, 11)), reactionSlots: Math.floor(clampNumber(item.reactionSlots, 0, 11)),
    availableHours: clampNumber(item.availableHours, 0, 87600), manufacturingTime: typeof item.manufacturingTime === 'string' ? item.manufacturingTime : '', reactionTime: typeof item.reactionTime === 'string' ? item.reactionTime : '',
  }));
  const idMap = new Map(validCharacters.map((item, i) => [item.id, `pilot-${i + 1}`]));
  const profiles = Array.isArray(raw.profiles) ? raw.profiles.slice(0, 30).filter((item) => item && typeof item.id === 'string' && (item.activity === 0 || item.activity === 1)).map((item) => ({
    id: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 100) : '', activity: item.activity,
    structure: typeof item.structure === 'string' ? item.structure : 'custom', security: typeof item.security === 'string' ? item.security : 'unknown',
    structureMaterial: clampNumber(item.structureMaterial, 0, 99), rigMaterial: clampNumber(item.rigMaterial, 0, 99), structureTime: clampNumber(item.structureTime, 0, 99), rigTime: clampNumber(item.rigTime, 0, 99),
    costReduction: clampNumber(item.costReduction, 0, 100), costIndex: clampNumber(item.costIndex, 0, 100), tax: clampNumber(item.tax, 0, 100),
  })) : [];
  const rules: Record<string, ProductRule> = {};
  if (raw.rules && typeof raw.rules === 'object') for (const [id, rule] of Object.entries(raw.rules).slice(0, 2500)) {
    if (!/^\d+$/.test(id) || !rule || typeof rule !== 'object') continue;
    rules[id] = {
      ...(rule.blueprints !== undefined ? { blueprints: Math.floor(clampNumber(rule.blueprints, 1, 100, 1)) } : {}),
      ...(rule.maxRuns !== undefined ? { maxRuns: Math.floor(clampNumber(rule.maxRuns, 0, 1e12)) } : {}),
      characterId: typeof rule.characterId === 'string' ? idMap.get(rule.characterId) ?? rule.characterId : '',
      facilityId: typeof rule.facilityId === 'string' ? rule.facilityId : '',
      manualSecondsPerRun: clampNumber(rule.manualSecondsPerRun, 0, 1e10),
    };
  }
  return { characters, profiles, rules, defaultBlueprints: Math.floor(clampNumber(raw.defaultBlueprints, 1, 100, 1)), defaultMaxRuns: Math.floor(clampNumber(raw.defaultMaxRuns, 0, 1e12)), maxJobHours: clampNumber(raw.maxJobHours, 0, 87600, 720), handoffMinutes: clampNumber(raw.handoffMinutes, 0, 525600), startAt: typeof raw.startAt === 'string' ? raw.startAt : '' };
}

export function planningError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'TOO_MANY_BATCHES') return translate('拆分后超过 6,000 项作业，请增加每项流程上限或分批规划。', 'The plan exceeds 6,000 jobs. Increase runs per job or split the plan.');
  if (code === 'SCHEDULE_TOO_COMPLEX') return translate('角色、蓝图与拆分批次的组合过多，请给部分工序指定角色或分批规划。', 'Too many character, blueprint and batch combinations. Assign specific characters or split the plan.');
  if (code === 'CHAIN_TOO_LARGE') return translate('生产链超过可规划规模或含循环依赖，请减少展开深度或拆开计算。', 'The chain is too large or cyclic. Reduce build depth or split the plan.');
  if (code === 'FACILITY_UNAVAILABLE') return translate('工序指定的设施方案不存在或活动不匹配，请重新选择。', 'A selected facility profile is missing or has the wrong activity. Select it again.');
  if (code === 'RECIPE_UNAVAILABLE') return translate('缺少有效配方或基础时长，无法生成排程。', 'A recipe or its base duration is unavailable. Scheduling is unavailable.');
  return translate('无法生成排程，请检查角色、蓝图与工序依赖设置。', 'Unable to schedule. Check characters, blueprints and dependencies.');
}

function duration(seconds: number) {
  const minutes = Math.ceil(seconds / 60);
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
  return [days ? translate(`${days}天`, `${days}d`) : '', hours ? translate(`${hours}小时`, `${hours}h`) : '', mins || (!days && !hours) ? translate(`${mins}分`, `${mins}m`) : ''].filter(Boolean).join(' ');
}

function pilotName(character: ProductionCharacter, index: number) { return character.name.trim() || translate(`角色 ${index + 1}`, `Character ${index + 1}`); }

function NumberField({ label, value, onChange, min = 0, max = 100, placeholder }: { label: string; value: number | string; onChange: (value: string) => void; min?: number; max?: number; placeholder?: string }) {
  return <label className="field-block"><span>{label}</span><Input type="number" min={min} max={max} step="any" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

type SetupProps = {
  value: PlanningPreferences; onChange: (value: PlanningPreferences) => void;
  nodes: GraphNode[]; nameOf: (productId: number) => string; skillsOf: (node: GraphNode) => string;
  manufacturing: FacilityProfile; reaction: FacilityProfile; onSchedule: () => void; error: string; ready: boolean;
};

export function IndustryScheduleSetup({ value, onChange, nodes, nameOf, skillsOf, manufacturing, reaction, onSchedule, error, ready }: SetupProps) {
  useLanguage();
  const [filter, setFilter] = useState('');
  const patch = (change: Partial<PlanningPreferences>) => onChange({ ...value, ...change });
  const updateCharacter = (id: string, change: Partial<ProductionCharacter>) => patch({ characters: value.characters.map((character) => character.id === id ? { ...character, ...change } : character) });
  const updateRule = (id: number, change: Partial<ProductRule>) => patch({ rules: { ...value.rules, [id]: { ...value.rules[id], ...change } } });
  const products = [...new Map(nodes.map((node) => [node.recipe.productId, node])).values()];
  const shown = products.filter((node) => `${nameOf(node.recipe.productId)} ${node.recipe.productId}`.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 100);
  const saveFacility = (profile: FacilityProfile) => patch({ profiles: [...value.profiles, { ...profile, id: crypto.randomUUID(), name: `${profile.name} ${value.profiles.length + 1}` }] });
  return <section className="hud-panel mb-6 min-w-0 border border-cyan-400/25 bg-card/85 p-4 sm:p-5" id="industry-schedule-settings">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.16em] text-cyan-300">03 / Production scheduling</p><h2 className="mt-1 flex items-center gap-2 text-lg font-semibold"><Users className="size-5 text-cyan-300" />{translate('角色与生产排程', 'Characters and production schedule')}</h2></div><Button onClick={onSchedule} disabled={!ready}><CalendarClock data-icon="inline-start" />{translate('一键分配工序', 'Schedule production')}</Button></div>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">{translate('填写当前空闲的制造线和反应线，按前置产物、蓝图份数和可用角色安排工序。要安排前置组件与反应，请在生产链展开中选择“完全展开：可制造组件全部自制”。无需角色授权，排程在当前浏览器计算。', 'Enter available manufacturing and reaction slots. Jobs follow dependencies, blueprint availability and character assignments. Choose “Full chain: build every manufacturable component” in build depth to schedule prerequisites and reactions. No character authorization is required; scheduling runs in this browser.')}</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="field-block"><span>{translate('计划开始（本地时间，可留空）', 'Start (local time, optional)')}</span><Input type="datetime-local" value={value.startAt} onChange={(event) => patch({ startAt: event.target.value })} /></label>
      <NumberField label={translate('每种蓝图 / 配方份数', 'Copies per blueprint / formula')} value={value.defaultBlueprints} min={1} onChange={(v) => patch({ defaultBlueprints: Math.floor(clampNumber(v, 1, 100, 1)) })} />
      <NumberField label={translate('每项作业最多流程（0 = 不限）', 'Max runs per job (0 = unlimited)')} value={value.defaultMaxRuns} max={1e12} onChange={(v) => patch({ defaultMaxRuns: Math.floor(clampNumber(v, 0, 1e12)) })} />
      <NumberField label={translate('目标最长作业（小时；0 = 不限）', 'Target max job hours (0 = unlimited)')} value={value.maxJobHours} max={87600} onChange={(v) => patch({ maxJobHours: clampNumber(v, 0, 87600) })} />
      <NumberField label={translate('前后工序交付 / 搬运间隔（分钟）', 'Delivery / transfer gap (minutes)')} value={value.handoffMinutes} max={525600} onChange={(v) => patch({ handoffMinutes: clampNumber(v, 0, 525600) })} />
    </div>
    <div className="mt-5 space-y-3">{value.characters.map((character, i) => <article className="border border-border/80 bg-background/30 p-3" key={character.id}>
      <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
        <label className="field-block"><span>{translate('角色名称', 'Character name')}</span><Input value={character.name} placeholder={pilotName(character, i)} maxLength={100} onChange={(event) => updateCharacter(character.id, { name: event.target.value })} /></label>
        <NumberField label={translate('空闲制造线（0–11）', 'Free manufacturing slots (0–11)')} value={character.manufacturingSlots} max={11} onChange={(v) => updateCharacter(character.id, { manufacturingSlots: Math.floor(clampNumber(v, 0, 11)) })} />
        <NumberField label={translate('空闲反应线（0–11）', 'Free reaction slots (0–11)')} value={character.reactionSlots} max={11} onChange={(v) => updateCharacter(character.id, { reactionSlots: Math.floor(clampNumber(v, 0, 11)) })} />
        <NumberField label={translate('最早可用：开始后几小时', 'Available after start (hours)')} value={character.availableHours} max={87600} onChange={(v) => updateCharacter(character.id, { availableHours: clampNumber(v, 0, 87600) })} />
        <Button variant="ghost" size="icon" aria-label={translate(`移除 ${pilotName(character, i)}`, `Remove ${pilotName(character, i)}`)} onClick={() => patch({ characters: value.characters.filter((item) => item.id !== character.id) })}><Trash2 /></Button>
      </div>
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">{translate('该角色的技能 / 植入体时间减免', 'Character skills / implant time reductions')}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><NumberField label={translate('制造时间减免 %（留空沿用生产参数）', 'Manufacturing reduction % (blank = facility settings)')} value={character.manufacturingTime} max={99} placeholder={translate('沿用生产参数', 'Use facility settings')} onChange={(v) => updateCharacter(character.id, { manufacturingTime: v })} /><NumberField label={translate('反应时间减免 %（留空沿用生产参数）', 'Reaction reduction % (blank = facility settings)')} value={character.reactionTime} max={99} placeholder={translate('沿用生产参数', 'Use facility settings')} onChange={(v) => updateCharacter(character.id, { reactionTime: v })} /></div></details>
    </article>)}</div>
    <Button className="mt-3" variant="outline" size="sm" disabled={value.characters.length >= 20} onClick={() => patch({ characters: [...value.characters, { id: crypto.randomUUID(), name: '', manufacturingSlots: 1, reactionSlots: 1, availableHours: 0, manufacturingTime: '', reactionTime: '' }] })}><Plus data-icon="inline-start" />{translate('添加角色', 'Add character')}</Button>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">{translate('同一角色的制造与反应槽分开占用；1 + 群量技能 + 高级群量技能，满技能各最多 11 条。请扣除已占用槽位；同一蓝图默认只有一份。', 'Manufacturing and reaction slots are independent: 1 + mass skill + advanced mass skill, up to 11 each. Subtract occupied slots. Each blueprint defaults to one available copy.')}</p>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">{translate('默认按不超过 720 小时（30 天）拆批，并使用候选角色中较慢的时长确定批次；单流程本身超过目标时长时仍保留完整流程。游戏实际可安装流程与 BPC 剩余流程请在开工窗口确认。', 'Batches target at most 720 hours (30 days) by default, using the slowest eligible character. A single run longer than the target remains whole. Confirm installable runs and remaining BPC runs in the game job window.')}</p>
    <details className="mt-5 border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium"><Factory className="mr-2 inline size-4 text-violet-300" />{translate('多设施方案与工序设置', 'Facility profiles and job settings')} · {products.length} {translate('种产品', 'products')}</summary>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{translate('先在上方生产参数中选好建筑与改装件，再保存为设施方案，供不同组件选用。保存的是当时的材料、时间、成本指数和税率；角色技能时间减免另算。', 'Configure a structure and rigs above, then save a facility profile for selected components. Profiles snapshot material, time, cost-index and tax settings; character time reductions are separate.')}</p>
      <div className="my-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={value.profiles.length >= 30} onClick={() => saveFacility(manufacturing)}>{translate('保存当前制造设施', 'Save manufacturing facility')}</Button><Button size="sm" variant="outline" disabled={value.profiles.length >= 30} onClick={() => saveFacility(reaction)}>{translate('保存当前反应设施', 'Save reaction facility')}</Button></div>
      {value.profiles.map((profile) => <div key={profile.id} className="my-2 flex flex-wrap items-center gap-3 rounded border border-border px-3 py-2"><Input className="w-64" aria-label={translate('设施方案名称', 'Facility profile name')} value={profile.name} maxLength={100} onChange={(event) => patch({ profiles: value.profiles.map((item) => item.id === profile.id ? { ...item, name: event.target.value } : item) })} /><span className="flex-1 text-xs text-muted-foreground">{profile.activity ? translate('反应', 'Reaction') : translate('制造', 'Manufacturing')} · {translate('材料', 'Material')} −{profile.structureMaterial}% × −{profile.rigMaterial}% · {translate('时间', 'Time')} −{profile.structureTime}% × −{profile.rigTime}% · {translate('指数', 'Index')} {profile.costIndex}% · {translate('税', 'Tax')} {profile.tax}%</span><Button variant="ghost" size="icon" aria-label={translate('移除设施方案', 'Remove facility profile')} onClick={() => patch({ profiles: value.profiles.filter((item) => item.id !== profile.id), rules: Object.fromEntries(Object.entries(value.rules).map(([id, rule]) => [id, rule.facilityId === profile.id ? { ...rule, facilityId: '' } : rule])) })}><Trash2 /></Button></div>)}
      <Input className="my-4 max-w-lg" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={translate('筛选工序物品名或 Type ID…', 'Filter jobs by item name or Type ID…')} />
      {!products.length && <p className="text-sm text-muted-foreground">{translate('添加成品并选择生产链展开深度后，这里会列出可设置的工序。', 'Add products and choose a build depth to configure their jobs here.')}</p>}
      <div className="max-h-[620px] space-y-3 overflow-y-auto">{shown.map((node) => {
        const id = node.recipe.productId, rule = value.rules[id] ?? {};
        return <article key={id} className="border border-border/70 p-3"><p className="font-medium">{nameOf(id)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{translate('技能要求：', 'Required skills: ')}{skillsOf(node)}</p><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="field-block"><span>{translate('执行角色', 'Assigned character')}</span><NativeSelect value={rule.characterId ?? ''} onChange={(event) => updateRule(id, { characterId: event.target.value })}><NativeSelectOption value="">{translate('自动分配', 'Automatic assignment')}</NativeSelectOption>{rule.characterId && !value.characters.some((item) => item.id === rule.characterId) && <NativeSelectOption value={rule.characterId}>{translate('角色已移除，请重新选择', 'Character removed; select again')}</NativeSelectOption>}{value.characters.map((character, i) => <NativeSelectOption key={character.id} value={character.id}>{pilotName(character, i)}</NativeSelectOption>)}</NativeSelect></label>
          <label className="field-block"><span>{translate('设施方案', 'Facility profile')}</span><NativeSelect value={rule.facilityId ?? ''} onChange={(event) => updateRule(id, { facilityId: event.target.value })}><NativeSelectOption value="">{translate('沿用当前生产参数', 'Use current facility settings')}</NativeSelectOption>{value.profiles.filter((profile) => profile.activity === node.recipe.activity).map((profile) => <NativeSelectOption key={profile.id} value={profile.id}>{profile.name}</NativeSelectOption>)}</NativeSelect></label>
          <NumberField label={translate('蓝图份数（留空沿用默认）', 'Blueprint copies (blank = default)')} value={rule.blueprints ?? ''} min={1} onChange={(v) => updateRule(id, { blueprints: v === '' ? undefined : Math.floor(clampNumber(v, 1, 100, 1)) })} />
          <NumberField label={translate('每项作业最多流程', 'Max runs per job')} value={rule.maxRuns ?? ''} max={1e12} placeholder={translate('沿用默认', 'Use default')} onChange={(v) => updateRule(id, { maxRuns: v === '' ? undefined : Math.floor(clampNumber(v, 0, 1e12)) })} />
        </div><details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">{translate('用游戏中的时长校准', 'Calibrate with the in-game time')}</summary><div className="mt-3 max-w-md"><NumberField label={translate('游戏显示的单流程总时长（秒，0 = 自动）', 'In-game total time for ONE run (seconds, 0 = automatic)')} value={rule.manualSecondsPerRun ?? 0} max={1e10} onChange={(v) => updateRule(id, { manualSecondsPerRun: clampNumber(v, 0, 1e10) })} /></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{translate('该数值须已包含蓝图、技能、植入体和建筑全部修正；填写后不再叠加时间减免。不同角色时长不同，请同时指定执行角色。', 'This value must already include blueprint, skill, implant and facility modifiers. No extra time reductions apply. Assign a character if character times differ.')}</p></details></article>;
      })}</div>
      {products.length > shown.length && <p className="mt-3 text-xs text-muted-foreground">{translate('每次最多显示 100 种工序，输入名称筛选更多。', 'Up to 100 products are shown at once. Filter by name to find more.')}</p>}
    </details>
    <Button className="mt-4 w-full xl:hidden" onClick={onSchedule} disabled={!ready}><CalendarClock data-icon="inline-start" />{translate('一键分配工序', 'Schedule production')}</Button>
    {error && <p role="alert" className="mt-4 border border-amber-400/25 bg-amber-400/5 p-3 text-sm text-amber-100">{error}</p>}
  </section>;
}

export function IndustryScheduleResults({ nodes, schedule, preferences, nameOf }: { nodes: GraphNode[]; schedule: ProductionSchedule; preferences: PlanningPreferences; nameOf: (id: number) => string }) {
  useLanguage();
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [copyState, setCopyState] = useState('');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const names = new Map(preferences.characters.map((character, i) => [character.id, pilotName(character, i)]));
  const origin = preferences.startAt ? new Date(preferences.startAt).getTime() : NaN;
  const timestamp = (seconds: number) => Number.isFinite(origin) ? new Date(origin + seconds * 1000).toLocaleString(languageLocale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : `+ ${duration(seconds)}`;
  const jobs = schedule.jobs.filter((job) => !filter || job.characterId === filter);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(jobs.length / 40)));
  const visible = jobs.slice((currentPage - 1) * 40, currentPage * 40);
  const warnings = nodes.filter((node) => [30, 659].includes(node.recipe.groupId));
  const copy = async () => {
    const headings = translate('角色\t活动\t产线\t物品\t流程\t蓝图编号\t设施\t开始\t完成\t前置工序', 'Character\tActivity\tSlot\tItem\tRuns\tBlueprint copy\tFacility\tStart\tFinish\tDependencies');
    const clean = (value: string) => value.replace(/[\t\r\n]/g, ' ');
    const rows = jobs.map((job) => { const node = byId.get(job.nodeId)!; return [names.get(job.characterId) ?? '', job.activity ? translate('反应', 'Reaction') : translate('制造', 'Manufacturing'), String(job.slot), nameOf(node.recipe.productId), String(job.runs), String(job.blueprintSlot), node.facility.name, timestamp(job.start), timestamp(job.end), node.dependencies.map((id) => nameOf(byId.get(id)!.recipe.productId)).join('; ')].map(clean).join('\t'); });
    try { await navigator.clipboard.writeText([translate('Glory Navy 建议排程（需手动交付和开工）', 'Glory Navy suggested schedule (manual delivery and installation required)'), headings, ...rows].join('\n')); setCopyState('copied'); } catch { setCopyState('failed'); }
  };
  return <section className="hud-panel mb-6 min-w-0 overflow-hidden border border-violet-400/30 bg-card/85" id="industry-schedule-results">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><CalendarClock className="size-5 text-violet-300" />{translate('工序时间表', 'Production timeline')}</h2><p className="mt-1 text-sm text-muted-foreground">{translate('预计整批完工：', 'Estimated plan completion: ')}<strong className="text-cyan-200">{schedule.elapsedSeconds === null ? translate('有工序未能分配', 'Some jobs cannot be assigned') : timestamp(schedule.elapsedSeconds)}</strong> · {schedule.jobs.length} {translate('项作业', 'jobs')}</p></div><Button variant="outline" size="sm" onClick={() => void copy()}><ClipboardCopy data-icon="inline-start" />{copyState === 'copied' ? translate('已复制排程', 'Schedule copied') : translate('复制当前角色排程', 'Copy filtered schedule')}</Button></div>
    {copyState === 'failed' && <p role="alert" className="p-4 text-sm text-amber-200">{translate('复制失败，请允许浏览器访问剪贴板。', 'Copy failed. Allow clipboard access in your browser.')}</p>}
    <div className="space-y-2 border-b border-border p-4 text-sm leading-6 text-muted-foreground"><p>{translate('建议排程，未保证最优：每项作业须等全部前置批次完成后才开工；同一蓝图不能重叠占用，制造与反应分别分配角色槽位。时间已包含选定建筑、改装件、TE 与角色时间修正。', 'Suggested schedule, not guaranteed optimal: jobs wait for every dependency batch to finish. Blueprint copies cannot overlap; manufacturing and reaction use separate character slots. Times include the selected structure, rigs, TE and character modifiers.')}</p><p>{translate('默认材料已备齐、角色具有所需技能、设施可用，完成后及时手动交付与开工；运输间隔按输入值计入。网页不会代你在游戏里开工，也不验证 ESI 权限、主权、角色技能或蓝图库存。未模拟 BPC 剩余总流程的消耗与补图时间，请核对蓝图库存足够覆盖全部批次。', 'Assumes purchased materials are ready, characters are qualified and facilities are usable, with prompt manual delivery and installation. The entered transfer gap is included. This page does not install game jobs or verify ESI access, sovereignty, skills or blueprint inventory. BPC run depletion and replacement-copy lead times are not modeled. Check that blueprint inventory covers all batches.')}</p><p>{translate('拆分批次后的材料按每项作业分别取整，采购清单与费用会随拆分设置重新计算；每流程成品数量不等于流程数；不同层级的生产余量暂不回填使用。', 'Materials round separately for each split job, so input quantities and costs are recalculated when batching changes. Output quantity per run is distinct from the number of runs; surplus from different chain levels is not reused.')}</p></div>
    {warnings.length > 0 && <p className="border-b border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-6 text-amber-100">{translate('计划含泰坦 / 超级航母：单艘总装是一个流程，增加角色只能加速前置工序。总装需要符合要求的索迪约超级旗舰船坞、主权与位置条件，请在游戏中核实；普通工程建筑不能据此排程直接开工。', 'This plan includes a titan / supercarrier. A single hull is one assembly run; extra characters only speed up prerequisites. Final assembly requires an eligible Sotiyo supercapital shipyard and the appropriate sovereignty and location. Verify these conditions in EVE.')}</p>}
    {nodes.some((node) => node.recipe.activity === 1) && <p className="border-b border-violet-400/20 bg-violet-400/5 p-4 text-sm text-violet-100">{translate('反应需要 0.4 及以下星系、可用炼化厂与相应反应服务。', 'Reactions require a system with security 0.4 or below, a refinery and the appropriate active reaction service.')}</p>}
    {schedule.problems.length > 0 && <div role="alert" className="border-b border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100"><strong>{translate(`${schedule.problems.length} 道工序未分配，整批完工时间不可用`, `${schedule.problems.length} unassigned operations; whole-plan completion is unavailable`)}</strong>{schedule.problems.slice(0, 12).map((problem) => <p key={problem.nodeId} className="mt-1">{nameOf(byId.get(problem.nodeId)!.recipe.productId)} · {problem.reason === 'dependency-blocked' ? translate('前置工序未能分配', 'Dependency could not be assigned') : problem.reason === 'character-missing' ? translate('指定角色已移除', 'Assigned character was removed') : translate('没有符合设置的空闲产线', 'No eligible character slots')}</p>)}</div>}
    <div className="grid gap-3 p-4 md:grid-cols-2">{preferences.characters.map((character, i) => {
      const assigned = schedule.jobs.filter((job) => job.characterId === character.id);
      return <article key={character.id} className="min-w-0 border border-border/70 p-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{pilotName(character, i)}</strong><span className="text-muted-foreground">{assigned.length} {translate('项作业', 'jobs')} · {translate('最后完成', 'Last finish')} {assigned.length ? timestamp(Math.max(...assigned.map((job) => job.end))) : '—'}</span></div><div className="mt-3 space-y-2">{([0, 1] as const).flatMap((activity) => [...new Set(assigned.filter((job) => job.activity === activity).map((job) => job.slot))].sort((a, b) => a - b).map((slot) => <div key={`${activity}:${slot}`} className="flex items-center gap-2"><span className="w-20 shrink-0 text-xs text-muted-foreground">{activity ? translate('反应', 'Reaction') : translate('制造', 'Build')} #{slot}</span><div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-background/60" aria-hidden="true">{assigned.filter((job) => job.activity === activity && job.slot === slot).map((job) => <span key={job.id} className={`absolute top-0 h-full border-r border-background/40 ${activity ? 'bg-violet-400/60' : 'bg-cyan-400/60'}`} style={{ left: `${job.start / Math.max(1, schedule.partialSeconds) * 100}%`, width: `${Math.max(0.15, (job.end - job.start) / Math.max(1, schedule.partialSeconds) * 100)}%` }} title={`${nameOf(byId.get(job.nodeId)!.recipe.productId)} · ${timestamp(job.start)} → ${timestamp(job.end)}`} />)}</div></div>))}</div></article>;
    })}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border px-4 py-3"><label className="flex items-center gap-3 text-sm"><span>{translate('查看角色', 'Filter character')}</span><NativeSelect value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><NativeSelectOption value="">{translate('全部角色', 'All characters')}</NativeSelectOption>{preferences.characters.map((character, i) => <NativeSelectOption key={character.id} value={character.id}>{pilotName(character, i)}</NativeSelectOption>)}</NativeSelect></label><span className="text-xs text-muted-foreground">{translate('时间使用当前设备时区；未填开始时间则显示相对用时。', 'Uses this device’s time zone; no start time means relative elapsed time.')}</span></div>
    <Table><TableHeader><TableRow><TableHead className="pl-4">{translate('执行人 / 产线', 'Character / slot')}</TableHead><TableHead>{translate('工序 / 前置', 'Job / dependencies')}</TableHead><TableHead>{translate('流程 / 蓝图份号', 'Runs / copy #')}</TableHead><TableHead>{translate('设施', 'Facility')}</TableHead><TableHead>{translate('开始', 'Start')}</TableHead><TableHead>{translate('完成', 'Finish')}</TableHead><TableHead className="pr-4">{translate('占线时间', 'Slot duration')}</TableHead></TableRow></TableHeader><TableBody>{visible.map((job) => { const node = byId.get(job.nodeId)!; return <TableRow key={job.id}><TableCell className="pl-4"><p>{names.get(job.characterId)}</p><p className={`mt-1 text-xs ${job.activity ? 'text-violet-300' : 'text-cyan-300'}`}>{job.activity ? translate('反应线', 'Reaction slot') : translate('制造线', 'Manufacturing slot')} #{job.slot}</p></TableCell><TableCell className="max-w-md whitespace-normal"><p className="font-medium">{nameOf(node.recipe.productId)}</p><p className="mt-1 text-xs text-muted-foreground">{translate(`第 ${job.batch}/${node.batches.length} 批`, `Batch ${job.batch}/${node.batches.length}`)} · {node.dependencies.length ? translate(`等待 ${node.dependencies.length} 道前置工序全部批次`, `Wait for all batches of ${node.dependencies.length} prerequisites`) : translate('采购材料齐备后可开工', 'Ready when purchased inputs arrive')}</p>{node.dependencies.length > 0 && <details className="mt-1 text-xs"><summary className="cursor-pointer text-violet-200">{translate('查看前置工序', 'Show dependencies')}</summary>{node.dependencies.map((id) => <p key={id} className="mt-1">{nameOf(byId.get(id)!.recipe.productId)}</p>)}</details>}</TableCell><TableCell className="font-mono">{formatLocalizedNumber(job.runs)} / #{job.blueprintSlot}</TableCell><TableCell className="max-w-48 whitespace-normal text-xs">{node.facility.name}</TableCell><TableCell className="font-mono text-xs">{timestamp(job.start)}</TableCell><TableCell className="font-mono text-xs text-cyan-200">{timestamp(job.end)}</TableCell><TableCell className="pr-4 font-mono text-xs">{duration(job.end - job.start)}</TableCell></TableRow>; })}</TableBody></Table>
    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm"><span>{jobs.length} {translate('项作业', 'jobs')}</span><div className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{translate('上一页', 'Previous')}</Button><span>{currentPage} / {Math.max(1, Math.ceil(jobs.length / 40))}</span><Button size="sm" variant="outline" disabled={currentPage * 40 >= jobs.length} onClick={() => setPage(currentPage + 1)}>{translate('下一页', 'Next')}</Button></div></div>
  </section>;
}
