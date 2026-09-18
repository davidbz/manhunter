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
  - CI now runs `typecheck`, `lint` and `test`. Architecture rule 2 says a determinism test runs on every commit; until M1.1 and M3.8c exist, what runs on every commit is the proof that nondeterminism cannot enter `core`. **M1.1 owes the seeded-sequence property test and M3.8c owes the byte-identical-final-state test** to finish the rule.

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
  - **Part of the architecture rule 2 debt M0.3 flagged is now paid:** the seeded-sequence property test exists. M3.8c still owes the byte-identical-final-state test.
  - Coverage for `core` is 98.7% statements / 70% branches. The gaps are the provably unreachable `??` fallbacks that `noUncheckedIndexedAccess` forces on tuple reads. Relevant to the Inbox item about adding coverage thresholds: set branch thresholds below 100 or those fallbacks will block them.
  - `bun run verify` passes. It still prints the two pre-existing `useLiteralKeys` infos on `tools/biome/architecture-rules.test.ts` (Inbox); unrelated to this task.

- [x] **M1.2 Core types**
  deps: M0.1, M0.3
  `MapGraph`, `Node`, `Edge` (discriminated by `kind`), `Exit`, `WorldState`, `CriminalState`, `HunterState`, `Report`, `HunterAction`, `CriminalAction`, `GameEvent`, `GameConfig`. Types only plus constructors.
  Also declare the visibility split in full here, not later: `WorldState` (everything), `HunterView` (M3.2), and the post-game reveal type M3.9/M5.6 need. See "Open questions" - the reveal type has to exist before M3.9 designs around it.
  AC: typecheck passes; a test asserts a sample `WorldState` round-trips through JSON.
  Notes:
  - **No new dependencies.** Types and pure constructors only; installed versions are unchanged from M1.1.
  - **The "MVP meter set" open question was decided as: keep political pressure, cut unit fatigue.** No MVP action deploys a unit (roadblock, canvass, CCTV, briefing), so fatigue would be a number nothing advances, while DESIGN.md's political override events read pressure. `HunterState` is `{ actionPoints, budget, trust, pressure, containments }`. Reversible in one file until M3.8a writes the consequences phase; M5.4's meter list should match.
  - Ten files, one concept each: `ids`, `time`, `map`, `report`, `criminal`, `hunter`, `events`, `config`, `world`, `view`. Each has a co-located test. `view.ts` holds only types for now; **M3.2's `toHunterView` lands in that same file**, which is what architecture rule 4 names.
  - **Naming convention fixed here, and later tasks depend on it: `create*` is an injectable logic factory** (the `createRng` template from M1.1, wired at a composition root), **`make*` is a pure data constructor** callable anywhere. `makeWorldState`, `makeReport` and friends take no deps and hold nothing, so the "only the composition root calls `create*`" rule stays true.
  - Ids are branded strings (`NodeId`, `EdgeId`, `ReportId`) with a type-only symbol, built through `makeNodeId` and friends. They are plain strings at runtime, so JSON round-trips them. The brand is what stops a node id being passed where an edge id is expected once M1.4a starts writing graph code.
  - `Node` and `Edge` from the task text are **`MapNode` and `MapEdge`** in code: `Node` is a DOM global in `apps/web`, and a type of that name would shadow it at every import.
  - `MapNode` carries `position: { x, y }`. Nothing in the plan asked for it, but M2.4's SVG export and M5.3a's renderer both need coordinates, and retrofitting them into the generator later is worse. `MapGraph` is `{ nodes, edges, exits, incidentNodeId }`, arrays not keyed records, because rule 3 bans `Map` from state and array order is the iteration order determinism needs. Neighbour indexes are M1.4a's to build at call time.
  - **The criminal's start node is `MapGraph.incidentNodeId`**, not a criminal field: it is the crime scene, both sides know it, and it is why a whole `MapGraph` can go into `HunterView`. M2.2's validity rules ("start not adjacent to an exit") refer to this field. **M3.2's AC needs rewording because of it**: a view *does* legitimately contain a node id the criminal once stood on.
  - Same trap from the other side: `GameEvent`'s `civilian_hurt` carries a node id on purpose (DESIGN.md: harm confirms a location). **M3.2's property test must assert the shape of `HunterView`, not scan it for node ids.** The shape assertions are already written in `view.test.ts` as compile-time checks (`HunterView` has no `criminal`, `config` or `rng` member; `HunterReport` has no `truth` or `accuracy`). Verified by mutation: adding a `criminal` member and dropping `truth` from the hidden list each fail `bun run typecheck`.
  - `GameOutcome` variants carry a turn and **never a node id**, including `escaped`. Where the criminal was is the reveal's job, not the outcome's, so the outcome can sit in `HunterView` unredacted.
  - `HunterView` has **no `config` member**, because `GameConfig` names the criminal profile, which DESIGN.md hides. The deadline reaches the UI as a derived `turnsRemaining`. **Open consequence for M3.1 and M5.2: `apps/web` cannot build a `GameConfig` without naming a profile.** Either `createGame` takes a profile-free request (difficulty in, profile chosen in `core`), or the UI knows. Decide at M3.1.
  - `RevealFrame` is `{ turn, view, criminalNodeId }` - the plan's "and nothing else", taken literally. If M3.9 finds that the replay cannot explain a decision without the criminal's chosen action, adding `criminalAction` is the one change to make, and it is still not `WorldState`.
  - `Report` keeps `truth` and `accuracy`, and the list of hidden field names is **data** (`HIDDEN_REPORT_FIELDS`), with `HunterReport = Omit<Report, HiddenReportField>` derived from it, so M3.2's redaction and the type it produces cannot drift. `makeReport` takes `observedAtTurn` + `deliveryDelayTurns` (how every producer thinks about lateness) and clamps accuracy into [0, 1].
  - `ReportContent` has two variants for now, `sighting` and `no_sighting`. Negative evidence is in from the start because M4.0's heatmap (M5.1 before the review renumbered it) prunes with it. Content is structured, never prose: `core` holds no user-facing strings.
  - `EdgeProperties` (cost per travel mode, blockable) is declared as a shape only. **M1.3 owns the table that fills it.** `ExitSchedule` already has its `timed` variant even though timed exits are M6, so adding one is an entry rather than a type change.
  - `casualties` lives on `WorldState`, not `HunterState`: it is a fact about the world that both the end conditions (M3.8c) and the score (M3.10) read.
  - `MapConfig` (`columns`, `rows`, `exitCount`) lives in `config.ts` beside `GameConfig`; **M2.1a may extend it** rather than inventing a second generator config.
  - `WorldState` carries the RNG position, so a serialized world resumes the same stream. Serializability is now a property test over generated worlds (`world.test.ts`), not just the sample the AC asked for.
  - `biome.json`'s web deny-list grew to `WorldState`, `CriminalState`, `CriminalKnowledge`, `Report`, closing M0.2's open item, and `tools/biome/architecture-rules.test.ts` gained a fixture for `Report` so the addition is tested, not just configured.
  - `bun run verify` passes. Lint still prints the two pre-existing `useLiteralKeys` infos on `tools/biome/architecture-rules.test.ts` (Inbox); unrelated to this task.

