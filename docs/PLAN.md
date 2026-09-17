# Manhunter — Plan

Each task is sized for one focused agent session. Do tasks in order unless `deps` says otherwise. Tick the box when done and add a short note if you made a decision later tasks rely on.

Legend: **deps** = tasks that must be done first. **AC** = acceptance criteria (all must be tested where testable).

---

## M0 — Project scaffold

- [ ] **M0.1 Monorepo skeleton**
  deps: —
  Create Bun workspaces: `packages/core`, `packages/sim`, `apps/web`. Each app gets an empty composition root (`apps/web/src/main.tsx`, `packages/sim/src/main.ts`). Root `package.json` with scripts from AGENTS.md. `tsconfig.base.json` with strict flags; each workspace extends it.
  AC: `bun install` and `bun run typecheck` succeed on empty packages.

- [ ] **M0.2 Biome**
  deps: M0.1
  Add `biome.json`: formatter + linter + import sorting. Restrict globals/imports in `packages/core` (`Math.random`, `Date`, `console`, `process`, `window`, `document`, any `node:` import).
  Also enable rules backing the engineering principles in AGENTS.md: `noUselessElse`, `useEarlyReturn`-style complexity limits (`noExcessiveCognitiveComplexity`), no classes in `core`, no default exports, and a nesting-depth cap. Add `limits.ts` stubs in `core`, `sim`, and `web`.
  AC: `bun run lint` passes; a deliberately added `Math.random()` in core and a needless `else` both fail lint (verify, then remove).

- [ ] **M0.3 Vitest + fast-check**
  deps: M0.1
  Vitest workspace config covering all packages. Add `@fast-check/vitest`. One trivial test per workspace.
  AC: `bun run test` runs all workspaces; coverage report generated for `core`.

- [ ] **M0.4 Vite + React app shell**
  deps: M0.1
  `apps/web` renders a placeholder page that imports a constant from `core`.
  AC: `bun run dev` serves it; `bun run build` produces static output.

- [ ] **M0.5 Playwright**
  deps: M0.4
  One e2e test: page loads and shows the title.
  AC: `bun run test:e2e` passes headless.

- [ ] **M0.6 CI**
  deps: M0.2, M0.3, M0.5
  GitHub Actions: install (cached), `verify`, `build`, e2e.
  AC: workflow file valid; runs green on push.

---

## M1 — Core foundations

- [ ] **M1.1 Seeded RNG**
  deps: M0.3
  `core/src/rng`: small PRNG (e.g. mulberry32 or sfc32) with explicit state object, plus helpers `int`, `float`, `pick`, `weightedPick`, `shuffle`, `fork(label)` for derived streams.
  AC: property test: same seed ⇒ same sequence; `fork` streams independent and deterministic; RNG state is serializable.

- [ ] **M1.2 Core types**
  deps: M0.1
  `MapGraph`, `Node`, `Edge` (discriminated by `kind`), `Exit`, `WorldState`, `CriminalState`, `HunterState`, `Report`, `HunterAction`, `CriminalAction`, `GameEvent`, `GameConfig`. Types only plus constructors.
  AC: typecheck passes; a test asserts a sample `WorldState` round-trips through JSON.

- [ ] **M1.3 Balance constants**
  deps: M1.2
  `core/src/balance.ts` with all numeric knobs referenced by DESIGN.md (AP per turn, trust thresholds, MIN_ESCAPE_TURNS, etc.), grouped and commented.
  AC: exported as a typed readonly object.

- [ ] **M1.4 Graph utilities**
  deps: M1.2
  Neighbors by travel mode, Dijkstra shortest path with edge costs, reachability, and min-cut (Edmonds–Karp on unit capacities) between a node and a set of nodes.
  AC: unit tests on hand-built graphs with known answers.

---

## M2 — Map generation

- [ ] **M2.1 Grid-based generator**
  deps: M1.1, M1.4
  Jittered grid of nodes, roads between neighbors with random removal, assign district types by region, one river splitting the map with 2–3 bridges, 3 exits on the edge, criminal start near center.
  AC: generates a `MapGraph` from a seed; same seed ⇒ identical map.

- [ ] **M2.2 Validator**
  deps: M2.1
  Implement every rule in DESIGN.md "Generation validity". Return a list of violations, not a boolean.
  AC: unit tests with hand-built invalid maps hit each rule.

- [ ] **M2.3 Generate-until-valid**
  deps: M2.2
  Wrapper that regenerates with derived seeds; cap attempts and throw with the last violations.
  AC: property test over 500 seeds: every returned map passes the validator.

- [ ] **M2.4 Map debug export**
  deps: M2.3
  Function to export a map as SVG string (for eyeballing in `sim`, no DOM required).
  AC: `sim` can write `map-<seed>.svg`.

---

## M3 — Turn loop (MVP rules)

- [ ] **M3.1 Game init**
  deps: M2.3, M1.3
  `createGame(config, seed) => WorldState`.
  AC: deterministic; initial meters within bounds.

- [ ] **M3.2 Hunter view**
  deps: M3.1
  `toHunterView(world) => HunterView`. Excludes criminal position, profile, and hidden report fields.
  AC: property test: for random worlds, the view never contains the criminal's node id in any criminal-related field; hidden `truth`/`accuracy` absent.

