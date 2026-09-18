# AGENTS.md — Manhunter

Manhunter is a turn-based, single-player web game. The player runs a manhunt against a hidden, AI-controlled criminal on a procedurally generated city. Read `docs/DESIGN.md` for what the game is and `docs/PLAN.md` for the work breakdown.

## How to work in this repo

1. You will usually be given one task ID from `docs/PLAN.md` (e.g. `M2.3`). Do that task only. If it is too big or blocked, stop and say so instead of expanding scope.
2. Before writing code, read the task's acceptance criteria and any files it names.
3. When the task is done, tick its checkbox in `docs/PLAN.md` and add a one-line note under it if you made a decision the next task needs to know.
4. If you discover work that is out of scope, add it to the **Inbox** section at the bottom of `docs/PLAN.md`. Do not do it.
5. If the design doc and the plan disagree, stop and ask.

## Tech stack

Use the latest stable versions at the time you install. Do not pin to versions from memory; check the registry.

| Concern | Tool |
|---|---|
| Runtime, package manager, workspaces, scripts | Bun |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` |
| Web build / dev server | Vite |
| UI shell | React (function components + hooks only) |
| UI state | Zustand (UI state only; game state lives in `core`) |
| Map rendering | SVG via React for now; PixiJS may replace it later behind `MapRenderer` |
| Lint + format | Biome (no ESLint, no Prettier) |
| Unit / integration tests | Vitest |
| DOM environment for component tests | jsdom (`apps/web` project only) |
| Property-based tests | fast-check (via `@fast-check/vitest`) |
| End-to-end tests | Playwright |
| CI | GitHub Actions |

Do not add dependencies beyond this list without stating why in the task note. Prefer writing 30 lines over adding a package.

Two version couplings are not optional:

- **Vite and Vitest are bumped together.** Vitest depends on Vite; installing a different major puts two copies of Vite in the tree and the web build and the test runner stop agreeing. Check that `node_modules/.bun` holds exactly one `vite@` after any bump.
- **Biome is pinned exactly**, no caret. Formatter output and the JSON reporter shape both move between minors, and `tools/biome/architecture-rules.test.ts` parses that reporter.

## Repository layout

```
manhunter/
├── AGENTS.md
├── CLAUDE.md               # imports AGENTS.md
├── biome.json
├── package.json            # Bun workspaces root
├── tsconfig.base.json
├── docs/
│   ├── DESIGN.md
│   └── PLAN.md
├── packages/
│   ├── core/               # pure simulation: types, rng, map, ai, events, turn loop
│   └── sim/                # headless CLI: run games, batch balance reports
└── apps/
    └── web/                # Vite + React UI
```

## Architecture rules (hard constraints)

These are the rules most likely to be broken by accident. Tests enforce some of them.

1. **`packages/core` is pure.** No DOM, no Node APIs, no `Date.now()`, no `Math.random()`, no `console`, no I/O, no React. It must run identically in the browser, Node, and Bun. Biome's `noRestrictedGlobals` / `noRestrictedImports` enforce this.
2. **Determinism.** All randomness goes through the seeded RNG in `core/src/rng`. Same seed + same action list ⇒ byte-identical final state. A determinism test runs on every commit.
3. **State is immutable data.** `step(state, actions) => { state, events }`. Game state is plain serializable objects (no classes, no Maps/Sets in state, no functions). `JSON.parse(JSON.stringify(state))` must round-trip.
4. **Hidden information is enforced by types.** The criminal's true position lives in `WorldState`. The UI only ever receives `HunterView`, produced by `core/src/view.ts`. `apps/web` must never import `WorldState`. A test checks that `HunterView` contains no criminal position fields.
   The UI still has to hold a game between turns. It holds it as `SealedWorld`: an opaque alias of `WorldState` with no readable members, which `web` can store and hand back to `core` but cannot look inside. Sealing is a type-level guarantee, not an encryption; the bytes are still there for `JSON.stringify` to find, and that is accepted, because the same bytes have to survive serialization for replays to work.
5. **Dependency direction:** `web → core`, `sim → core`. `core` imports nothing from the workspace.
6. **Data-driven content.** Actions, events, and criminal profiles are defined as typed data tables plus small handler functions, so adding one is a new entry, not a new branch in the turn loop.
7. **Numbers live in one place.** Balance constants go in `core/src/balance.ts`, I/O limits in `limits.ts`. No magic numbers in logic.

## Engineering principles

These apply to every workspace. They are enforced in review and, where possible, by Biome and tests.

### 1. Data-oriented programming: data and logic are fully separate

- **Data** is plain, immutable, serializable types: `type`/`interface` declarations and object literals. Data has no methods, no behavior, and no references to logic.
- **Logic** is stateless. It receives data, returns new data, and holds no data of its own.
- A logic unit may only depend on other logic units. The test: if a logic module's members (closure variables, factory parameters, fields) are anything other than other logic, it is holding state and must be split into data plus logic.
- Configuration and balance values are data too. Logic receives them as arguments; it does not capture them.

```ts
// Data
type Roadblock = { readonly kind: "roadblock"; readonly edgeId: EdgeId; readonly expiresAt: Turn };

