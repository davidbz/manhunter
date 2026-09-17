# Manhunter — Plan

Each task is sized for one focused agent session. Do tasks in order unless `deps` says otherwise. Tick the box when done and add a short note if you made a decision later tasks rely on.

Legend: **deps** = tasks that must be done first. **AC** = acceptance criteria (all must be tested where testable).

---

## M0 — Project scaffold

- [x] **M0.1 Monorepo skeleton**
  deps: —
  Create Bun workspaces: `packages/core`, `packages/sim`, `apps/web`. Each app gets an empty composition root (`apps/web/src/main.tsx`, `packages/sim/src/main.ts`). Root `package.json` with scripts from AGENTS.md. `tsconfig.base.json` with strict flags; each workspace extends it.
  AC: `bun install` and `bun run typecheck` succeed on empty packages.
  Notes:
  - Workspaces are consumed as TypeScript source: `@manhunter/core` has no build step, its `exports` points straight at `src/index.ts`. Vite (M0.4) and Bun (`sim`) both compile it. Nothing downstream should add a `dist/` for `core`.
  - `tsconfig.base.json` goes beyond the AGENTS.md flags: `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `noUncheckedSideEffectImports`, `allowUnreachableCode: false`, `allowUnusedLabels: false`. Consequences: `import type` is mandatory; enums/namespaces/parameter properties are compile errors (which enforces the no-classes rule); index-signature reads need bracket access.
  - `isolatedDeclarations` is deliberately **not** set: it is inert under `noEmit` (verified - an exported arrow function with no return type raised nothing). Only worth revisiting if a workspace ever emits declarations.
  - `skipLibCheck: false` in the base config. `packages/sim` overrides it to `true` because `bun-types@1.4.2` does not type-check against `@types/node`; `core` and `web` pass with full lib checking. If M0.4's React types fail lib check under TS 7, prefer a scoped override in `web` over weakening the base.
  - Target and lib are **ES2023**, for `toSorted`/`toReversed`/`with`/`findLast` - the immutable-update methods that architecture rule 3 needs. Floor is Safari 16.4 / Chrome 110; set Vite's build target to match in M0.4.
  - `core`'s tsconfig sets `"types": []` and no DOM lib: purity rule 1 is enforced by the type layer before Biome sees it. `sim` gets `types: ["bun"]`, `web` gets the DOM libs.
  - There is no root `tsconfig.json`. `tsconfig.base.json` is the only shared config and each workspace extends it; editors resolve the nearest one. Project references were rejected because `composite` requires declaration emit, which conflicts with the source-consumption model above.
  - Root `typecheck` is `bun run --filter '*' typecheck` (per-workspace `tsc --noEmit`, no project references). Root `build` is scoped to `./apps/*` because `core` and `sim` have no build output; it fails until M0.4 adds Vite, as does `dev`/`test`/`lint` until their tasks land.
  - Deleted the Chrome-extension bootstrap leftovers: root `tsconfig.json` (`types: ["chrome"]`), and the empty `src/` and `dist/`. Added `CLAUDE.md` importing `AGENTS.md`.
  - Bun was not present in the devcontainer; installed to `~/.bun/bin`. See Inbox.

- [x] **M0.2 Biome**
  deps: M0.1
  Add `biome.json`: formatter + linter + import sorting. Restrict globals/imports in `packages/core` (`Math.random`, `Date`, `console`, `process`, `window`, `document`, any `node:` import).
  Also enable rules backing the engineering principles in AGENTS.md: `noUselessElse`, `useEarlyReturn`-style complexity limits (`noExcessiveCognitiveComplexity`), no classes in `core`, no default exports, and a nesting-depth cap. Add `limits.ts` stubs in `core`, `sim`, and `web`.
  AC: `bun run lint` passes; a deliberately added `Math.random()` in core and a needless `else` both fail lint (verify, then remove).
  Notes:
  - Biome `2.5.14`, pinned exactly (no caret) to match the existing devDependency convention and because formatter output can shift between minors. Import sorting is `assist.actions.source.organizeImports`, not a lint rule, in Biome 2.
  - `noRestrictedGlobals` only denies **bare** global names - `"Math.random"` as a denied global is silently ignored. Anything member-shaped needs a GritQL plugin. Two live in `tools/biome/`: `no-classes.grit` (repo-wide) and `core-purity.grit` (`Math.random`, core only).
  - Plugin `includes` globs are anchored differently from `overrides.includes`: `packages/core/**` matches nothing, `**/packages/core/**` works. `overrides.includes` uses the un-prefixed form. Do not copy one into the other.
  - `Date`, `process`, `window`, `document` and the rest are denied in core via `noRestrictedGlobals`; `node:` imports via `correctness/noNodejsModules`; `console` via `suspicious/noConsole`. `noRestrictedImports` also stops core importing `@manhunter/*`, React, Zustand or Vitest (architecture rule 5).
  - Architecture rule 4 is now lint-enforced too: `apps/web` importing `WorldState` or `CriminalState` from `@manhunter/core` is an error. Extend that `importNames` list when new hidden-state types land in M1.2. It is a name check, not a type check, so M3.2 still owes the property test.
  - `noMagicNumbers` is on repo-wide but **off** in `**/limits.ts`, `**/balance.ts` and `**/*.test.ts` - those files are the named-constant home, so the rule is inverted there. It ignores `0`, `1`, `2`, `-1` and object-literal property values by default, which matches AGENTS.md section 4.
  - There is no nesting-depth rule in Biome. `noExcessiveCognitiveComplexity` is set to `maxAllowedComplexity: 10` as the closest proxy. Raise it deliberately if Dijkstra or min-cut in M1.4 trips it; do not disable it per-file.
  - No `nursery` rules are enabled, deliberately: they change between minors and would break Dependabot bumps. `useExhaustiveSwitchCases` is the one worth wanting, and the `never` check in an exhaustive `switch` already gives it at compile time.
  - `limits.ts` stubs carry the constants the later tasks that own each boundary will need (`maxMapGenerationAttempts` for M2.3, `maxGamesPerRun`/`maxOutputFileBytes` for M4.2, `maxReplayStringLength` for M3.9). Values are placeholders; the owning task tunes them and adds the over-the-limit test.
  - The AC's "verify, then remove" was done manually - Vitest does not exist until M0.3, so nothing could be committed. All six violations fired (`Math.random`, `class`, `Date`, `console`, `node:fs`, needless `else`, plus `WorldState` in web and a default export). See Inbox: this should become a fixture-based test.
  - `bun run verify` still fails at its `test` step because Vitest is M0.3. `typecheck` and `lint` both pass with zero warnings.
  - CI ran only `typecheck` at the time; M0.3 added `lint` and `test` to it.

- [x] **M0.3 Vitest + fast-check**
  deps: M0.1
  Vitest workspace config covering all packages. Add `@fast-check/vitest`. One trivial test per workspace.
  AC: `bun run test` runs all workspaces; coverage report generated for `core`.
  Notes:
  - Vitest `5.0.1`, `@vitest/coverage-v8` `5.0.1`, `fast-check` `4.10.1`, `@fast-check/vitest` `0.5.0`, all pinned exactly at the root, matching the existing devDependency convention.
  - "Workspace config" is stale wording: `vitest.workspace.ts` was deprecated in 3.2 and removed in 4. The single root `vitest.config.ts` declares `test.projects` inline (`core`, `sim`, `web`), so there is one config file, not four. Project `include` is `src/**/*.test.{ts,tsx}` - tests are co-located, never in a separate tree.
  - `@vitest/coverage-v8` is a dependency beyond the AGENTS.md table. It is the only way to meet this task's coverage AC, and it is the provider Vitest itself ships; no alternative was added.
  - Coverage is `enabled: true` in the config, so plain `bun run test` satisfies the AC with no second script. Reporters are `text-summary` + `html`; the `text` reporter prints an empty table under `projects` in 5.0.1. Coverage `include`/`exclude` globs are resolved **root-relative** even though each project has its own root, so `packages/core/src/**/*.ts` scopes the report to `core` (verified: the report lists core's `index.ts` and `limits.ts` and neither of the other two `limits.ts`).
  - M0.2's core override denies importing `vitest`, which also hit co-located `*.test.ts` and blocked this task. `biome.json` now has a `packages/core/**/*.test.ts` override that repeats the pattern list **without** `vitest`. `@manhunter/*`, React and Zustand stay denied in core tests. Keep that list in sync if the core override's patterns change.
  - `packages/core` is now two tsc projects: `tsconfig.json` (`exclude: ["src/**/*.test.ts"]`, unchanged purity - no DOM, `types: []`, `skipLibCheck: false`) and `tsconfig.test.json` (extends it, adds `skipLibCheck: true`). Vitest's declarations transitively reach `EventTarget`, `AbortSignal`, `WebSocket` and `DOMHighResTimeStamp`, which core's lib deliberately lacks. Its `typecheck` script runs both. `sim` and `web` needed no change. Anything M0.4 does to `web` should follow this shape rather than relaxing the base.
  - New root `tsconfig.tools.json` type-checks root-level build configs, which no workspace `include` covers. It currently lists `vitest.config.ts`; **M0.4 must add `vite.config.ts` and M0.5 `playwright.config.ts`** or those files ship unchecked. Root `typecheck` now ends with `tsc --noEmit -p tsconfig.tools.json`. This is not a root `tsconfig.json` and does not revisit M0.1's rejection of project references.
  - All three projects use `environment: "node"`. No DOM test environment exists yet; M5's component tests will need `jsdom` or Vitest browser mode, which is a new dependency decision at that point. Playwright (M0.5) covers the DOM flows until then.
  - `fast-check` is a direct devDependency as well as a transitive one, so its major is pinned where AGENTS.md lists it. `fc` and `test.prop` are imported from `@fast-check/vitest`.
  - `bun run test` runs Vitest under Node. `bun test` is Bun's own runner and will execute these files with different semantics; always use the script.
  - `bun run verify` now passes all three steps for the first time.
  - **Architecture rules are now enforced by a test, not by hand** (added on request, closing the M0.2 Inbox item). `tools/biome/architecture-rules.test.ts` holds a data table of fixtures that each break exactly one rule, writes them into the workspace paths the `biome.json` overrides target, runs one `biome check --reporter=json`, asserts the expected diagnostic category and message, then deletes them. Covers architecture rules 1, 2 (static half), 4 and 5, plus no-classes, no-default-export, no-useless-else and no-magic-numbers.
  - Verified by mutation, not just by passing: setting `noUselessElse` to `off` and removing the GritQL plugins made exactly those two cases fail, and restoring the config made them pass again.
  - Two traps in that test. Fixtures **cannot** be listed in `.gitignore`: `vcs.useIgnoreFile` makes biome skip ignored files, so every assertion silently found nothing. And a clean fixture and a file biome never opened both yield zero diagnostics, so the test asserts `summary.changed + summary.unchanged` equals the fixture count to tell them apart. Cleanup is in `afterAll`; a crashed run leaves `__arch_*__.ts` files that `git status` and `bun run lint` will both shout about, which is the intended failure mode.
  - The JSON reporter prints an experimental-format warning on stderr. Biome is pinned exactly, so the shape is stable for now; a Biome bump that changes it will fail this test loudly rather than silently.
  - Fixture sources are inline strings in the data table rather than committed `.ts` files under `tools/biome/fixtures/` as the Inbox entry suggested. Committed fixtures would have to be excluded from `bun run lint` to keep it green, and anything excluded from lint is also invisible to this test.
  - A fourth Vitest project, `tools`, runs repo-level tests with `root: "."`. It is outside the three workspaces on purpose: the test spawns a process and writes files, which `core` may not do. `tsconfig.tools.json` now covers `tools/**/*.ts` with `types: ["bun"]`.
  - The spawn is bounded per AGENTS.md section 5 with a 60s timeout and an 8 MiB output cap, both named constants at the top of the file.
  - CI now runs `typecheck`, `lint` and `test`. Architecture rule 2 says a determinism test runs on every commit; until M1.1 and M3.8b exist, what runs on every commit is the proof that nondeterminism cannot enter `core`. **M1.1 owes the seeded-sequence property test and M3.8b owes the byte-identical-final-state test** to finish the rule.

