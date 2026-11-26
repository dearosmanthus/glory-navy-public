import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildProductionGraph, requiredMaterial, scheduleProduction, splitRuns } from '../lib/industry-planning.ts';

const facility = { id: 'm', name: 'Manufacturing', activity: 0, structure: 'custom', security: 'null', structureMaterial: 0, rigMaterial: 0, structureTime: 0, rigTime: 0, costReduction: 0, costIndex: 1, tax: 3 };
const reaction = { ...facility, id: 'r', name: 'Refinery', activity: 1 };
const pilot = (id, manufacturingSlots = 1, reactionSlots = 1) => ({ id, name: id, manufacturingSlots, reactionSlots, availableHours: 0, manufacturingTime: '', reactionTime: '' });
const preferences = (patch = {}) => ({ characters: [pilot('A')], profiles: [], rules: {}, defaultBlueprints: 1, defaultMaxRuns: 0, maxJobHours: 0, handoffMinutes: 0, startAt: '', ...patch });
const recipe = (productId, materials, activity = 0, time = 100, outputQuantity = 1) => ({ productId, blueprintId: productId + 10000, outputQuantity, time, activity, groupId: 1, materials, skills: [] });
function graph(recipes, plans = [1], prefs = preferences(), extra = {}) {
  return buildProductionGraph({ plan: plans.map((id) => typeof id === 'number' ? { productId: id, quantity: '1', me: '0', te: '0' } : id), recipes: new Map(recipes.map((r) => [r.productId, r])), expansion: 'all', componentMe: 0, componentTe: 0, preferences: prefs, manufacturing: facility, reaction, ...extra });
}
const schedule = (g, chars = [pilot('A')], gap = 0, skills = { manufacturing: 0, reaction: 0 }) => scheduleProduction(g.nodes, chars, gap, skills);

function validate(g, s, chars, gap = 0) {
  const nodes = new Map(g.nodes.map((node) => [node.id, node]));
  for (const node of g.nodes) {
    const jobs = s.jobs.filter((job) => job.nodeId === node.id);
    assert.equal(jobs.reduce((sum, job) => sum + job.runs, 0), node.runs);
    for (const job of jobs) {
      for (const dependency of node.dependencies) assert.ok(job.start >= s.nodeEnds.get(dependency) + gap * 60);
      const char = chars.find((c) => c.id === job.characterId);
      assert.ok(job.slot <= (job.activity ? char.reactionSlots : char.manufacturingSlots));
      assert.ok(job.start >= char.availableHours * 3600);
      assert.ok(job.end > job.start);
    }
  }
  const resources = new Map();
  for (const job of s.jobs) {
    for (const resource of [`c:${job.characterId}:${job.activity}:${job.slot}`, `b:${nodes.get(job.nodeId).recipe.blueprintId}:${job.blueprintSlot}`]) {
      const list = resources.get(resource) ?? []; list.push(job); resources.set(resource, list);
    }
  }
  for (const jobs of resources.values()) {
    jobs.sort((a, b) => a.start - b.start);
    for (let i = 1; i < jobs.length; i++) assert.ok(jobs[i].start >= jobs[i - 1].end, 'resource double-booked');
  }
}

