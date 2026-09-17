import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * AGENTS.md's architecture rules are enforced by biome.json and the GritQL plugins beside this
 * file. Nothing proved those rules still fire: M0.2 checked them by hand and deleted the
 * evidence. This runs `biome check` over fixtures that each break exactly one rule and asserts
 * the expected diagnostic comes back, so a config edit that silently stops enforcing a rule
 * fails the build.
 *
 * Rule 2's other half - same seed produces a byte-identical final state - cannot be tested
 * until the RNG (M1.1) and `step` (M3.8b) exist. What is testable today is that no source of
 * nondeterminism can enter `core` in the first place.
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BIOME_BIN = "node_modules/.bin/biome";
const BIOME_TIMEOUT_MS = 60_000;
const MAX_BIOME_OUTPUT_BYTES = 8 * 1024 * 1024;

const CORE_DIR = "packages/core/src";
const SIM_DIR = "packages/sim/src";
const WEB_DIR = "apps/web/src";

type Fixture = {
  readonly id: string;
  readonly rule: string;
  readonly dir: string;
  readonly source: string;
};

type ExpectedDiagnostic = {
  readonly category: string;
  readonly messageIncludes: string;
};

type Violation = Fixture & { readonly expected: ExpectedDiagnostic };

const VIOLATIONS: readonly Violation[] = [
  {
    id: "core_math_random",
    rule: "rule 2 (determinism): Math.random in core",
    dir: CORE_DIR,
    source: "export const roll = (): number => Math.random();\n",
    expected: { category: "plugin", messageIncludes: "seeded RNG" },
  },
  {
    id: "core_date",
    rule: "rule 2 (determinism): wall clock in core",
    dir: CORE_DIR,
    source: "export const now = (): number => Date.now();\n",
    expected: { category: "lint/style/noRestrictedGlobals", messageIncludes: "Date" },
  },
  {
    id: "core_crypto",
    rule: "rule 2 (determinism): crypto entropy in core",
    dir: CORE_DIR,
    source: "export const bytes = (b: Uint8Array): Uint8Array => crypto.getRandomValues(b);\n",
    expected: { category: "lint/style/noRestrictedGlobals", messageIncludes: "crypto" },
  },
  {
    id: "core_console",
    rule: "rule 1 (purity): console in core",
    dir: CORE_DIR,
    source: 'export const log = (): void => {\n  console.log("x");\n};\n',
    expected: { category: "lint/suspicious/noConsole", messageIncludes: "console" },
  },
  {
    id: "core_node_builtin",
    rule: "rule 1 (purity): node builtin in core",
    dir: CORE_DIR,
    source:
      'import { readFileSync } from "node:fs";\n\nexport const read = (p: string): string =>\n  readFileSync(p, "utf8");\n',
    expected: { category: "lint/correctness/noNodejsModules", messageIncludes: "Node.js" },
  },
  {
    id: "core_ui_import",
    rule: "rule 5 (dependency direction): core importing a UI package",
    dir: CORE_DIR,
    source: 'import { useState } from "react";\n\nexport const hook = (): unknown => useState;\n',
    expected: {
      category: "lint/style/noRestrictedImports",
      messageIncludes: "imports nothing from the workspace",
    },
  },
  {
    id: "web_world_state",
    rule: "rule 4 (hidden information): web importing WorldState",
    dir: WEB_DIR,
    source:
      'import type { WorldState } from "@manhunter/core";\n\nexport const echo = (w: WorldState): WorldState => w;\n',
    expected: {
      category: "lint/style/noRestrictedImports",
      messageIncludes: "only ever receives HunterView",
    },
  },
  {
    id: "sim_class",
    rule: "no classes (AGENTS.md code style), outside core too",
    dir: SIM_DIR,
    source: "export class Tracker {\n  count = 0;\n}\n",
    expected: { category: "plugin", messageIncludes: "No classes" },
  },
  {
    id: "sim_useless_else",
    rule: "no needless else (engineering principle 3)",
    dir: SIM_DIR,
    source:
      'export const label = (n: number): string => {\n  if (n > 0) {\n    return "up";\n  } else {\n    return "down";\n  }\n};\n',
    expected: { category: "lint/style/noUselessElse", messageIncludes: "else clause" },
  },
  {
    id: "sim_default_export",
    rule: "named exports only (AGENTS.md code style)",
    dir: SIM_DIR,
    source: "const identity = (n: number): number => n;\n\nexport default identity;\n",
    expected: { category: "lint/style/noDefaultExport", messageIncludes: "default export" },
  },
  {
    id: "core_magic_number",
    rule: "no magic numbers (engineering principle 4)",
    dir: CORE_DIR,
    source: "export const cost = (ap: number): number => ap * 37;\n",
    expected: { category: "lint/style/noMagicNumbers", messageIncludes: "Magic number" },
  },
];