- [x] **M0.4 Vite + React app shell**
  deps: M0.1
  `apps/web` renders a placeholder page that imports a constant from `core`.
  M0.3 pulled in `vite@8.3.0` transitively as a Vitest dependency. Install the matching major so the tree holds one Vite, not two. Add `vite.config.ts` to `tsconfig.tools.json`'s `include`, set the build target to ES2023 per M0.1's note, and follow `core`'s two-project tsconfig split if React's types fail lib check rather than relaxing the base.
  AC: `bun run dev` serves it; `bun run build` produces static output.
  Notes:
  - `vite 8.3.0`, `@vitejs/plugin-react 6.1.1`, `react`/`react-dom 19.3.0`, `@types/react`/`@types/react-dom 19.3.0`, all pinned exactly and declared in `apps/web`, not at the root - they are the web app's tools, and the root only holds what `verify` needs. `vite@8.3.0` is exactly the version Vitest 5.0.1 resolves, so the tree holds one copy (verified: a single `node_modules/.bun/vite@8.3.0+...`). **Bump Vite and Vitest together**, or the tree forks.
  - React's types pass under `skipLibCheck: false`; the fallback this task authorised (a two-project split in `web`, or a scoped override) was **not needed and not added**. The base config is still fully lib-checked everywhere except `sim` and `core`'s test project.
  - The constant is `GAME_TITLE` in `core/src/meta.ts`, re-exported from `core/src/index.ts`. **M0.5's e2e should assert this string.** `apps/web/index.html` repeats it as a literal in `<title>`: the HTML shell cannot import from `core`, so the two are duplicated on purpose. If the title changes, change both.
  - `vite.config.ts` sits at `apps/web/` root, outside that workspace's `include: ["src"]`, so it is type-checked by `tsconfig.tools.json` as M0.3 required. Its `BUILD_TARGET` is `es2023`, mirroring `tsconfig.base.json`; the two have no automatic link, so M0.1's ES2023 decision has to be changed in both places.
  - `core` is consumed as TypeScript source in both modes, confirming M0.1's no-`dist` decision: `vite build` transformed 17 modules into one bundle containing `Manhunter`, and the dev server serves `packages/core/src/meta.ts` over `/@fs` with no prebundling. Nothing needs `optimizeDeps` tuning.
  - `main.tsx` stays the composition root per AGENTS.md section 2: it finds the `#root` mount, throws if it is absent (`noNonNullAssertion` forbids the usual `!`), and renders `<App />` under `StrictMode`. `App.tsx` is presentation only. **M5.2's Zustand store is wired here**, not inside a component.
  - No CSS, no theme tokens, no `index.css`. M5.7 owns the visual pass; adding styling now would be scope creep it would only have to undo.
  - The dev server binds localhost only (`Network: use --host to expose`). **M0.5 should drive Playwright through a `webServer` entry in `playwright.config.ts`** rather than assuming a server is already up, and will need `--host` only if a browser outside the devcontainer ever connects.