// Logic: depends only on other logic
type ActionResolver = { resolve: (world: WorldState, action: HunterAction) => ActionResult };

const createActionResolver = (deps: { graph: GraphLogic; trust: TrustLogic }): ActionResolver => ({
  resolve: (world, action) => /* uses deps.graph, deps.trust, and the data passed in */,
});
```

### 2. Inversion of control

- Logic never constructs or imports its collaborators directly. It receives them through factory parameters (`createX(deps)`).
- Each app has a single **composition root** where the object graph is wired: `apps/web/src/main.tsx`, `packages/sim/src/main.ts`. Nothing else calls `create*` for production wiring.
- Capabilities with side effects or nondeterminism (RNG source, clock, file output, storage, logging) are interfaces defined by the consumer and injected. `core` defines the interfaces it needs; it never implements I/O.
- Tests wire the same factories with fakes. No module mocking (`vi.mock`) of production code; if a test needs it, the design needs injection.
- No DI container library. Plain functions and objects.

### 3. Control flow

- **Early return.** Handle invalid, empty, and terminal cases first and return. The main path is the least indented code in the function.
- **Avoid `else`.** After an early return, `else` is unnecessary. Prefer guard clauses, lookup tables, and exhaustive `switch` on a `kind` discriminant. `else` is allowed only when both branches are genuinely symmetric and short; ternaries for simple value selection are fine. Biome's `noUselessElse` is on as an error.
- Maximum nesting depth of 2 inside a function body.

### 4. No magic numbers or strings

- Every numeric or string literal that carries meaning is a named constant. Balance knobs go in `core/src/balance.ts`; limits go in `limits.ts` of the owning workspace; other constants are named at module top.
- Allowed inline literals: `0`, `1`, `-1` in obvious arithmetic or indexing, and literals in tests.

### 5. Bound every I/O up front

Every operation that crosses a boundary declares its limits before it runs, never after. Boundaries include file reads and writes, URL/replay string decoding, browser storage, clipboard, user input, CLI arguments, and any future network call.

- **Size:** maximum bytes accepted or produced (e.g. max replay string length, max output file size).
- **Count:** maximum items (e.g. max games per sim run, max reports kept in the feed, max actions in a replay).
- **Time:** maximum duration for anything that can hang or loop on external input.
- Validate and reject at the boundary, before parsing or allocating. Oversized input is an error result, not a truncation.
- Limits are named constants in `limits.ts`, and each boundary has a test that feeds it input just over the limit.
- Internal simulation loops that depend on generated data (map regeneration attempts, pathfinding, AI candidate enumeration) are also bounded by named caps.

### 6. Comments and text

- No comments that restate the code. Names should make the *what* obvious; comments are only for *why*: a non-obvious constraint, a trade-off, a reference to DESIGN.md.
- No commented-out code, no `TODO` without a matching Inbox entry in `docs/PLAN.md`.
- No emojis anywhere: code, comments, commit messages, docs, logs, or UI strings.

## Code style

- Biome is the source of truth for formatting and lint. Run it; don't argue with it.
- Named exports only. No default exports (except where a tool requires it, e.g. Vite config).
- Discriminated unions with a `kind` field for actions, events, reports, and edges. Use exhaustive `switch` with a `never` check.
- No `any`. `unknown` + narrowing at boundaries.
- No classes. Data is types; logic is factory functions returning objects of functions (see Engineering principles).
- Small files; one concept per file. Co-locate tests: `foo.ts` + `foo.test.ts`.

## Testing expectations

- Every `core` module has unit tests.
- Invariants get property tests (fast-check): map validity, RNG determinism, state serializability, view hiding, meter bounds.
- Bugs get a regression test with the failing seed hard-coded.
- `sim` has a smoke test that runs a small batch and asserts it completes.
- `web` gets Playwright tests only for critical flows (start game, take a turn, reach an end screen). Do not snapshot-test SVG.

## Commands

```bash
bun install
bun run dev          # Vite dev server for apps/web
bun run build        # build all workspaces
bun run typecheck    # tsc --noEmit across workspaces
bun run lint         # biome check .
bun run format       # biome check --write .
bun run test         # vitest run (all workspaces)
bun run test:e2e     # playwright
bun run sim -- --games 1000 --profile amateur --seed 1
bun run verify       # typecheck + lint + test (run before finishing any task)
```

## Definition of done (every task)

- [ ] `bun run verify` passes with zero warnings.
- [ ] Acceptance criteria in `docs/PLAN.md` are met and tested.
- [ ] No architecture rule above is violated.
- [ ] Engineering principles followed: data/logic separation, injected dependencies, early returns, no needless `else`, no magic numbers.
- [ ] Every new I/O boundary has named limits and an over-the-limit test.
- [ ] No redundant comments, no emojis.
- [ ] Task checkbox ticked, with a short note if a decision was made.

## Things not to do

- Do not add a backend, accounts, analytics, or network calls.
- Do not add art assets without a matching entry in `CREDITS.md` (source + license).
- Do not "improve" unrelated code while doing a task.
- Do not weaken a test to make it pass. If a test is wrong, say why and fix it deliberately.
