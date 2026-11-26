# Production scheduling

The industry page can schedule manufacturing and reaction chains without character SSO. All character names, slot counts, availability and facility profiles are browser-local preferences. The scheduler performs no game actions and adds no server endpoint.

## Model

- Build depth determines which inputs are manufactured. Same-product demand with matching ME/TE is merged within each depth; surplus across different depths is not reused.
- Runs are integers. Blueprint copies and max-runs / target-duration limits determine balanced batches. Default duration target is 720 hours, calculated with the slowest eligible character; a single run is never subdivided. This is a planning target, not validation that EVE will accept a job.
- Input quantities are rounded per actual batch before expanding the next component level. The cost calculator uses this same graph, facility profile and scheduled character duration.
- A character has independent manufacturing and reaction calendars, with up to 11 slots in each pool. Each blueprint/formula copy has its own calendar shared across characters and chain levels.
- A deterministic list scheduler prioritizes long remaining dependency paths, then selects the earliest-finishing eligible slot/copy pair. It inserts work into free calendar gaps. This is a heuristic, not an optimal job-shop solver.
- A dependent operation waits for **all** prerequisite batches, plus the entered delivery/transfer interval. Purchased inputs are assumed ready at plan start; characters can have a later availability offset.
- Per-product facility and character assignments override defaults. A manually entered single-run game duration includes all modifiers and is never discounted again.
- Missing slots/characters block the operation and its dependants. Whole-plan completion is unavailable rather than extrapolated from partial work.
- Limits: 20 characters, 2,500 graph nodes, 6,000 batches and 2,000,000 candidate resource combinations. Over-limit plans return an explicit error.

## Practical limits

The model assumes skills, facility access, online services, blueprint copies and material locations are sufficient. It does not verify rig category eligibility, sovereignty, blueprint inventory, finite BPC run depletion or replacement-copy lead time. Each character supplies an aggregate time reduction; blueprint-specific skills can be calibrated with a single-run time override and a pinned character. Completion assumes prompt manual delivery and installation.

Single-hull titan and supercarrier assembly is one indivisible run. Extra characters can accelerate prerequisites but cannot divide that assembly. The UI calls out the relevant supercapital facility/location conditions and reaction security requirements.

## Validation

Run `npm run test:industry` using Node 24+ (native TypeScript type stripping). Tests check slot and blueprint non-overlap, dependency/handoff ordering, run conservation, independent slot pools, availability, batch material rounding, facility/skill factors, missing-resource states, time caps and the current SDE Avatar full chain. These tests verify the planning model; they are not independent in-game timing measurements.

Source checks: `npx tsc --noEmit`, `npx oxlint app/industry-tool.tsx app/industry-schedule.tsx lib/industry-planning.ts tests/industry-planning.test.mjs`, and `npm run build`.

## Research references

- [CCP: Activities and job types](https://support.eveonline.com/hc/en-us/articles/203210272-Activities-and-Job-Types): independent character slot pools and mass skills.
- [CCP: Manufacturing](https://support.eveonline.com/hc/en-us/articles/203210292-Manufacturing): installation inputs and facilities.
- [CCP: Reactions](https://support.eveonline.com/hc/en-us/articles/115005405785-Reactions): refineries, services and security restrictions.
- [CCP: Blueprints](https://support.eveonline.com/hc/en-us/articles/203269951-Blueprints): finite-copy versus original blueprint runs.
- [CCP: Engineering complexes](https://www.eveonline.com/ko/news/view/building-dreams-introducing-engineering-complexes): supercapital shipyard service.
- [User-supplied reference calculator](http://www.ceve-industry.cn/#/): publicly served interface code includes blueprint-copy counts, runs per job, and duration-based batching. Its application code is not incorporated here.