const CLEAN_FIXTURE: Fixture = {
  id: "core_clean",
  rule: "a compliant core module",
  dir: CORE_DIR,
  source: 'export const label = (): string => "clean";\n',
};

const ALL_FIXTURES: readonly Fixture[] = [...VIOLATIONS, CLEAN_FIXTURE];

const fixturePath = (fixture: Fixture): string => `${fixture.dir}/__arch_${fixture.id}__.ts`;

type Diagnostic = { readonly path: string; readonly category: string; readonly message: string };

const toDiagnostic = (raw: unknown): Diagnostic[] => {
  if (typeof raw !== "object" || raw === null) return [];
  const { category, message, location } = raw as {
    category?: unknown;
    message?: unknown;
    location?: unknown;
  };
  if (typeof category !== "string" || typeof message !== "string") return [];
  if (typeof location !== "object" || location === null) return [];
  const { path } = location as { path?: unknown };
  if (typeof path !== "string") return [];
  return [{ path, category, message }];
};

/**
 * A clean fixture and a fixture biome never opened both produce zero diagnostics, so the
 * processed-file count from the summary is what tells the two apart.
 */
type BiomeRun = {
  readonly processedFileCount: number;
  readonly diagnostics: readonly Diagnostic[];
};

const parseRun = (stdout: string): BiomeRun => {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null)
    return { processedFileCount: 0, diagnostics: [] };
  const { diagnostics, summary } = parsed as { diagnostics?: unknown; summary?: unknown };
  const counted =
    typeof summary === "object" && summary !== null ? (summary as Record<string, unknown>) : {};
  const changed = counted["changed"];
  const unchanged = counted["unchanged"];
  return {
    processedFileCount:
      (typeof changed === "number" ? changed : 0) + (typeof unchanged === "number" ? unchanged : 0),
    diagnostics: Array.isArray(diagnostics) ? diagnostics.flatMap(toDiagnostic) : [],
  };
};

const runBiome = (paths: readonly string[]): BiomeRun => {
  const result = spawnSync(BIOME_BIN, ["check", "--reporter=json", ...paths], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: BIOME_TIMEOUT_MS,
    maxBuffer: MAX_BIOME_OUTPUT_BYTES,
  });
  if (result.error) throw result.error;
  if (result.stdout === "") throw new Error(`biome produced no output: ${result.stderr}`);
  return parseRun(result.stdout);
};

describe("architecture rules are enforced by biome", () => {
  let run: BiomeRun = { processedFileCount: 0, diagnostics: [] };
  const diagnosticsFor = (fixture: Fixture): Diagnostic[] =>
    run.diagnostics.filter((d) => d.path === fixturePath(fixture));

  beforeAll(() => {
    for (const fixture of ALL_FIXTURES) {
      writeFileSync(`${REPO_ROOT}${fixturePath(fixture)}`, fixture.source);
    }
    run = runBiome(ALL_FIXTURES.map(fixturePath));
  });

  afterAll(() => {
    for (const fixture of ALL_FIXTURES) {
      rmSync(`${REPO_ROOT}${fixturePath(fixture)}`, { force: true });
    }
  });

  it("opens every fixture", () => {
    expect(run.processedFileCount).toBe(ALL_FIXTURES.length);
  });

  for (const violation of VIOLATIONS) {
    it(`reports ${violation.rule}`, () => {
      const forFixture = diagnosticsFor(violation);
      expect(forFixture, "biome processed no such file").not.toHaveLength(0);
      expect(
        forFixture.some(
          (d) =>
            d.category === violation.expected.category &&
            d.message.includes(violation.expected.messageIncludes),
        ),
        `expected ${violation.expected.category} on ${fixturePath(violation)}, got ${JSON.stringify(forFixture)}`,
      ).toBe(true);
    });
  }

  it("reports nothing for a compliant core module", () => {
    expect(diagnosticsFor(CLEAN_FIXTURE)).toEqual([]);
  });
});