- [x] **M1.3 Balance constants**
  deps: M1.2
  `core/src/balance.ts` with all numeric knobs referenced by DESIGN.md (AP per turn, trust thresholds, MIN_ESCAPE_TURNS, etc.), grouped and commented.
  Includes the score weights M3.10 needs. The meter question is already settled: pressure is in, fatigue is out (M1.2's note, now also in DESIGN.md), so this file needs a pressure-per-turn knob and no fatigue knobs.
  AC: exported as a typed readonly object.
  Notes:
  - **No new dependencies.** One data file and its test.
  - `BALANCE` is `as const` with `export type Balance = typeof BALANCE`, following `limits.ts`. The record tables are annotated first (`Readonly<Record<DistrictType, ...>>`, `Readonly<Record<EdgeKind, EdgeProperties>>`, `Readonly<Record<GameOutcome["kind"], number>>`) so a new district type, edge kind or outcome is a compile error here rather than a missing entry at runtime.
  - **Logic takes `balance: Balance` as an argument and does not import `BALANCE`** (engineering principle 1: configuration is data). `BALANCE` is wired at the composition root beside the RNG. That is what lets M4.3 sweep several settings in one process without a module mock; keep it true from M3.3 onward, because the first module that imports `BALANCE` directly makes every later one want to.
  - **Travel cost is in turns.** `EdgeProperties.costByMode` fills the shape M1.2 declared: car on a road is 1, on foot 2, and `null` means the mode cannot use that edge. M1.4a's Dijkstra therefore returns a number that compares directly against `map.minEscapeTurns` and the clock, with no unit conversion anywhere.
  - **Footpaths are not blockable, and that is load-bearing.** A roadblock is a vehicle checkpoint; leaving one edge kind open on foot is what keeps DESIGN.md's "min-cut between start and exits >= 2" from being satisfiable by a single block. M2.1a/M2.1b should place enough footpaths that this stays true, and `balance.test.ts` pins the flag.
  - **The district table has an `exit` row that DESIGN.md's table does not.** `DistrictType` includes `exit`, so the record has to cover it; the values (watched, thinly populated, low hiding) are invented. Revisit at M2.1c if exits stop being ordinary nodes.
  - **Score model decided** (the last item in "Open questions"). Capture is worth 1200 before components; turns, budget spent and casualties subtract; trust remaining and a live capture add. The weights are chosen so the *worst* possible capture (full deadline, whole budget, casualties one short of the loss threshold, zero trust) still outscores the *best* possible loss (escape with full trust). `balance.test.ts` computes both from the constants and asserts it, so M4.3 cannot tune the game's values upside down by accident.
  - **`score.capturedAliveBonus` has no data behind it yet.** `GameOutcome`'s `captured` variant carries no aliveness flag, so M3.10 must either add one or drop the bonus. The weight is here because DESIGN.md lists "captured alive" as a component; it is the one knob in the file that is not yet readable from a finished world.
  - Only `criminal.profiles.amateur` exists. The three M6 profiles get siblings when they get behaviour; fabricating weights for unimplemented profiles would be balance nobody could tune.
  - `map.defaults` holds the `MapConfig` values, which is what `config.ts` said it would ("defaults are balance, not configuration"). M2.1a should read them rather than inventing a grid size.
  - Values are first guesses everywhere. M4.3 owns tuning; what M4.3 must not break are the relationships `balance.test.ts` asserts (a full turn of roadblocks stays affordable, pressure rises across a hunt without pinning, accuracy leaves room for doubt, capture beats loss).
  - Verified by mutation, not just by passing: raising `trustBonusPerPoint` to 20 and giving the park a non-zero night multiplier each failed exactly one test, and restoring them made both pass.
  - `bun run verify` passes; 102 tests. Lint still prints the two pre-existing `useLiteralKeys` infos on `tools/biome/architecture-rules.test.ts` (Inbox); unrelated to this task.

- [x] **M1.4a Paths and reachability**
  deps: M1.2, M0.3
  Neighbors by travel mode, Dijkstra shortest path with edge costs, reachability. Bounded by `LIMITS.maxSearchExpansions`.
  AC: unit tests on hand-built graphs with known answers; a search that would exceed the expansion cap returns an error result rather than looping.
  Notes:
  - **No new dependencies.** `core/src/graph.ts` plus its test.
  - Named `GraphLogic` / `createGraphLogic`, which is the name AGENTS.md's own IoC example uses (`createActionResolver(deps: { graph: GraphLogic })`). M1.4b's min-cut is a second file; it can take `GraphLogic` as a dep or stand beside it, but it should not be bolted onto this interface. (M1.4b took it as a dep, and added one member, `adjacency`, for the reason recorded there.)
  - **Edges are undirected.** `from`/`to` are how an edge was written down, not a direction of travel: a road between two districts is a road both ways. M2.1a can emit each edge once. If a one-way edge is ever needed it is a new `EdgeKind` plus a flag in `balance.edges`, not a change here.
  - **Path cost is in turns**, because `balance.edges.*.costByMode` is (M1.3). So M2.2 compares a path cost against `balance.map.minEscapeTurns` directly, with no unit conversion anywhere in the codebase.
  - **Everything takes a `Traversal`** (`{ graph, balance, mode, maxExpansions? }`) rather than positional parameters. That is the seam for **M3.3: add `blockedEdgeIds` to `Traversal`** and roadblocks become visible to every search at once - the criminal AI (M3.5) and the greedy bot (M4.1) included - without touching a single call site.
  - Results are flat discriminated unions, never `null` plus a comment: `path` / `unreachable` / `expansion_limit_exceeded` for a search, `reachable` / `expansion_limit_exceeded` for a sweep. "No route" and "gave up looking" are different answers and callers have to tell them apart.
  - `shortestPathToAny(traversal, from, targets)` is the same Dijkstra with a target set, stopping on the first target it settles. M2.2's "shortest start-to-nearest-exit" and M4.1's greedy bot both want it, and doing it as one search rather than one search per exit is why it is here rather than in M2.2.
  - **`LIMITS.maxSearchExpansions` was tuned from 100_000 down to 5_000**, which `limits.ts` says is this task's call. The frontier is scanned, not heaped: it costs no unreachable branches under `noUncheckedIndexedAccess`, and city maps are tens of nodes. At 5_000 the quadratic worst case is still well under a second, so the bound is a real time bound rather than a number that permits a hang. Revisit only if a map generator ever emits thousands of nodes.
  - The cap counts **settled** nodes and the over-the-limit test uses the real constant: a chain of `maxSearchExpansions` nodes returns a path, a chain one node longer returns `expansion_limit_exceeded`. `Traversal.maxExpansions` exists so the smaller unit tests can reach the cap without building a graph.
  - Path reconstruction walks the predecessor tree with `for (let step = previous.get(to); step !== undefined; ...)`, so the loop bound is the tree the bounded search built - no second counter, and no unreachable `break` to leave a hole in branch coverage.
  - Non-positive edge costs are filtered out alongside `null` ones. Dijkstra assumes non-negative weights and balance is injected data a sweep could get wrong, so the assumption is enforced where it is used, not asserted somewhere else.
  - Two property tests over generated graphs: a returned path is a real walk whose cost is the sum of its edges, and a path exists exactly when `reachable` contains the destination. Coverage for `core` is 99% statements / 92% branches.
  - Verified by mutation: dropping the reverse link made the undirected test fail, and disabling the cap check failed all three expansion tests. Restoring both made them pass.
  - `bun run verify` passes; 122 tests. Lint still prints the two pre-existing `useLiteralKeys` infos (Inbox); unrelated.

- [x] **M1.4b Min-cut**
  deps: M1.4a
  Min-cut (Edmonds–Karp on unit capacities) between a node and a set of nodes.
  Split out of M1.4: max-flow is a session on its own, and it is the one function likely to trip Biome's `noExcessiveCognitiveComplexity: 10`. Split the augmenting-path search from the flow loop rather than raising the ceiling.
  AC: unit tests on hand-built graphs with known cut values, including a graph whose min-cut is 1 and one whose min-cut is 3.
  Notes:
  - **No new dependencies.** `core/src/mincut.ts` plus its test. `createMinCutLogic(deps: { graph: GraphLogic })`: a second file that takes M1.4a as a dep, as M1.4a's note said it should, rather than growing `GraphLogic`.
  - **Capacity counts edges, not blockability.** A footpath is uncuttable by roadblock (`balance.edges.footpath.blockable` is `false`) but is still a way out of a district, and DESIGN.md's rule is about how many ways out exist. **M2.2 must therefore not read a cut of 2 as "two roadblocks would seal it"**; it is "two ways out". If a blockable-only cut is ever wanted it is a second question, not a change here.
  - **Cutting a set is cutting one merged sink.** The search stops at the first target it reaches and never routes flow through one, so `minCut(start, exits)` is the DESIGN.md rule directly. Cutting a node from itself is `not_separable`, a third result variant next to `cut` and the shared `expansion_limit_exceeded`; an empty target set cuts at no cost.
  - Split as the task asked: `findAugmentingPath` (breadth-first, which is the Edmonds–Karp part) is separate from the flow loop, and both sit well under the complexity ceiling with it left at 10.
  - The flow loop is bounded by the capacity leaving the source, which unit capacities make an exact bound on the number of augmentations - no arbitrary cap, no `while (true)`. Search itself is bounded by `LIMITS.maxSearchExpansions`, shared with M1.4a and spent across all the augmentations of one call, with the same over-the-limit test at the real constant (chain of `maxSearchExpansions + 1` nodes cuts, one node longer reports the cap).
  - **`GraphLogic` gained `adjacency(traversal)`**, every node's neighbours in one pass. Needed, not tidying: `neighbors` rebuilds the whole adjacency per lookup, so building the residual node by node would have cost O(nodes × edges) *before* any bounded search, which is exactly the hang the bound exists to prevent. M4.0's belief spread (M5.1 before the review renumbered it) wants the same map.
  - Tested against an independent oracle, not just against itself: a property test brute-forces the smallest cut by enumerating every division of small random graphs and compares. Plus symmetry (cutting a from b equals cutting b from a) and a Menger cross-check against M1.4a's `reachable` (a cut is needed exactly when a route exists).
  - Verified by mutation: not consuming forward capacity, running the flow loop once, neutralising the expansion cap, collapsing parallel edges and dropping the source-in-targets guard each fail tests. One mutant survives, deliberately: dropping the `+1` on the reverse arc. In the undirected two-arc model the opposite direction already carries the cancellation, and 300k random graphs (4-13 nodes) found no case where it changes the answer. The standard form is kept because it is the correct general one, not because a test forces it.
  - `bun run verify` passes; 144 tests, `mincut.ts` at 100% statements and 96% branches. Lint still prints the two pre-existing `useLiteralKeys` infos (Inbox); unrelated.

---

## M2 — Map generation

- [x] **M2.1a Grid topology**
  deps: M1.1, M1.3, M1.4a
  Jittered grid of nodes, road edges between neighbours, random edge removal that keeps the graph connected.
  Split out of M2.1: topology and content are independent, separately testable, and together they were 4-5 pieces in one session.
  M1.3 added to deps in review: the generator reads `balance.map.defaults` (M1.3's own note says so) and `Traversal` takes `balance` as a required member, so connectivity checking cannot compile without it.
  **Also places footpaths**, per the "footpath placement" decision below: a named fraction of the surviving road edges is emitted as `footpath` instead, so `balance.edges.footpath.blockable: false` stays load-bearing. The fraction is a new knob in `balance.map`, not a literal.
  Any other generator knob this task needs (jitter magnitude, edge-removal probability) is a named constant in `balance.map` too; adding them is in scope, not scope creep.
  AC: generates a connected `MapGraph` skeleton from a seed; same seed ⇒ identical graph; some edge of kind `footpath` exists and the count is within the configured range.
  Notes:
  - **No new dependencies.** `core/src/topology.ts` plus its test.
  - **The skeleton is its own type, `MapTopology`, not a half-filled `MapGraph`.** `MapNode` requires a `districtType` and `MapGraph` requires `exits` and an `incidentNodeId`, none of which exist until M2.1c; filling them with placeholders would put a lie in the data for two tasks. `TopologyNode` is `{ id, position }`, `MapTopology` is `{ nodes, edges }`. **M2.1b takes and returns a `MapTopology`; M2.1c is what turns one into a `MapGraph`.**
  - **`Traversal.graph` was widened from `MapGraph` to a new `TraversableGraph`** (`{ nodes: { id }[], edges }`) so generation can check connectivity with M1.4a's real searches instead of a second implementation. Three lines in `graph.ts`, no logic change, no test change; `MapGraph` satisfies it structurally and `mincut.ts` only passes `Traversal` through. This is the seam M2.1b and M2.2 should use too - do not write a bespoke flood fill.
  - **Connectivity is checked on foot**, matching the `minEscapeTurns` decision. It is also the whole truth *here* only because every kind this file emits (road, footpath) is foot-traversable. If a topology ever contains rail, foot connectivity stops implying structural connectivity and this needs a second check.
  - Edge ids are **kind-independent** (`e-<column>-<row>-h|v`) precisely because M2.1b converts roads to bridges in place and keeps the id. Node ids are `n-<column>-<row>`. Both are stable across runs and readable in M2.4's SVG.
  - **`edgeRemovalRate` is a rate of attempts, not of removals.** The pass shuffles, takes that many candidates, and drops each one only if the graph survives it; the surviving count is an outcome. A loop that ran until it hit a removal quota would not terminate on a grid that cannot spare one.
  - A connectivity sweep that hits `LIMITS.maxSearchExpansions` is read as "not connected", so the edge stays. Conservative on purpose: a denser graph can only be more connected.
  - **New bound: `LIMITS.maxMapNodes = 256`.** `MapConfig` is player-visible setup and therefore reaches `core` from a replay string, so grid size is untrusted input. Oversized is a `map_too_large` result, never a clamp, with tests at the limit and one node over. An undersized grid is *not* rejected - it costs nothing to build, and M2.2 is what rejects a map too small to hunt in. A degenerate config (0 columns) normalises to a single cell rather than an empty node list, which keeps M2.1c's "pick a start node" total.
  - **New `balance.map` knobs:** `nodeSpacing`, `positionJitter`, `edgeRemovalRate`, `footpathRate`. `BALANCE.map` is now an annotated `MapGenerationSettings` rather than an inferred literal, so the rates are plain `number`s - otherwise `as const` makes `edgeRemovalRate` the literal type `0.18` and neither a test nor M4.3's sweep can vary one knob. **Later tasks adding a balance group that anything overrides should annotate it the same way.**
  - **Measured on 300 seeds at the default 8x6** (throwaway script, not committed): 82 full-grid edges become 67.3 surviving, of which 13.3 are footpaths. Mean foot cost from the centre cell to the *nearest* border node is 4.03 (min 2, max 8), but **88.9% of individual border nodes are at least `minEscapeTurns` (6) away on foot**. By car the same distances are roughly halved and almost nothing clears 6, which is the measurement behind the travel-mode decision.
  - **Consequence for M2.1c:** placing three exits uniformly over border nodes passes M2.2's escape-distance rule about 70% of the time (0.889^3), so roughly a third of maps would be regenerated for that rule alone. `LIMITS.maxMapGenerationAttempts` (64) absorbs it, but M2.1c should bias exit placement toward border nodes far from the start and make it close to free.
  - Verified by mutation, not just by passing: removing the connectivity guard, skipping the footpath pass, dropping the node limit and zeroing the jitter each failed exactly the tests that name them, and restoring each made them pass.
  - `bun run verify` passes; 164 tests. Lint still prints the two pre-existing `useLiteralKeys` infos (Inbox); unrelated.

- [x] **M2.1b River and bridges**
  deps: M2.1a
  One river splitting the grid, with 2–3 bridge edges as the only crossings. Cuts the road edges the river passes through and replaces the survivors with `bridge` edges.
  Split out of M2.1b in review: this is topology, it is what creates the chokepoint M2.2's validator checks for, and it is the half that can fail to produce a connected graph. Assigning labels to nodes cannot.
  AC: the river is crossable only at its bridges (no road edge crosses it); the graph stays connected; the bridge count is within range; same seed ⇒ identical river.
  Notes:
  - `createRiverLogic({ rng, graph }).carve` in `river.ts`. Topology in, topology out: it only ever removes edges and changes the kind of survivors, so it composes between M2.1a and M2.1c without either knowing about it.
  - **Sides are decided from grid cells; the polyline is drawn on the midlines between cells.** Two representations of the same river, and they agree exactly as long as `positionJitter` stays under half a cell. That is now pinned in `balance.test.ts`, and it is what lets the test use plain segment intersection as an **independent oracle**: the generator never consults the polyline, so "every bridge crosses it and nothing else does" is a real check rather than a restatement. Mutating `MIDLINE_OFFSET` is caught for any value at or below `positionJitter` (0.3) and not above it, which is the tolerance the geometry actually has.
  - **The river is only presentation.** `MapTopology.river` is a `Position[]`; once generation ends, everything the river does to the rules already lives in which edges exist and which are `bridge`. No rule should ever read it (M2.4 and M5.3a draw it).
  - **`river_not_bridgeable` is a real outcome, not an error path.** M2.1a's pruning can leave a bank internally fragmented, and rejoining the pieces can take more bridges than `maxBridges`. M2.3 should treat it like a validator violation: regenerate from a derived seed, never relax the range.
  - **`MIN_BANK = 2` is the fix that made that rare, and it is a map-quality decision as much as a robustness one.** A one-cell bank is a strip hanging off the city wall, joined only along itself, so any road M2.1a removed from it splits it into pieces that each demand their own bridge. Measured over 2000 default-grid seeds, requiring two: refusals **12.2% → 3.5%**, and every remaining refusal wants 4–5 bridges against a max of 3. A river now needs 4 cells across to run at all.
  - **The refusal rate is a pinned budget, not a hope.** `river.test.ts` asserts under 10% refusals over a fixed 200-seed range (measured: 6). The property tests accept "a river, or a refusal whose stated reason genuinely disqualifies the course" — which is the honest contract, since the type says refusal is possible — and the budget test is what stops that pairing from going vacuous. **M2.3 should size its attempt cap knowing roughly 1 map in 30 needs a second try for the river alone.**
  - Bridge selection takes the essential crossings first (a Kruskal-style merge over the shuffled crossings, reusing `graph.reachable` rather than adding a union-find), then tops up at random to a count drawn in range. So the count can exceed the drawn number when reconnecting demands it, but never exceeds `maxBridges`, which `carve` has already refused.
  - Verified by mutation, not just by passing: 15 mutants, 14 caught. Inverting the crossing test, shifting the bank boundary, dropping the essential bridges, leaving bridges as roads, keeping every crossing, disabling either refusal, merging components incompletely, flattening the drift, shortening the polyline and lowering either floor all failed the tests that name them. The one survivor moves the polyline within the jitter tolerance, where it is still correct.
  - `bun run verify` passes; 188 tests. Lint still prints the two pre-existing `useLiteralKeys` infos (Inbox); unrelated.

- [ ] **M2.1c District types, exits, start**
  deps: M2.1b, M1.3, M1.4a
  District types by region, 3 exits on the edge of the map, criminal start near centre.
  Pure labelling over a finished topology: it adds no edges and removes none, which is what makes it separately testable. This is the task that turns a `MapTopology` into a `MapGraph` (M2.1a's note).
  M1.3 and M1.4a added to deps in review, for the same reason M1.3 was added to M2.1a: the district mix and `exitCount` are `balance.map` knobs, and M2.1a's note requires biasing exit placement toward border nodes **far from the start on foot**, which is `GraphLogic.shortestPathToAny` against `balance.map.minEscapeTurns`. Without that bias, uniform placement over border nodes passes M2.2's escape-distance rule only about 70% of the time.
  Each `Exit` also needs an `ExitKind` (`airport | port | border | highway`), which the original AC omitted and `makeExit` requires. Kinds are drawn from the seed; `ExitSchedule` stays `always` until M6's timed exits.
  AC: every node has a `districtType`; exits sit on the border and the start does not; every exit carries a kind; same seed ⇒ identical assignment.

- [ ] **M2.2 Validator**
  deps: M2.1c, M1.4b, M1.3
  Implement every rule in DESIGN.md "Generation validity". Return a list of violations, not a boolean.
  Needs min-cut (M1.4b) for the "min-cut between start and exits ≥ 2" rule, and M1.3 for `MIN_ESCAPE_TURNS`, which is the threshold the shortest-path rule compares against.
  Two rules were underspecified and are now decided below: the escape-distance rule is measured **on foot**, and "a chokepoint that matters" means **a `bridge` or `tunnel` edge whose removal strictly increases the shortest start-to-nearest-exit cost**. Implement those readings; do not reinterpret them mid-task. The edge-kind half is load-bearing - without it the rule passes almost every map - and it makes a riverless city a violation rather than a valid map, which is the answer to the small-grid question that used to sit in the Inbox.
  AC: unit tests with hand-built invalid maps hit each rule, including a bridgeless map failing the chokepoint rule.

- [ ] **M2.3 Generate-until-valid**
  deps: M2.2
  Wrapper that regenerates with derived seeds; cap attempts and throw with the last violations.
  A config that can never produce a valid map must **fail with the last violations named**, not loop quietly to the cap: a grid under 4 cells across can never carry a river (M2.1b's `MIN_BANK`), so it can never satisfy M2.2's chokepoint rule, and the error has to say so.
  AC: property test over seeds: every returned map passes the validator; an impossible config (a 3-column grid) reports the chokepoint violation rather than a bare "gave up". Put the run count in a named constant rather than `fc`'s default, and state what the full run costs in wall-clock in the task note. Generate-until-valid runs the validator, which runs min-cut, so this is the first test in the repo that can plausibly be slow; if it exceeds a few seconds, lower the count deliberately and say so instead of leaving it in the default suite.

- [ ] **M2.4 Map debug export**
  deps: M2.3
  Function to export a map as SVG string (for eyeballing in `sim`, no DOM required).
  The AC needs `sim` to write a file, and `sim` has no file-writing boundary until M4.2. M2.4 therefore owns that boundary: a bounded write helper honouring `LIMITS.maxOutputFileBytes`, with the over-the-limit test AGENTS.md section 5 requires. M4.2 reuses it rather than writing its own.
  The SVG builder itself lives in **`packages/sim`**, not `core`. `core` is pure simulation and holds no presentation strings (M1.2's note); an SVG is presentation, it has no simulation consumer, and `web` does not reuse it because M5.3 draws its own React SVG. `sim` may import every map type it needs, so nothing is lost by moving it one workspace out.
  AC: `sim` can write `map-<seed>.svg`; an oversized SVG is rejected as an error result, not truncated.

---

## M3 — Turn loop (MVP rules)

- [ ] **M3.1 Game init**
  deps: M2.3, M1.3
  `createGame(setup, seed) => SealedWorld`.
  **Resolves M1.2's open consequence.** `GameConfig` names the criminal profile, which DESIGN.md hides from the player, so `apps/web` cannot construct one. Split the type: `GameSetup` is the player-visible half (map size, deadline, difficulty) and is what `web`, `sim` and the replay string pass in; `GameConfig` stays the complete resolved form and lives inside `WorldState`. `createGame` derives the criminal profile from `setup` plus a forked RNG stream, so the same seed always yields the same profile and the replay never stores it - which is also why a shared link cannot spoil the hunt it replays.
  **The start hour is derived the same way and is not in `GameSetup`** (see "Decisions"): DESIGN.md says a hunt starts at a random time of day, so it is a draw off the seed, not a player choice. `GameConfig.startHour` is the resolved form and stays.
  **Seals the world, per architecture rule 4.** Declare `SealedWorld` in `core`: a branded alias of `WorldState` with no readable members, plus internal `seal`/`unseal` that `core` alone calls. `core` exports its game functions over `SealedWorld` (`toHunterView`, `step`, reveal frames), so M5.2 has a legal way to hold a game between turns. `WorldState` stays exported for `sim`, which is a balance tool with no hidden-information concern; `web` is held to the sealed form by the existing `biome.json` deny list.
  Add `GameConfig` to that deny list and a fixture to `tools/biome/architecture-rules.test.ts`, exactly as M1.2 did for `Report`.
  AC: deterministic; initial meters within bounds; the same seed picks the same profile **and the same start hour**; a type-level test asserts `SealedWorld` exposes no members.

- [ ] **M3.2 Hunter view**
  deps: M3.1
  `toHunterView(world) => HunterView`. Excludes criminal position, profile, and hidden report fields.
  **Also redacts the event feed, which the first draft of this task missed.** `GameEvent`'s `eyewitness` and `prank_call` variants both carry a `reportId`, so an unredacted feed names which report is a prank and undoes the whole point of hiding `truth` (see "Decisions"). Declare `HunterEvent` in `view.ts`, collapsing those two into one `report_arrived { turn, reportId }`, derive it from a **data** list of hidden variants the way `HunterReport` is derived from `HIDDEN_REPORT_FIELDS`, and change `HunterView.events` to `readonly HunterEvent[]`.
  AC: the shape assertions in `view.test.ts` (no `criminal`, `config` or `rng` member) stay compile-time checks, plus a property test over generated worlds asserting that every report in the view has no `truth`/`accuracy`, that no report with `receivedAtTurn` after `clock.turn` appears at all, and that no event in the view distinguishes a prank from a sighting. Verify the last one by mutation: putting `prank_call` back into the view must fail it.
  **Do not write "the view contains no node id the criminal has stood on"**, which is the original wording and is false by design: `MapGraph.incidentNodeId` is the crime scene and `civilian_hurt` carries a location, both of which the hunter is meant to see (M1.2's notes). The test asserts the shape, never scans for ids.

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
  AC: over a hard-coded list of seeds, mean sighting accuracy at high trust exceeds mean accuracy at low trust by a named margin, and prank rate rises with reward the same way. The seed list, the sample size and the margin are all named constants: a generated seed set would make this the one test in the repo that can fail differently on two runs of the same commit, and a failure has to name the seed that broke it so M3.6 can pin it as a regression.

- [ ] **M3.7 Event system**
  deps: M3.6
  Data-driven events (trigger, weight, apply). Implement: eyewitness, prank call, civilian hurt, nightfall, rush hour.
  **Split before starting** (see Inbox): the table plus trigger and weight machinery with two events is one session, the remaining three is another.
  New events may carry hidden information in `GameEvent` but must declare it to M3.2's projection: an event whose presence reveals a report's `truth`, or the criminal's position beyond what DESIGN.md confirms, belongs on the hidden-variant list, not in `HunterView`.
  AC: each event unit-tested; events only fire when triggers hold; every `GameEvent` variant is either in `HunterEvent` or on the hidden list, asserted exhaustively so a new variant cannot default into the view.

- [ ] **M3.8a `step` skeleton: intel, events, consequences**
  deps: M3.4, M3.6, M3.7
  `step(world, hunterActions) => { world, events }` with the three phases that touch only the world: intel (queued reports land), events (the M3.7 table fires), consequences (meters, clock). Planning and resolution are stubs that pass the world through, and the criminal does not move yet.
  Split again in review: M3.8a was still the integration point for six prior tasks, and the three world-only phases are testable without the criminal AI existing.
  Consequences is what advances **political pressure**, which no task previously produced: it rises by a per-turn constant from `balance.ts` and jumps on `civilian_hurt`, clamped to [0, 100]. Nothing reads it as a trigger in the MVP - DESIGN.md's override events are M6 - and it is deliberately not a score component, because it tracks the clock and M3.10 already scores turns taken. It exists so M5.4 can show the case getting hotter.
  AC: each of the three phases has a test asserting what it does and does not touch; meters always within bounds, pressure included; a turn with no actions and no events is a clock tick and nothing else.

- [ ] **M3.8b Planning and simultaneous resolution**
  deps: M3.8a, M3.3, M3.5
  Fill in the two stubbed phases: planning spends AP on the queued hunter actions, resolution asks the criminal AI for its move and resolves both sides at once. Every interaction rule lives here - roadblock hit, slip past, capture on the same node - and this is the only phase where the order of the two sides could bias the outcome, so the tests are about simultaneity, not just effects.
  **Split before starting** (see Inbox): AP spend and queue validation is one session, simultaneous resolution plus every interaction rule is another. This task has the shape M3.8 was already split for once.
  **Owns `GameOutcome.captured.alive`**, decided in review: `balance.score.capturedAliveBonus` exists because DESIGN.md lists the component, but nothing produced the flag, and M3.10 sits downstream of M3.8c so it could not add it. Capture resolution sets it here.
  AC: a hunter action and a criminal move that target the same edge resolve the same way regardless of evaluation order; a criminal moving into a roadblocked edge is stopped; capture is detected when both sides occupy one node and carries whether it was alive.

- [ ] **M3.8c End conditions and determinism**
  deps: M3.8b
  Capture, escape, trust collapse, casualties, bankruptcy.
  Renumbered in review from M3.8b when the phase loop was split in two. References elsewhere in this file were updated; a stale "M3.8b owes the determinism test" in an older note means this task.
  AC: each end condition has a test that reaches it; determinism property test (seed + action list ⇒ identical final state over 200 random games).

- [ ] **M3.9 Replay format**
  deps: M3.8c
  M3.10 was listed as a dep in the first draft and is not one: the replay format does not score anything. Only M5.6a needs both. Dropped so the two can run in parallel.
  `Replay = { version, seed, setup, actions[] }`, encode to a compact URL-safe string, replay to a sequence of frames. `setup`, not `config`: M3.1 split them so the criminal profile is derived from the seed rather than stored, which keeps the profile out of a shared link (DESIGN.md "After-action replay").
  The original signature `replay(replay) => WorldState[]` cannot be used by M5.6b: architecture rule 4 forbids `apps/web` from importing `WorldState`, and `biome.json` already blocks it by name. DESIGN.md still requires the replay viewer to reveal the criminal's true path. Resolve with a third type declared in M1.2 - a post-game reveal frame carrying the hunter view plus the criminal's true position for that turn, and nothing else. `WorldState[]` may exist inside `core` as an intermediate; it must not cross into `web`.
  Bounded by `LIMITS.maxReplayStringLength` at decode, before parsing or allocating, with an over-the-limit test.
  AC: replaying recorded games reproduces final state exactly; `web` can render a full replay without importing `WorldState`; a replay string one character over the limit is rejected.

- [ ] **M3.10 Scoring**
  deps: M3.8c, M1.3
  Score a finished game per DESIGN.md "End conditions": turns taken, budget spent, civilian harm, trust remaining, captured alive. Pure function from a finished world to a typed breakdown; weights live in `balance.ts`.
  Added in review: DESIGN.md specifies a score and M5.6a renders a "score breakdown", but nothing in the plan computed one.
  `capturedAliveBonus` reads `GameOutcome.captured.alive`, which **M3.8b** now produces. Do not re-litigate the knob; it has data behind it.
  AC: unit tests pin the breakdown for two hand-built finished games; the breakdown is serializable and carries its components, not just a total.

---

## M4 — Headless simulation and balance

- [ ] **M4.0 Belief heatmap (core)**
  deps: M3.8c, M3.2
  Compute probability over nodes from `HunterView` history per DESIGN.md.
  M3.2 added to deps in review: the input is a sequence of hunter views, and `toHunterView` is what produces one.
  Renumbered from M5.1 in review and **moved ahead of M4.1**. It is a pure `core` module with no UI dependency, and it was the reason M4.1's `heatmap-chaser` was "a placeholder until M5.1" - which would have had M4.3 tune `balance.ts` against a bot that then changed. M5.3b consumes it; it does not live in M5.
  `GraphLogic.adjacency` is the seam to spread mass over (M1.4b's note).
  AC: mass sums to 1 within a named tolerance; negative evidence reduces mass on searched nodes; confirmed sighting concentrates mass.

- [ ] **M4.1 Scripted hunter bots**
  deps: M3.8c, M3.2, M4.0
  `random`, `greedy-roadblock` (block edges on the shortest path to nearest exit), `heatmap-chaser` (over M4.0's real distribution, not a placeholder).
  AC: bots only use `HunterView`.

- [ ] **M4.2 Sim CLI**
  deps: M4.1
  `bun run sim -- --games N --bot X --profile Y --seed S [--out dir]`. Outputs escape rate, capture rate, avg turns, loss reasons, and the worst/best seeds.
  **Split before starting** (see Inbox): the batch runner and its aggregation is one session, the CLI surface is another. The CLI half owns a real I/O boundary - AGENTS.md section 5 makes argv bounded input, so `--games` is checked against `LIMITS.maxGamesPerRun` before anything is allocated, with the over-the-limit test - and it reuses M2.4's bounded write helper rather than writing its own.
  AC: runs 1,000 games in reasonable time; JSON + human-readable output; `--games` one over the limit is an error result, not a clamp.

- [ ] **M4.3 Balance targets**
  deps: M4.2
  Add a test that runs a small batch and asserts rough targets (e.g. random bot wins 5–25%, greedy bot does not win > 70%). Tune `balance.ts`.
  Same rule as M3.6: a hard-coded seed list and a named batch size, never a generated one. A balance target that drifts between runs of the same commit is not a target.
  AC: targets documented in `balance.ts` comments; test passes; the batch size and seed list are named constants.

---

## M5 — Web UI (dispatch style)

Playwright covers **M5.5's turn flow and M5.6a's finish, and nothing else** ("Decisions"): AGENTS.md limits e2e to critical flows, so every other assertion here runs under the jsdom environment M5.2 installs.

- [ ] **M5.2 Game store**
  deps: M3.8c, M3.1
  Zustand store holding the sealed world privately and exposing only `HunterView` + dispatch functions.
  **The original wording, "holding `WorldState` privately", cannot be implemented**: architecture rule 4 forbids `apps/web` from importing `WorldState` and `biome.json` already blocks it by name, so the task as first written would not lint. The store holds `SealedWorld` from M3.1 - opaque data it can keep and hand back to `core`, never read - alongside the action log M5.6b's share link needs. Dispatch calls `core`'s `step`; the store holds data and calls logic, it does not become logic (engineering principle 1).
  Wire it in `apps/web/src/main.tsx`, the composition root (M0.4's note), not inside a component.
  This task also owns the **DOM test environment**, which the Inbox flagged and nothing had claimed: switch the `web` Vitest project to `environment: "jsdom"` and add `jsdom`, the one new dependency. Assert through `react-dom/client` and DOM queries. Do not add a component-testing library unless a test genuinely needs user-event semantics, and justify it in the note if you do; Playwright still owns the end-to-end flows.
  AC: components cannot access `WorldState` via exported types; a type-level test asserts `SealedWorld` exposes no members; store tests run under jsdom.

- [ ] **M5.3a Map renderer (SVG)**
  deps: M5.2
  `MapRenderer` component: nodes, typed edges, exits, roadblocks, selection. Everything the map is made of, drawn from `HunterView`, with no overlay.
  Split out of M5.3 in review: the base map and the belief overlay have different inputs, different dependencies and different failure modes, and together they were the largest UI task in the plan. The `MapRenderer` seam AGENTS.md names (PixiJS may replace it later) is defined here.
  AC: under jsdom, clicking a node selects it, and node count and edge count match the view. Not Playwright ("Decisions"): this is a rendering assertion, not a critical flow.

- [ ] **M5.3b Heatmap overlay**
  deps: M5.3a, M4.0
  The belief distribution drawn over the base map, behind the nodes and edges.
  M4.0 is the dep that matters: the overlay has nothing to draw without the distribution. Do not snapshot-test the SVG (AGENTS.md "Testing expectations"); assert on the mapping from probability to the rendered attribute instead, under jsdom.
  AC: a node with zero belief renders no heat; the highest-belief node renders the strongest; the overlay does not intercept clicks meant for nodes.

- [ ] **M5.4 Report feed + meters**
  deps: M5.2
  Timestamped feed (observed vs received turn), meters for AP, budget, trust, pressure, clock.
  The meter list is settled: AP, budget, trust, pressure, clock - the `HunterState` set M1.2 fixed. No fatigue meter; DESIGN.md now lists fatigue as out of scope for the MVP. Pressure is produced by M3.8a's consequences phase and is display-only here.
  AC: renders from view; new reports highlighted.

- [ ] **M5.5 Action panel + end turn**
  deps: M5.3b, M5.4
  Choose action, pick target on map, queue, end turn. Validation errors shown inline.
  **Split before starting** (see Inbox): the action panel and target selection is one session, queueing and ending the turn is another.
  AC: Playwright: start game → roadblock → end turn → turn counter advances. This is one of the two flows Playwright keeps.

- [ ] **M5.6a End screen**
  deps: M3.10, M5.5
  The screen a finished hunt lands on: outcome and the M3.10 score breakdown, component by component rather than one number.
  Split out of M5.6 in review: the end screen needs scoring, the replay viewer needs the replay format and the overlay, and the share link is the only part of the three that crosses an I/O boundary.
  AC: Playwright: finish a seeded game and see the breakdown - the second of the two flows Playwright keeps. That every score component the breakdown carries is rendered, so adding one to `balance.ts` cannot silently go missing, is asserted under jsdom, where it is exhaustive and cheap.

- [ ] **M5.6b Replay viewer and share link**
  deps: M5.6a, M3.9, M5.3b
  Replay scrubber showing the criminal's true path over the heatmap, from `RevealFrame`s; shareable replay link that round-trips through the URL.
  This task owns the **URL boundary** in `web`, and `apps/web/src/limits.ts` already holds its bound: reject anything longer than `LIMITS.maxReplayStringLength` before decoding, not after. M3.9 bounds the same string on the `core` side; both need the over-the-limit test, because they are two different boundaries (a hostile URL versus a malformed replay).
  The scrubber renders `RevealFrame`s and never `WorldState` (architecture rule 4). `M5.3b`'s overlay is the dep that makes "true path over the heatmap" mean anything.
  **Split before starting** (see Inbox): the scrubber is one session, the share link and its URL boundary is another.
  AC: under jsdom, scrubbing to a turn shows the criminal's position for it; a URL one character over the limit is rejected with an error, not truncated or parsed. Not Playwright - the two e2e flows are M5.5's turn and M5.6a's finish.

- [ ] **M5.7 Visual pass**
  deps: M5.6b
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

## Decisions and open questions

Each entry blocks a named task. Decide before that task starts, not during it. Resolved entries stay here with their resolution, because the tasks downstream were written before the answer existed.

**Resolved**

- **MVP meter set.** Pressure in, fatigue out. `HunterState` is `{ actionPoints, budget, trust, pressure, containments }` (M1.2). M3.8a's consequences phase is what raises pressure; it is display-only in the MVP and is not a score component, because it tracks the clock and M3.10 already scores turns taken. DESIGN.md now lists fatigue under "Out of scope for MVP".
- **Post-game reveal type.** `RevealFrame = { turn, view, criminalNodeId }`, declared in M1.2 beside `HunterView`. M3.9 uses it; `WorldState` may exist inside `core` as an intermediate and never crosses into `web`.
- **How the UI holds a game between turns.** M5.2 said "a store holding `WorldState` privately", which architecture rule 4 forbids and `biome.json` blocks by name. Resolution: `SealedWorld`, an opaque branded alias of `WorldState` with no readable members, declared in M3.1. The store keeps data and hands it back to `core`; it never reads it and never becomes logic. Sealing is a type-level guarantee, not encryption - the bytes survive `JSON.stringify` because replays need them to - and that limit is written into AGENTS.md rule 4.
- **Config versus setup.** `GameConfig` names the criminal profile, which DESIGN.md hides, so `web` could not build one. M3.1 splits `GameSetup` (player-visible, goes in the replay string) from the resolved `GameConfig` (stays in `WorldState`), and derives the profile from the seed. A shared replay link therefore does not spoil the hunt it replays.

- **`GameEvent` leaks which report is a prank, and `HunterView` needs an event projection.** `events.ts` gives `eyewitness` and `prank_call` a `reportId`, and `HunterView.events` is the unredacted `GameEvent[]`. A `prank_call` event therefore names exactly which report is a prank - the one thing `HIDDEN_REPORT_FIELDS` and `HunterReport` exist to hide. Neither `view.test.ts`'s shape checks nor M3.2's stated AC ("every report in the view has no `truth`/`accuracy`") would catch it, so it would have shipped. Resolution: declare `HunterEvent` in `view.ts` beside `HunterReport`, collapsing both variants into one `report_arrived { turn, reportId }`; `HunterView.events` becomes `readonly HunterEvent[]`. The feed still learns that a report landed, which is what M5.4 needs, and stops learning what kind it was. DESIGN.md's "Reports" section now states the rule. The hidden-variant list is **data**, the way `HIDDEN_REPORT_FIELDS` is, so the projection and its type cannot drift. Blocks M3.2; M3.7 must not add an event that names a report's nature.

- **Where the start hour comes from.** Derived from the seed, and **not** a member of `GameSetup`. DESIGN.md says a hunt "starts at a random time of day"; M3.1's first draft listed start hour in the player-visible setup, which would make it a player choice and put it in every replay string. Deriving it costs nothing, keeps the string shorter, and leaves one fewer field for `web`, `sim` and the replay codec to agree on. `GameConfig.startHour` stays - that is the resolved form. Blocks M3.1.

- **Whether a capture was alive.** `GameOutcome`'s `captured` variant gains `alive: boolean`, set by **M3.8b**'s capture resolution. `balance.ts` carries `score.capturedAliveBonus` because DESIGN.md lists the component, but nothing produced the flag, and M3.10 (which reads it) depends on M3.8c - so the type change would have had to land upstream of the task that discovered it was needed. Decided here instead. M3.10 renders the bonus; it does not invent the data.

- **How much of M5 is Playwright's.** AGENTS.md is explicit: "`web` gets Playwright tests only for critical flows (start game, take a turn, reach an end screen)." Five M5 ACs contradicted it by naming Playwright for node selection, score-component rendering, overlay hit-testing and replay scrubbing. Resolution: **Playwright owns exactly M5.5's turn flow and M5.6a's finish**; M5.3a, M5.3b, M5.4 and M5.6b's scrubber assert under the jsdom environment M5.2 installs. The ACs below are reworded. This is also the cheaper split - a jsdom assertion on the mapping from probability to a rendered attribute is a unit test, and AGENTS.md separately forbids snapshot-testing the SVG.

- **Which travel mode `minEscapeTurns` is measured in.** **Foot.** DESIGN.md's rule ("shortest start-to-nearest-exit path >= `MIN_ESCAPE_TURNS`") never named a mode, and `Traversal` requires one (M1.4a). The choice decides whether M2 works at all: `balance.edges.road.costByMode` is `car: 1`, `foot: 2`, and a centre start on the default 8x6 grid is at most 7 grid steps from any border cell, so by car the nearest of three border exits is 3-5 turns, below the threshold of 6, and *every* generated map would fail M2.2 until M2.3 exhausted `LIMITS.maxMapGenerationAttempts` and threw. On foot the same map is 6-10 and passes. Foot is also the criminal's guaranteed mode in the MVP - stealing a vehicle is M6 - so it is the honest floor on how long escape takes. Blocks M2.2.
- **What "a chokepoint that matters" means.** A `bridge` or `tunnel` edge whose removal strictly increases the shortest start-to-nearest-exit cost. DESIGN.md's "at least one chokepoint (bridge or tunnel) exists that matters" admitted at least three readings (a bridge merely existing, an edge on every shortest path, a cut edge); "removal raises the cost" is cheap to compute with M1.4a's `shortestPathToAny` and is the property the design actually cares about - a chokepoint the criminal can route around costs nothing to hold.
  **The edge-kind restriction is part of the rule, not decoration.** An earlier draft of this entry dropped it, which makes the rule near-vacuous: almost every map has *some* edge on a unique shortest path, so the validator would pass everything. Restricting it to bridges and tunnels is what ties the rule to the chokepoint M2.1b builds. DESIGN.md has been reworded to state both halves.
  **Consequence, which also settles the riverless-map question below.** No generator emits `tunnel`, and M2.1b can refuse a course (`river_not_bridgeable`), so a riverless city satisfies no reading of this rule and is **invalid - regenerate, never accept**. M2.1b measured refusals at 3.5% of courses, so this costs roughly one extra attempt per 30 maps against `LIMITS.maxMapGenerationAttempts` of 64. The one case it does not absorb is a grid under 4 cells across, which `MIN_BANK = 2` means can *never* carry a river: such a config exhausts the cap every time, and **M2.3 must fail with the violation named** rather than looping quietly. `BALANCE.map.defaults` is 8x6, so no MVP map is affected. Blocks M2.2.
- **Footpath placement.** M2.1a emits a named fraction of surviving road edges as `footpath` instead. M1.3's note calls footpath non-blockability load-bearing ("leaving one edge kind open on foot is what stops a single well-placed block from ending the hunt"), but no task in M2 created one: M2.1a made roads, M2.1b converted some to bridges, M2.1c added no edges, so every MVP map would have been fully blockable. The fraction is a `balance.map` knob. Blocks M2.1a.

- **Score model.** Decided at M1.3, as planned. Capture scores a base of 1200; turns taken, budget spent and casualties subtract; trust remaining and a live capture add. The invariant M3.10 and M4.3 must preserve is that the worst possible capture outscores the best possible loss, which `balance.test.ts` asserts from the constants themselves.

**Open**

- None. Everything raised in review has a decision above; new questions go here with the task they block.

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
- **Four tasks are marked "split before starting" rather than split now** (pre-M2 review, confirmed in the pre-M2.1c review): **M3.8b** (AP spend, then simultaneous resolution), **M3.7** (event machinery, then the remaining events), **M4.2** (batch runner, then the CLI surface), **M5.5** and **M5.6b** (two checkboxes each). Deliberately deferred: M3.8 was split twice because the first split happened before its dependencies existed, and each of these is four or more milestones out. The flag is in each task body, so whoever picks one up cannot miss it.
- **M2.4's AC** ("`sim` can write `map-<seed>.svg`") implies argv parsing, but M4.2 owns the CLI and AGENTS.md section 5 makes CLI arguments a bounded boundary - narrow M2.4 to the SVG builder plus the bounded write helper, tested directly, and let M4.2 wire the flag. Still open; decide when M2.4 starts.
- ~~The definition of done says `bun run verify` passes "with zero warnings", but it has printed two `useLiteralKeys` infos on every run since M0.4, so every task technically fails its own DoD.~~ **Resolved** in the pre-M2.1c review, together with the item below: `useLiteralKeys` is now `off` for `**/*.test.ts` in `biome.json`. The DoD stands as written and `bun run lint` prints nothing.
- `LIMITS.maxMapGenerationAttempts` is still the untuned 64 from M0.2. M2.3 is the task that can measure the real rejection rate; it should tune it rather than inherit the placeholder.
- `noExcessiveCognitiveComplexity` (max 10) will likely trip on M2.1b's river cut and M2.2's multi-rule validator. The M1.4b precedent is to split the function, not raise the ceiling and not disable per file.
- ~~`bun run lint` exits 0 but prints two `lint/complexity/useLiteralKeys` infos on `tools/biome/architecture-rules.test.ts`. Biome wants `counted.changed`; `noPropertyAccessFromIndexSignature` in `tsconfig.base.json` wants `counted["changed"]`.~~ **Resolved:** `useLiteralKeys` is off for `**/*.test.ts`. The tsc rule is type-aware and load-bearing, Biome's is style, so style yielded, scoped to the files where the two can disagree.
- ~~M2.1b's `MIN_BANK = 2` means a grid under 4 cells across gets no river at all, and M2.2 needs to agree on whether a riverless city is valid or a regeneration.~~ **Resolved** in the pre-M2.1c review, by the chokepoint decision above: a riverless city has no bridge and no tunnel, so it fails the chokepoint rule and is regenerated. A grid under 4 cells across therefore has no valid map at all, and M2.3 must fail naming the violation rather than looping to its cap.