- [x] **M0.5 Playwright**
  deps: M0.4
  One e2e test: page loads and shows the title.
  Keep Playwright specs out of `src/**/*.test.ts` so Vitest does not try to run them; add `playwright.config.ts` to `tsconfig.tools.json`'s `include`.
  AC: `bun run test:e2e` passes headless.
  Notes:
  - `@playwright/test 1.63.0`, pinned exactly at the root, matching the devDependency convention. Root, not `apps/web`, because AGENTS.md's `test:e2e` script runs bare `playwright test` from the repo root and the `webServer` command is the root `bun run dev`.
  - The two runners are separated by **location and extension**: Playwright owns `apps/web/e2e/**/*.spec.ts` (`testDir` + `testMatch`), Vitest owns `<workspace>/src/**/*.test.ts`. Neither can see the other's files; verified with `playwright test --list` (1 file) and `bun run test` (5 files, 18 tests, unchanged). **Keep new e2e specs as `*.spec.ts` under `e2e/`**; a `*.test.ts` there would be picked up by neither.
  - `playwright.config.ts` is root-level and in `tsconfig.tools.json`'s `include`, along with `apps/web/e2e/**/*.ts` - the web workspace's own `include` is `["src"]`, so the specs would otherwise ship unchecked. That config has `types: ["bun"]` and no DOM lib, which is fine as long as specs avoid `page.evaluate` with DOM globals.
  - Timeouts are named constants per AGENTS.md section 5: test 30s, expect 5s, web server 120s. Playwright's defaults are implicit; these are not.
  - The spec imports `GAME_TITLE` from `@manhunter/core` rather than repeating the literal, and asserts it against **both** the `<h1>` and `document.title`. That makes the deliberate duplication in `apps/web/index.html` (M0.4's note) a guarded one. Verified by mutation: changing only the `<title>` fails the test.
  - Chromium only. Adding Firefox and WebKit triples e2e time and browser download size for a game whose target is a desktop browser; add them in M5.7 if the visual pass needs cross-browser proof.
  - `reuseExistingServer` is on locally and off under CI. CI is detected with `"CI" in process.env`, not `process.env["CI"]`, because `noPropertyAccessFromIndexSignature` and Biome's `useLiteralKeys` want opposite things (Inbox item). `in` satisfies both. **Use that form in any new root-level config**, or the info count rises.
  - Browsers are **not** in the repo. `.devcontainer/devcontainer.json`'s `postCreateCommand` now appends `bunx playwright install --with-deps chromium`, closing that Inbox item, but like the Bun feature it is unverified without a rebuild - the current container had the browser installed by hand, and `install-deps` needed `sudo`. **M0.6 needs the equivalent step in CI** before its e2e job can pass.
  - `.gitignore` gained `test-results/`, `playwright-report/`, `blob-report/`.

- [x] **M0.6 CI**
  deps: M0.2, M0.3, M0.5
  GitHub Actions: install (cached), `verify`, `build`, e2e.
  AC: workflow file valid; runs green on push.
  Partially done in M0.1: `ci.yml` was converted from npm to Bun (`oven-sh/setup-bun`, `bun install --frozen-lockfile`, `~/.bun/install/cache` keyed on `bun.lock`). `dependabot.yml` moved to `package-ecosystem: "bun"` with grouped updates.
  Further done in M0.3: `lint` and `test` steps added, so the architecture-rule test gates every commit as architecture rule 2 requires. **M0.6 is now only `build` and e2e**, plus a Playwright browser-install step.
  Notes:
  - `ci.yml` now triggers on `push: branches: [main]` as well as `pull_request`. The AC says "runs green on push" and the workflow only had `pull_request`, so architecture rule 2's "every commit" was really "every PR". Post-merge pushes to `main` now run the same four jobs.
  - Four parallel jobs: `actionlint`, `verify`, `build`, `e2e`. Parallel rather than chained on `needs` so a lint failure still tells you whether e2e is broken, and so **each job is a separately nameable required status check** - the Inbox's branch-protection item needs those names.
  - The three Bun jobs share `.github/actions/setup`, a local composite action (install Bun, restore `~/.bun/install/cache`, `bun install --frozen-lockfile`). It takes `bun-version` as an **input**, not from workflow `env`: composite actions do not inherit the caller's `env` context in `with:` expressions. `BUN_VERSION` stays the single source of truth in `ci.yml`.
  - Playwright browsers are cached at `~/.cache/ms-playwright`, keyed on `hashFiles('bun.lock')` - that is where the `@playwright/test` version lives, and a browser build is only valid for the release that downloaded it. `install --with-deps chromium` still runs on a cache hit; it skips the download and only applies the apt system deps. This closes the M0.5 Inbox item's CI half.
  - `playwright-report/` is uploaded on failure only, with `retention-days: 7` (AGENTS.md section 5: the bound is declared, not left to the org default).
  - Third-party actions are pinned by SHA with a version comment; `actions/*` are pinned by major tag. That is M0.1's existing convention, kept. Current majors at time of writing: `checkout@v7`, `cache@v6`, `upload-artifact@v7`, `setup-bun@v2.2.0`.
  - Verified locally, not just by reading: `actionlint 1.7.12` exits 0 on the workflows, and **it does resolve the local composite action** - renaming the `bun-version` input made it report "input is not defined" at all three call sites. `bun run build`, `bun run verify` and `CI=1 bun run test:e2e` all pass. `CI=1` matters: it is the branch that turns on `forbidOnly`, retries, the `github` reporter and `reuseExistingServer: false`.
  - Still unproven until a real push: nothing here has run on GitHub's runners. The one step most likely to need a fix is `install --with-deps`, which wants `sudo` (present on `ubuntu-latest`, absent in the devcontainer).

---

## M1 — Core foundations

- [x] **M1.1 Seeded RNG**
  deps: M0.3
  `core/src/rng`: small PRNG (e.g. mulberry32 or sfc32) with explicit state object, plus helpers `int`, `float`, `pick`, `weightedPick`, `shuffle`, `fork(label)` for derived streams.
  AC: property test: same seed ⇒ same sequence; `fork` streams independent and deterministic; RNG state is serializable.
  M1.1 is also where the IoC convention from AGENTS.md section 2 gets fixed for `core`: the RNG ships as `createRng(deps)`-style logic over a plain serializable state object, and its shape is the template every later core module copies. Record the chosen shape in the task note; nothing else in the plan establishes it, and retrofitting it after M2 is expensive.
  Notes:
  - **No new dependencies.** sfc32 plus splitmix32 seeding is ~90 lines; nothing in the registry was needed, so the installed versions are unchanged from M0.6.
  - `core/src/rng.ts`, not a `rng/` directory. One concept, one file, per AGENTS.md "Code style"; split it only when a second generator appears.
  - **This is the template for every later `core` module.** Data is `RngState` (four plain 32-bit words). Logic is `Rng`, a frozen-by-`readonly` object of pure functions returned from `createRng()`. Every draw has the shape `(state, ...args) => { state, value }`, so no generator object anywhere holds a position in the stream. `createRng()` takes no `deps` because the RNG is the bottom of the graph; **every module above it takes `deps: { rng: Rng }`** and is wired at the composition root. Tests inject a fake `Rng` by hand - no `vi.mock`.
  - sfc32 over mulberry32: 128 bits of state gives `fork` room to derive streams that do not collide. Seeded through splitmix32 with 12 discarded warmup draws, so low-entropy seeds (0, 1) start decorrelated. `stateFromWord` is injective, so distinct 32-bit seeds always give distinct states.
  - `fork(state, label)` **derives, it does not advance.** `fork(s, "map")` and `fork(s, "criminal")` are two independent streams off the same position, and the parent `s` is untouched. That is what M2.3's regenerate-with-derived-seeds wants: `fork(root, \`attempt-${n}\`)`. Forking from two *different* parent positions with the same label also diverges, so per-turn streams are safe.
  - Fork labels are hashed with 32-bit FNV-1a, which can collide. Labels are code-authored constants, never user input, so no bound is declared on them; if a label ever comes from a replay string, M3.9's decode limit is the boundary that covers it. The "different labels differ" test uses a fixed realistic label list rather than `fc.string()` for this reason - a generated pair could collide and make it flaky.
  - `pick`/`weightedPick` take `NonEmptyArray<T> = readonly [T, ...T[]]`, so "nothing to choose from" is a compile error at the call site instead of an `undefined` every caller must handle. Callers that filter a list must narrow it first. `NonEmptyArray` and `Weighted<T>` live in `rng.ts` for now; **M1.2 may move them to the shared types module** if anything else needs them.
  - `weightedPick` clamps negative weights to 0 and falls back to a uniform draw when every weight is 0. Event tables (M3.7) should filter ineligible candidates rather than rely on that fallback; it exists to keep the function total, not as an API.
  - `shuffle` uses the **insertion** variant of Fisher-Yates over `toSpliced`, not in-place swaps. Exactly uniform, fully immutable, and it needs no indexed reads - which matters because `noUncheckedIndexedAccess` turns every swap into an `undefined` check that is wrong when `T` itself includes `undefined`. Quadratic in allocations; irrelevant at the sizes `core` shuffles.
  - `int(state, min, max)` on an empty or inverted range returns `min` and **consumes no state**. Callers must not rely on a fixed number of draws per call.
  - `rng.test.ts` pins the first six `uint32` outputs for seed 1 as a golden vector. A replay is a seed plus an action list, so changing the generator silently invalidates every replay ever shared; that test makes it fail loudly instead.
  - **Part of the architecture rule 2 debt M0.3 flagged is now paid:** the seeded-sequence property test exists. M3.8b still owes the byte-identical-final-state test.
  - Coverage for `core` is 98.7% statements / 70% branches. The gaps are the provably unreachable `??` fallbacks that `noUncheckedIndexedAccess` forces on tuple reads. Relevant to the Inbox item about adding coverage thresholds: set branch thresholds below 100 or those fallbacks will block them.
  - `bun run verify` passes. It still prints the two pre-existing `useLiteralKeys` infos on `tools/biome/architecture-rules.test.ts` (Inbox); unrelated to this task.

- [ ] **M1.2 Core types**
  deps: M0.1, M0.3
  `MapGraph`, `Node`, `Edge` (discriminated by `kind`), `Exit`, `WorldState`, `CriminalState`, `HunterState`, `Report`, `HunterAction`, `CriminalAction`, `GameEvent`, `GameConfig`. Types only plus constructors.
  Also declare the visibility split in full here, not later: `WorldState` (everything), `HunterView` (M3.2), and the post-game reveal type M3.9/M5.6 need. See "Open questions" - the reveal type has to exist before M3.9 designs around it.
  AC: typecheck passes; a test asserts a sample `WorldState` round-trips through JSON.

- [ ] **M1.3 Balance constants**
  deps: M1.2
  `core/src/balance.ts` with all numeric knobs referenced by DESIGN.md (AP per turn, trust thresholds, MIN_ESCAPE_TURNS, etc.), grouped and commented.
  Includes the score weights M3.10 needs, and whichever of political pressure and unit fatigue survive the "Open questions" decision.
  AC: exported as a typed readonly object.

- [ ] **M1.4a Paths and reachability**
  deps: M1.2, M0.3
  Neighbors by travel mode, Dijkstra shortest path with edge costs, reachability. Bounded by `LIMITS.maxSearchExpansions`.
  AC: unit tests on hand-built graphs with known answers; a search that would exceed the expansion cap returns an error result rather than looping.

- [ ] **M1.4b Min-cut**
  deps: M1.4a
  Min-cut (Edmonds–Karp on unit capacities) between a node and a set of nodes.
  Split out of M1.4: max-flow is a session on its own, and it is the one function likely to trip Biome's `noExcessiveCognitiveComplexity: 10`. Split the augmenting-path search from the flow loop rather than raising the ceiling.
  AC: unit tests on hand-built graphs with known cut values, including a graph whose min-cut is 1 and one whose min-cut is 3.

---

## M2 — Map generation

- [ ] **M2.1a Grid topology**
  deps: M1.1, M1.4a
  Jittered grid of nodes, road edges between neighbours, random edge removal that keeps the graph connected.
  Split out of M2.1: topology and content are independent, separately testable, and together they were 4-5 pieces in one session.
  AC: generates a connected `MapGraph` skeleton from a seed; same seed ⇒ identical graph.

- [ ] **M2.1b Map content**
  deps: M2.1a
  District types by region, one river splitting the map with 2–3 bridges, 3 exits on the edge, criminal start near centre.
  AC: every node has a `districtType`; the river is crossable only at its bridges; same seed ⇒ identical assignment.

- [ ] **M2.2 Validator**
  deps: M2.1b, M1.4b
  Implement every rule in DESIGN.md "Generation validity". Return a list of violations, not a boolean.
  Needs min-cut (M1.4b) for the "min-cut between start and exits ≥ 2" rule.
  AC: unit tests with hand-built invalid maps hit each rule.

- [ ] **M2.3 Generate-until-valid**
  deps: M2.2
  Wrapper that regenerates with derived seeds; cap attempts and throw with the last violations.
  AC: property test over 500 seeds: every returned map passes the validator.

- [ ] **M2.4 Map debug export**
  deps: M2.3
  Function to export a map as SVG string (for eyeballing in `sim`, no DOM required).
  The AC needs `sim` to write a file, and `sim` has no file-writing boundary until M4.2. M2.4 therefore owns that boundary: a bounded write helper honouring `LIMITS.maxOutputFileBytes`, with the over-the-limit test AGENTS.md section 5 requires. M4.2 reuses it rather than writing its own. The SVG builder itself stays in `core` and returns a string; only `sim` touches the filesystem.
  AC: `sim` can write `map-<seed>.svg`; an oversized SVG is rejected as an error result, not truncated.

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

- [ ] **M3.8a `step` and the five phases**
  deps: M3.3–M3.7
  `step(world, hunterActions) => { world, events }` running intel, events, planning, resolution, consequences.
  Split out of M3.8: the phase loop is the integration point for six prior tasks, and pairing it with five end conditions and a 200-game property test was a session and a half.
  AC: each phase has a test asserting what it does and does not touch; meters always within bounds.

- [ ] **M3.8b End conditions and determinism**
  deps: M3.8a
  Capture, escape, trust collapse, casualties, bankruptcy.
  AC: each end condition has a test that reaches it; determinism property test (seed + action list ⇒ identical final state over 200 random games).

- [ ] **M3.9 Replay format**
  deps: M3.8b, M3.10
  `Replay = { version, seed, config, actions[] }`, encode to a compact URL-safe string, replay to a sequence of frames.
  The original signature `replay(replay) => WorldState[]` cannot be used by M5.6: architecture rule 4 forbids `apps/web` from importing `WorldState`, and `biome.json` already blocks it by name. DESIGN.md still requires the replay viewer to reveal the criminal's true path. Resolve with a third type declared in M1.2 - a post-game reveal frame carrying the hunter view plus the criminal's true position for that turn, and nothing else. `WorldState[]` may exist inside `core` as an intermediate; it must not cross into `web`.
  Bounded by `LIMITS.maxReplayStringLength` at decode, before parsing or allocating, with an over-the-limit test.
  AC: replaying recorded games reproduces final state exactly; `web` can render a full replay without importing `WorldState`; a replay string one character over the limit is rejected.

- [ ] **M3.10 Scoring**
  deps: M3.8b, M1.3
  Score a finished game per DESIGN.md "End conditions": turns taken, budget spent, civilian harm, trust remaining, captured alive. Pure function from a finished world to a typed breakdown; weights live in `balance.ts`.
  Added in review: DESIGN.md specifies a score and M5.6 renders a "score breakdown", but nothing in the plan computed one.
  AC: unit tests pin the breakdown for two hand-built finished games; the breakdown is serializable and carries its components, not just a total.

---

## M4 — Headless simulation and balance

- [ ] **M4.1 Scripted hunter bots**
  deps: M3.8b, M3.2
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
  deps: M3.8b
  Compute probability over nodes from `HunterView` history per DESIGN.md.
  AC: mass sums to 1; negative evidence reduces mass on searched nodes; confirmed sighting concentrates mass.

- [ ] **M5.2 Game store**
  deps: M3.8b
  Zustand store holding `WorldState` privately and exposing only `HunterView` + dispatch functions.
  AC: components cannot access `WorldState` via exported types.

- [ ] **M5.3 Map renderer (SVG)**
  deps: M5.2, M5.1
  `MapRenderer` component: nodes, typed edges, exits, roadblocks, heatmap overlay, selection.
  M5.1 added to deps in review: the overlay has nothing to draw without the belief distribution.
  AC: Playwright: clicking a node selects it.

- [ ] **M5.4 Report feed + meters**
  deps: M5.2
  Timestamped feed (observed vs received turn), meters for AP, budget, trust, pressure, clock.
  The meter list here must match whatever the "Open questions" decision keeps in the MVP; pressure and fatigue currently have no task that produces them.
  AC: renders from view; new reports highlighted.

- [ ] **M5.5 Action panel + end turn**
  deps: M5.3, M5.4
  Choose action, pick target on map, queue, end turn. Validation errors shown inline.
  AC: Playwright: start game → roadblock → end turn → turn counter advances.

- [ ] **M5.6 End screen + replay viewer**
  deps: M3.9, M3.10, M5.5
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

## Open questions

Raised in the M0.3 review. Each one blocks a named task; decide before that task starts, not during it.

- **MVP meter set.** DESIGN.md lists political pressure and unit fatigue as hunter resources, and M5.4 renders a pressure meter, but no M3 task creates or advances either. Decide before M1.2 fixes `HunterState`: keep both in the MVP (each needs a rule in M3.8a's consequences phase), keep pressure only, or cut both and drop the meter from M5.4. Cutting is the smaller MVP; pressure is the one that earns its keep, because DESIGN.md's "political override" events depend on it.
- **Post-game reveal type.** M3.9's resolution is written into the task: a reveal frame declared in M1.2, never `WorldState` in `web`. Confirm the shape there rather than at M3.9, because M3.2's `HunterView` and this type are siblings and should be designed together.
- **Score model.** DESIGN.md names the score components but no weights or ranges. M1.3 has to invent them so M3.10 can use them. Fine to decide at M1.3; flagged so it is not discovered at M5.6.

---

## Inbox

Agents add discovered out-of-scope work here.

- The devcontainer now installs Bun via `ghcr.io/devcontainers-extra/features/bun:1`, but this has only been verified by tag resolution, not by an actual container rebuild. Confirm on the next rebuild; the Bun in the current container was curl-installed to `~/.bun/bin`.
- M0.5 added `bunx playwright install --with-deps chromium` to the devcontainer's `postCreateCommand`, but it has never run: the browser in the current container was installed by hand, and `install-deps` needed `sudo`. Confirm on the same rebuild that checks the Bun feature above. (CI's browser step landed in M0.6.)
- Dependabot auto-merge only actually waits for CI if branch protection on `main` marks the CI checks as required. Needs configuring in repo settings; not expressible in a file.
- `.gitignore` still carries Chrome-extension entries (`*.crx`, `key.pem`) from the bootstrap template.
- AGENTS.md's "Repository layout" block omits `tools/`, `.github/`, `.devcontainer/` and `LICENSE`, all of which exist. M0.2 added `tools/biome/*.grit`; M0.3 added `vitest.config.ts` and `tsconfig.tools.json`; M0.5 added `playwright.config.ts` and `apps/web/e2e/`. Worth reconciling the block with reality.
- AGENTS.md section 3 promises "maximum nesting depth of 2", but no Biome rule enforces it and `noExcessiveCognitiveComplexity` is not the same constraint. Either write a GritQL plugin for it or soften the wording.
- `tools/` in the working tree also contains an unrelated, untracked `fetch_agent_tools.sh` from local tooling. Decide whether it belongs in the repo before `tools/` is committed.
- AGENTS.md's command table should say that `bun test` (Bun's own runner) is not `bun run test` (Vitest). The two disagree on config, environment and assertion library, and the former silently half-runs the suite.
- Coverage is generated for `core` but has no thresholds, so it can rot silently. Consider `coverage.thresholds` once `core` has real modules (after M1.2), tuned to whatever M1 actually reaches rather than an aspirational number.
- All Vitest projects run in `environment: "node"`. M5's component tests need a DOM environment (`jsdom` or Vitest browser mode), which is a dependency decision not covered by the AGENTS.md stack table.
- `bun run lint` exits 0 but prints two `lint/complexity/useLiteralKeys` infos on `tools/biome/architecture-rules.test.ts`. Biome wants `counted.changed`; `noPropertyAccessFromIndexSignature` in `tsconfig.base.json` wants `counted["changed"]`. The two rules disagree on index-signature reads. Decide which one yields (narrow the value's type at the boundary so neither fires, or turn `useLiteralKeys` off for `**/*.test.ts`). Noticed during M0.4; pre-existing, not caused by it.