test('split only whole runs, respect copies and max runs', () => {
  assert.deepEqual(splitRuns(1, 11), [1]);
  assert.deepEqual(splitRuns(10, 3), [4, 3, 3]);
  assert.deepEqual(splitRuns(10, 1, 3), [3, 3, 2, 2]);
  assert.throws(() => splitRuns(1000000, 1, 1), /TOO_MANY_BATCHES/);
});
test('slot capacity serializes independent manufacturing jobs', () => {
  const g = graph([recipe(1, [[34, 1]]), recipe(2, [[34, 1]])], [1, 2]);
  assert.equal(schedule(g).elapsedSeconds, 200);
  const s = schedule(g, [pilot('A', 2)]); assert.equal(s.elapsedSeconds, 100); validate(g, s, [pilot('A', 2)]);
});
test('manufacturing and reactions can use the same character concurrently', () => {
  const g = graph([recipe(1, [[34, 1]]), recipe(2, [[35, 1]], 1)], [1, 2]);
  const s = schedule(g); assert.equal(s.elapsedSeconds, 100); validate(g, s, [pilot('A')]);
});
test('one blueprint cannot be double-booked across characters or batches', () => {
  const g = graph([recipe(1, [[34, 1]])], [{ productId: 1, quantity: '4', me: '0', te: '0' }], preferences({ defaultMaxRuns: 1 }));
  const chars = [pilot('A', 11), pilot('B', 11)]; const s = schedule(g, chars);
  assert.equal(s.elapsedSeconds, 400); validate(g, s, chars);
});
test('multiple blueprint copies speed up component runs but not a single hull', () => {
  const prefs = preferences({ defaultBlueprints: 2 });
  const g = graph([recipe(1, [[2, 4]], 0, 500), recipe(2, [[34, 1]], 0, 100)], [1], prefs);
  const chars = [pilot('A', 2)]; const s = schedule(g, chars);
  assert.equal(s.elapsedSeconds, 700); assert.equal(s.jobs.filter((job) => job.nodeId === g.nodes[0].id).length, 1); validate(g, s, chars);
});
test('shared component dependencies merge demand and wait for the last batch plus transfer', () => {
  const prefs = preferences({ defaultBlueprints: 2 });
  const g = graph([recipe(1, [[3, 2]], 0, 10), recipe(2, [[3, 3]], 0, 20), recipe(3, [[34, 1]], 1, 100)], [1, 2], prefs);
  assert.equal(g.nodes.length, 3); assert.equal(g.nodes.find((node) => node.recipe.productId === 3).runs, 5);
  const chars = [pilot('A', 2, 2)]; const s = schedule(g, chars, 1); assert.equal(s.elapsedSeconds, 380); validate(g, s, chars, 1);
});
test('per-job material rounding changes procurement when batches split', () => {
  const plans = [{ productId: 1, quantity: '2', me: '10', te: '0' }];
  const r = [recipe(1, [[34, 4]])];
  assert.equal(graph(r, plans, preferences()).rawMaterials.get(34), 8);
  const modified = { ...facility, rigMaterial: 2, structureMaterial: 1 };
  const unsplit = graph([recipe(1, [[34, 100]])], plans, preferences(), { manufacturing: modified });
  const split = graph([recipe(1, [[34, 100]])], plans, preferences({ defaultBlueprints: 2 }), { manufacturing: modified });
  assert.equal(unsplit.rawMaterials.get(34), 175); assert.equal(split.rawMaterials.get(34), 176);
  assert.equal(requiredMaterial(1, 5, 10, 2, 1, 0), 5);
});
test('facility snapshot and character time factors multiply; manual time is not discounted twice', () => {
  const saved = { ...facility, id: 'saved', structureTime: 30, rigTime: 20 };
  const prefs = preferences({ profiles: [saved], rules: { 1: { facilityId: 'saved', characterId: 'B' } } });
  const chars = [pilot('A', 11), { ...pilot('B'), manufacturingTime: '50', availableHours: 1 }];
  let g = graph([recipe(1, [[34, 1]], 0, 1000)], [{ productId: 1, quantity: '1', me: '0', te: '20' }], prefs);
  let s = schedule(g, chars); assert.equal(s.jobs[0].start, 3600); assert.equal(s.jobs[0].end - s.jobs[0].start, 224);
  prefs.rules[1].manualSecondsPerRun = 600;
  g = graph([recipe(1, [[34, 1]], 0, 1000)], [1], prefs); s = schedule(g, chars);
  assert.equal(s.jobs[0].end - s.jobs[0].start, 600);
});
test('missing slots or removed character blocks descendants without inventing a completion', () => {
  const g = graph([recipe(1, [[2, 1]]), recipe(2, [[34, 1]], 1)]);
  const s = schedule(g, [pilot('A', 1, 0)]); assert.equal(s.elapsedSeconds, null); assert.equal(s.jobs.length, 0);
  assert.deepEqual(s.problems.map((problem) => problem.reason), ['no-slots', 'dependency-blocked']);
  g.nodes[1].rule = { characterId: 'missing' };
  assert.equal(schedule(g).problems[0].reason, 'character-missing');
});
test('gap insertion allows unrelated work before a future dependency reservation', () => {
  const g = graph([recipe(1, [[2, 1]], 0, 100), recipe(2, [[34, 1]], 1, 1000), recipe(3, [[35, 1]], 0, 100)], [1, 3]);
  const s = schedule(g); assert.equal(s.jobs.find((job) => job.nodeId === g.nodes.find((node) => node.recipe.productId === 3).id).start, 0);
  validate(g, s, [pilot('A')]);
});
test('invalid dependency and over-large work are explicit failures', () => {
  const g = graph([recipe(1, [[34, 1]])]); g.nodes[0].dependencies.push(g.nodes[0].id);
  assert.throws(() => schedule(g), /INVALID_DEPENDENCY/);
});

