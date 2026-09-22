import { describe, expect, it } from "vitest";
import vitestConfig from "../../vitest.config";

/**
 * AGENTS.md section 5 bounds every operation that can hang or loop in time as well as in size and
 * count, and names the bound rather than inheriting one. A test run is such an operation: a
 * property test runs as many cases as it is told to, each doing real work, and until this file
 * existed the only thing stopping one was Vitest's undeclared 5000ms default.
 *
 * That default held on a developer machine and did not hold on CI, which runs about four times
 * slower: `game.test.ts` and `generate.slow.test.ts` both timed out there while passing here.
 * Neither is pathological and neither hangs - they were simply never told how long they had.
 * `turn.slow.test.ts` was, in its own `DETERMINISM_TIMEOUT_MS`, and it is the one heavy test that
 * survived CI. So this is AGENTS.md's existing rule applied to the suite itself: declare the bound.
 *
 * A per-project timeout rather than one at the root, because Vitest's `projects` do not inherit
 * root `test` options - a root-level `testTimeout` would read as bounded and enforce nothing.
 *
 * The check is static, over the config. Asserting that the suite finishes inside some wall-clock
 * budget would be the very thing this guards against: a bound that passes on one machine and fails
 * on another.
 */

const PROJECTS = vitestConfig.test?.projects ?? [];

/** Vitest types a project as a config object or a path to one; only the former can declare this. */
const timeoutOf = (project: unknown): unknown => {
  if (typeof project !== "object" || project === null) return undefined;
  const { test } = project as { readonly test?: unknown };
  if (typeof test !== "object" || test === null) return undefined;
  return (test as { readonly testTimeout?: unknown }).testTimeout;
};

const nameOf = (project: unknown, index: number): string => {
  const timeout = timeoutOf(project);
  const named = typeof project === "object" && project !== null;
  const label = named
    ? ((project as { readonly test?: { readonly name?: string } }).test?.name ?? `#${index}`)
    : `#${index}`;
  return `${label}: ${String(timeout)}`;
};

describe("the suite declares its own time bounds", () => {
  it("finds the projects it is meant to be checking", () => {
    expect(PROJECTS.length).toBeGreaterThan(0);
  });

  it("names a test timeout on every project rather than inheriting one", () => {
    const undeclared = PROJECTS.filter((project) => typeof timeoutOf(project) !== "number").map(
      nameOf,
    );
    expect(undeclared).toEqual([]);
  });
});
