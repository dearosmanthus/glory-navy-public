export type Activity = 0 | 1;
export type PlanningRecipe = {
  productId: number; blueprintId: number; outputQuantity: number; time: number;
  activity: Activity; groupId: number; materials: Array<[number, number]>; skills: Array<[number, number]>;
};
export type FacilityProfile = {
  id: string; name: string; activity: Activity; structure: string; security: string;
  structureMaterial: number; rigMaterial: number; structureTime: number; rigTime: number;
  costReduction: number; costIndex: number; tax: number;
};
export type ProductionCharacter = {
  id: string; name: string; manufacturingSlots: number; reactionSlots: number;
  availableHours: number; manufacturingTime: string; reactionTime: string;
};
export type ProductRule = {
  blueprints?: number; maxRuns?: number; characterId?: string; facilityId?: string;
  /** Game-displayed time for exactly ONE run, already including every time modifier. */
  manualSecondsPerRun?: number;
};
export type PlanningPreferences = {
  characters: ProductionCharacter[]; profiles: FacilityProfile[]; rules: Record<string, ProductRule>;
  defaultBlueprints: number; defaultMaxRuns: number; maxJobHours: number; handoffMinutes: number; startAt: string;
};
export type GraphNode = {
  id: string; recipe: PlanningRecipe; level: number; runs: number; produced: number;
  materialEfficiency: number; timeEfficiency: number; batches: number[];
  dependencies: string[]; facility: FacilityProfile; rule: ProductRule;
  secondsPerRun: number; blueprintCopies: number;
};
export type ProductionGraph = { nodes: GraphNode[]; rawMaterials: Map<number, number> };
export type ScheduledJob = {
  id: string; nodeId: string; batch: number; runs: number; characterId: string;
  activity: Activity; slot: number; blueprintSlot: number; start: number; end: number;
};
export type ScheduleProblem = { nodeId: string; reason: 'no-slots' | 'character-missing' | 'dependency-blocked' };
export type ProductionSchedule = {
  jobs: ScheduledJob[]; problems: ScheduleProblem[]; elapsedSeconds: number | null;
  partialSeconds: number; totalJobSeconds: number; nodeEnds: Map<string, number>;
};