test('time caps split multi-run jobs using the slowest eligible character and preserve single runs', () => {
  const chars = [{ ...pilot('A', 2), manufacturingTime: '50' }, pilot('B', 2)];
  const prefs = preferences({ characters: chars, maxJobHours: 1, defaultBlueprints: 2 });
  const plans = [{ productId: 1, quantity: '10', me: '0', te: '0' }];
  const g = graph([recipe(1, [[34, 100]], 0, 1000)], plans, prefs);
  assert.ok(g.nodes[0].batches.every((runs) => runs <= 3));
  const s = schedule(g, chars); validate(g, s, chars);
  assert.ok(s.jobs.every((job) => job.end - job.start <= 3600));
  prefs.rules[1] = { characterId: 'A' };
  assert.deepEqual(graph([recipe(1, [[34, 100]], 0, 1000)], plans, prefs).nodes[0].batches, [5, 5]);
  prefs.rules[1] = { manualSecondsPerRun: 2000 };
  assert.ok(graph([recipe(1, [[34, 100]], 0, 1000)], plans, prefs).nodes[0].batches.every((runs) => runs === 1));
  const single = graph([recipe(1, [[34, 100]], 0, 10000)], [1], preferences({ maxJobHours: 1 }));
  assert.deepEqual(single.nodes[0].batches, [1]); assert.equal(schedule(single).elapsedSeconds, 10000);
});
test('real SDE Avatar full chain: every run conserved, dependencies and both resource pools respected', () => {
  const data = JSON.parse(readFileSync(new URL('../public/industry-data.json', import.meta.url), 'utf8'));
  const titan = data.types.find((row) => row[2] === 'Avatar'); assert.ok(titan);
  const recipes = data.recipes.map(([productId, blueprintId, outputQuantity, time, activity, groupId, materials, skills]) => ({ productId, blueprintId, outputQuantity, time, activity, groupId, materials, skills }));
  const chars = [pilot('Component A', 10, 0), pilot('Component B', 10, 0), pilot('Reaction A', 0, 10)];
  const g = graph(recipes, [titan[0]], preferences({ characters: chars, defaultBlueprints: 3, maxJobHours: 720 }));
  const started = performance.now(); const s = schedule(g, chars, 30); const elapsed = performance.now() - started;
  assert.ok(g.nodes.length > 20); assert.ok(g.nodes.some((node) => node.recipe.activity === 1));
  assert.equal(s.problems.length, 0); validate(g, s, chars, 30);
  assert.ok(s.jobs.every((job) => job.runs === 1 || job.end - job.start <= 720 * 3600));
  const assembly = s.jobs.filter((job) => job.nodeId === g.nodes[0].id); assert.equal(assembly.length, 1); assert.equal(assembly[0].runs, 1);
  assert.ok(elapsed < 5000, `Scheduling took ${elapsed}ms`);
  console.log(JSON.stringify({ sample: 'Avatar', sde: data.sde, nodes: g.nodes.length, jobs: s.jobs.length, elapsedDays: s.elapsedSeconds / 86400, schedulerMs: Math.round(elapsed) }));
});