- [ ] **M3.3 Action framework + roadblock**
  deps: M3.1
  Data-driven action table (cost, target type, validate, apply). Implement `roadblock`. Validation errors are returned, not thrown.
  AC: can't exceed AP; roadblock blocks the edge for its duration; trust cost applied.

- [ ] **M3.4 Canvass, CCTV, true briefing**
  deps: M3.3
  CCTV queues a delayed, reliable report of the past; canvass produces reports based on witness density and trust; briefing raises report volume and criminal heat.
  AC: each action has tests for its effect, including CCTV delay.

- [ ] **M3.5 Criminal AI: amateur**
  deps: M3.1
  Utility-based chooser per DESIGN.md. Criminal only reasons over what it can know (visible roadblocks, briefings).
  AC: on an open map with no hunter actions, reaches an exit in ≤ path length + slack; never moves through a known roadblock; decisions deterministic per seed.

- [ ] **M3.6 Reports and pranks**
  deps: M3.4, M3.5
  Sightings generated from criminal movement through witnessed districts; prank calls from rate formula.
  AC: sighting accuracy correlates with trust in a statistical test over many seeds; prank rate rises with reward/media.

- [ ] **M3.7 Event system**
  deps: M3.6
  Data-driven events (trigger, weight, apply). Implement: eyewitness, prank call, civilian hurt, nightfall, rush hour.
  AC: each event unit-tested; events only fire when triggers hold.

- [ ] **M3.8 `step` and end conditions**
  deps: M3.3–M3.7
  `step(world, hunterActions) => { world, events }` running the five phases. Capture, escape, trust collapse, casualties, bankruptcy.
  AC: determinism property test (seed + action list ⇒ identical final state over 200 random games); meters always within bounds.

- [ ] **M3.9 Replay format**
  deps: M3.8
  `Replay = { version, seed, config, actions[] }`, encode to a compact URL-safe string, `replay(replay) => WorldState[]`.
  AC: replaying recorded games reproduces final state exactly.

---

## M4 — Headless simulation and balance

- [ ] **M4.1 Scripted hunter bots**
  deps: M3.8
  `random`, `greedy-roadblock` (block edges on the shortest path to nearest exit), `heatmap-chaser` (placeholder until M5.1).
  AC: bots only use `HunterView`.

- [ ] **M4.2 Sim CLI**
  deps: M4.1
  `bun run sim -- --games N --bot X --profile Y --seed S [--out dir]`. Outputs escape rate, capture rate, avg turns, loss reasons, and the worst/best seeds.
  AC: runs 1,000 games in reasonable time; JSON + human-readable output.

- [ ] **M4.3 Balance targets**
  deps: M4.2
  Add a test that runs a small batch and asserts rough targets (e.g. random bot wins 5–25%, greedy bot does not win > 70%). Tune `balance.ts`.
  AC: targets documented in `balance.ts` comments; test passes.

---

## M5 — Web UI (dispatch style)

- [ ] **M5.1 Belief heatmap (core)**
  deps: M3.8
  Compute probability over nodes from `HunterView` history per DESIGN.md.
  AC: mass sums to 1; negative evidence reduces mass on searched nodes; confirmed sighting concentrates mass.

- [ ] **M5.2 Game store**
  deps: M3.8
  Zustand store holding `WorldState` privately and exposing only `HunterView` + dispatch functions.
  AC: components cannot access `WorldState` via exported types.

- [ ] **M5.3 Map renderer (SVG)**
  deps: M5.2
  `MapRenderer` component: nodes, typed edges, exits, roadblocks, heatmap overlay, selection.
  AC: Playwright: clicking a node selects it.

- [ ] **M5.4 Report feed + meters**
  deps: M5.2
  Timestamped feed (observed vs received turn), meters for AP, budget, trust, pressure, clock.
  AC: renders from view; new reports highlighted.

- [ ] **M5.5 Action panel + end turn**
  deps: M5.3, M5.4
  Choose action, pick target on map, queue, end turn. Validation errors shown inline.
  AC: Playwright: start game → roadblock → end turn → turn counter advances.

- [ ] **M5.6 End screen + replay viewer**
  deps: M3.9, M5.5
  Score breakdown; replay scrubber showing true criminal path over the heatmap; shareable replay link.
  AC: Playwright: finish a seeded game and open replay.

- [ ] **M5.7 Visual pass**
  deps: M5.6
  Dispatch theme: dark palette tokens, monospace font, glow on roads, heat colors. Add `CREDITS.md`.
  AC: no layout overflow at 1280×800 and 1920×1080.

---

## M6 — Post-MVP content (unordered backlog)

- [ ] Remaining hunter actions (helicopter, drone, K9, transit shutdown, checkpoints, triangulation, financial monitoring, informant, forensics, fake briefing, reward, photo release, shelter-in-place, stakeout, federal help)
- [ ] Criminal profiles: professional, local, planner
- [ ] Criminal actions: safehouse, disguise, steal vehicle, false trail, diversion, bribe
- [ ] Events: weather, public event, media leak, political override, jurisdiction takeover, vigilantes, unit incident, lookalike, evidence found
- [ ] Timed exits
- [ ] Voronoi-based map generator (must pass the same validator)
- [ ] Hardcore mode (no heatmap)
- [ ] PixiJS renderer behind `MapRenderer`
- [ ] Sound (freesound.org, with credits)

---

## Inbox

Agents add discovered out-of-scope work here.