export function clampNumber(value: unknown, min: number, max: number, fallback = min) {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function splitRuns(runs: number, copies: number, maxRuns = 0): number[] {
  const parallel = Math.min(runs, Math.max(1, Math.floor(copies)));
  const count = Math.max(parallel, maxRuns > 0 ? Math.ceil(runs / maxRuns) : 1);
  if (count > 6000) throw new Error('TOO_MANY_BATCHES');
  const small = Math.floor(runs / count);
  return Array.from({ length: count }, (_, index) => small + (index < runs % count ? 1 : 0));
}

export function requiredMaterial(base: number, runs: number, me: number, rig: number, structure: number, activity: Activity) {
  const multiplier = (activity === 1 ? 1 : 1 - me / 100) * (1 - rig / 100) * (1 - structure / 100);
  // EVE rounds the discounted job quantity to two decimals before rounding up.
  return Math.max(runs, Math.ceil(Math.round(base * runs * multiplier * 100) / 100));
}

export function buildProductionGraph(input: {
  plan: Array<{ productId: number; quantity: string; me: string; te: string }>;
  recipes: Map<number, PlanningRecipe>; expansion: 'direct' | 'one' | 'all';
  componentMe: number; componentTe: number; preferences: PlanningPreferences;
  manufacturing: FacilityProfile; reaction: FacilityProfile;
  defaultSkills?: { manufacturing: number; reaction: number };
}): ProductionGraph {
  const { recipes, preferences } = input;
  type Demand = { recipe: PlanningRecipe; requested: number; me: number; te: number; parents: Set<string> };
  const keyOf = (recipe: PlanningRecipe, me: number, te: number) => `${recipe.productId}:${me}:${te}`;
  const add = (map: Map<string, Demand>, recipe: PlanningRecipe, requested: number, me: number, te: number, parent?: string) => {
    const key = keyOf(recipe, me, te);
    const demand = map.get(key) ?? { recipe, requested: 0, me, te, parents: new Set<string>() };
    demand.requested += requested;
    if (parent) demand.parents.add(parent);
    map.set(key, demand);
  };
  let frontier = new Map<string, Demand>();
  for (const item of input.plan) {
    const recipe = recipes.get(item.productId);
    if (!recipe || recipe.time <= 0 || recipe.outputQuantity <= 0) throw new Error('RECIPE_UNAVAILABLE');
    add(frontier, recipe, Math.ceil(clampNumber(item.quantity, 1, 1e12)), recipe.activity ? 0 : clampNumber(item.me, 0, 10), recipe.activity ? 0 : clampNumber(item.te, 0, 20));
  }
  const rawMaterials = new Map<number, number>();
  const byId = new Map<string, GraphNode>();
  let batchCount = 0;
  for (let level = 0; frontier.size; level++) {
    if (level > 12 || byId.size + frontier.size > 2500) throw new Error('CHAIN_TOO_LARGE');
    const next = new Map<string, Demand>();
    for (const [key, demand] of frontier) {
      const { recipe, requested, me, te } = demand;
      const id = `${level}:${key}`;
      const rule = preferences.rules[String(recipe.productId)] ?? {};
      const facility = rule.facilityId
        ? preferences.profiles.find((profile) => profile.id === rule.facilityId && profile.activity === recipe.activity)
        : recipe.activity ? input.reaction : input.manufacturing;
      if (!facility) throw new Error('FACILITY_UNAVAILABLE');
      const runs = Math.ceil(requested / recipe.outputQuantity);
      const blueprintCopies = Math.floor(clampNumber(rule.blueprints ?? preferences.defaultBlueprints, 1, 100, 1));
      let maxRuns = Math.floor(clampNumber(rule.maxRuns ?? preferences.defaultMaxRuns, 0, 1e12));
      const secondsPerRun = recipe.time * (1 - te / 100) * (1 - facility.structureTime / 100) * (1 - facility.rigTime / 100);
      if (!Number.isFinite(secondsPerRun) || secondsPerRun <= 0) throw new Error('RECIPE_UNAVAILABLE');
      if (preferences.maxJobHours > 0) {
        const eligible = preferences.characters.filter((character) => (!rule.characterId || character.id === rule.characterId) && (recipe.activity ? character.reactionSlots : character.manufacturingSlots) > 0);
        const fallback = recipe.activity ? input.defaultSkills?.reaction ?? 0 : input.defaultSkills?.manufacturing ?? 0;
        const slowestPerRun = rule.manualSecondsPerRun || secondsPerRun * Math.max(...(eligible.length ? eligible.map((character) => {
          const skill = recipe.activity ? character.reactionTime : character.manufacturingTime;
          return 1 - (skill.trim() === '' ? fallback : clampNumber(skill, 0, 99)) / 100;
        }) : [1 - fallback / 100]));
        const timeCap = Math.max(1, Math.floor(preferences.maxJobHours * 3600 / slowestPerRun));
        maxRuns = maxRuns > 0 ? Math.min(maxRuns, timeCap) : timeCap;
      }
      const batches = splitRuns(runs, blueprintCopies, maxRuns);
      batchCount += batches.length;
      if (batchCount > 6000) throw new Error('TOO_MANY_BATCHES');
      const node: GraphNode = { id, recipe, level, runs, produced: runs * recipe.outputQuantity, materialEfficiency: me, timeEfficiency: te, batches, dependencies: [], facility, rule, secondsPerRun, blueprintCopies };
      byId.set(id, node);
      for (const parent of demand.parents) byId.get(parent)!.dependencies.push(id);
      for (const [materialId, base] of recipe.materials) {
        const quantity = batches.reduce((sum, batch) => sum + requiredMaterial(base, batch, me, facility.rigMaterial, facility.structureMaterial, recipe.activity), 0);
        const child = recipes.get(materialId);
        const expand = input.expansion === 'all' || (input.expansion === 'one' && level === 0);
        if (child && expand) {
          if (child.productId === recipe.productId || level === 12) throw new Error('CHAIN_TOO_LARGE');
          add(next, child, quantity, child.activity ? 0 : input.componentMe, child.activity ? 0 : input.componentTe, id);
        } else rawMaterials.set(materialId, (rawMaterials.get(materialId) ?? 0) + quantity);
      }
    }
    frontier = next;
  }
  return { nodes: [...byId.values()], rawMaterials };
}

type Interval = { start: number; end: number };
type Slot = { character: ProductionCharacter; slot: number; busy: Interval[] };

function nextGap(start: number, duration: number, calendars: Interval[][]) {
  let time = start;
  for (;;) {
    let next = time;
    for (const intervals of calendars) {
      for (const interval of intervals) {
        if (interval.start >= time + duration) break;
        if (interval.end > time && interval.start < time + duration) next = Math.max(next, interval.end);
      }
    }
    if (next === time) return time;
    time = next;
  }
}

export function scheduleProduction(nodes: GraphNode[], characters: ProductionCharacter[], handoffMinutes: number, defaultSkills: { manufacturing: number; reaction: number }): ProductionSchedule {
  if (characters.length > 20 || nodes.reduce((sum, node) => sum + node.batches.length, 0) > 6000) throw new Error('TOO_MANY_BATCHES');
  const characterIds = new Set(characters.map((character) => character.id));
  if (characterIds.size !== characters.length) throw new Error('DUPLICATE_CHARACTER');
  const slots: [Slot[], Slot[]] = [[], []];
  for (const character of characters) {
    for (const activity of [0, 1] as const) {
      const count = Math.floor(clampNumber(activity ? character.reactionSlots : character.manufacturingSlots, 0, 11));
      for (let slot = 1; slot <= count; slot++) slots[activity].push({ character, slot, busy: [] });
    }
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) throw new Error('INVALID_DEPENDENCY');
  const parents = new Map<string, string[]>();
  const remaining = new Map<string, number>();
  const blueprints = new Map<number, Interval[][]>();
  for (const node of nodes) {
    remaining.set(node.id, node.dependencies.length);
    for (const dependency of node.dependencies) {
      if (!byId.has(dependency)) throw new Error('INVALID_DEPENDENCY');
      parents.set(dependency, [...(parents.get(dependency) ?? []), node.id]);
    }
    const existing = blueprints.get(node.recipe.blueprintId);
    const count = existing ? Math.min(existing.length, node.blueprintCopies) : node.blueprintCopies;
    blueprints.set(node.recipe.blueprintId, Array.from({ length: count }, () => []));
  }
  // Bound work before searching calendars so extreme browser input cannot freeze the page.
  const candidateCount = nodes.reduce((sum, node) => sum + node.batches.length * blueprints.get(node.recipe.blueprintId)!.length * slots[node.recipe.activity].filter((slot) => !node.rule.characterId || slot.character.id === node.rule.characterId).length, 0);
  if (candidateCount > 2_000_000) throw new Error('SCHEDULE_TOO_COMPLEX');
  // Rank by the remaining dependent path. This is a deterministic heuristic, not an optimal solver.
  const ranks = new Map<string, number>();
  const visiting = new Set<string>();
  const rank = (id: string): number => {
    if (ranks.has(id)) return ranks.get(id)!;
    if (visiting.has(id)) throw new Error('INVALID_DEPENDENCY');
    visiting.add(id);
    const node = byId.get(id)!;
    const result = Math.max(...node.batches) * (node.rule.manualSecondsPerRun || node.secondsPerRun) + Math.max(0, ...(parents.get(id) ?? []).map(rank));
    visiting.delete(id); ranks.set(id, result); return result;
  };
  for (const node of nodes) rank(node.id);
  const ready = nodes.filter((node) => node.dependencies.length === 0);
  const jobs: ScheduledJob[] = [];
  const problems: ScheduleProblem[] = [];
  const nodeEnds = new Map<string, number>();
  const failed = new Set<string>();
  let visited = 0;
  while (ready.length) {
    ready.sort((a, b) => ranks.get(b.id)! - ranks.get(a.id)! || a.id.localeCompare(b.id));
    const node = ready.shift()!;
    visited++;
    const eligible = slots[node.recipe.activity].filter((slot) => !node.rule.characterId || slot.character.id === node.rule.characterId);
    const reason = node.dependencies.some((id) => failed.has(id)) ? 'dependency-blocked'
      : node.rule.characterId && !characterIds.has(node.rule.characterId) ? 'character-missing'
        : eligible.length === 0 ? 'no-slots' : null;
    if (reason) { problems.push({ nodeId: node.id, reason }); failed.add(node.id); }
    else {
      const readyAt = node.dependencies.length ? Math.max(...node.dependencies.map((id) => nodeEnds.get(id)!)) + Math.max(0, handoffMinutes) * 60 : 0;
      let nodeEnd = 0;
      for (let batch = 0; batch < node.batches.length; batch++) {
        const runs = node.batches[batch];
        let best: { slot: Slot; blueprintSlot: number; start: number; end: number } | undefined;
        const calendars = blueprints.get(node.recipe.blueprintId)!;
        for (const slot of eligible) {
          const override = node.recipe.activity ? slot.character.reactionTime : slot.character.manufacturingTime;
          const skill = override.trim() === '' ? (node.recipe.activity ? defaultSkills.reaction : defaultSkills.manufacturing) : clampNumber(override, 0, 99);
          const perRun = node.rule.manualSecondsPerRun && node.rule.manualSecondsPerRun > 0 ? node.rule.manualSecondsPerRun : node.secondsPerRun * (1 - skill / 100);
          const duration = Math.max(1, Math.ceil(perRun * runs));
          for (let blueprintSlot = 0; blueprintSlot < calendars.length; blueprintSlot++) {
            const start = nextGap(Math.max(readyAt, clampNumber(slot.character.availableHours, 0, 87600) * 3600), duration, [slot.busy, calendars[blueprintSlot]]);
            const end = start + duration;
            if (!best || end < best.end || (end === best.end && start < best.start)) best = { slot, blueprintSlot, start, end };
          }
        }
        const chosen = best!;
        const interval = { start: chosen.start, end: chosen.end };
        chosen.slot.busy.push(interval); chosen.slot.busy.sort((a, b) => a.start - b.start);
        calendars[chosen.blueprintSlot].push(interval); calendars[chosen.blueprintSlot].sort((a, b) => a.start - b.start);
        jobs.push({ id: `${node.id}/${batch}`, nodeId: node.id, batch: batch + 1, runs, characterId: chosen.slot.character.id, activity: node.recipe.activity, slot: chosen.slot.slot, blueprintSlot: chosen.blueprintSlot + 1, ...interval });
        nodeEnd = Math.max(nodeEnd, chosen.end);
      }
      nodeEnds.set(node.id, nodeEnd);
    }
    for (const parent of parents.get(node.id) ?? []) {
      const count = remaining.get(parent)! - 1;
      remaining.set(parent, count);
      if (!count) ready.push(byId.get(parent)!);
    }
  }
  if (visited !== nodes.length) throw new Error('INVALID_DEPENDENCY');
  jobs.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const partialSeconds = jobs.reduce((max, job) => Math.max(max, job.end), 0);
  return { jobs, problems, elapsedSeconds: problems.length ? null : partialSeconds, partialSeconds, totalJobSeconds: jobs.reduce((sum, job) => sum + job.end - job.start, 0), nodeEnds };
}
