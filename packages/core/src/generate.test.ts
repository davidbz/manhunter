import { describe, expect, it } from "vitest";
import { BALANCE } from "./balance";
import type { MapConfig } from "./config";
import { createDistrictLogic } from "./districts";
import { createGenerationLogic } from "./generate";
import { createGraphLogic } from "./graph";
import { LIMITS } from "./limits";
import { createMinCutLogic } from "./mincut";
import { createRiverLogic } from "./river";
import { createRng } from "./rng";
import { createTopologyLogic } from "./topology";
import { createValidatorLogic } from "./validator";

const rng = createRng();
const graph = createGraphLogic();
const minCut = createMinCutLogic({ graph });
const validator = createValidatorLogic({ graph, minCut });
const generation = createGenerationLogic({
  rng,
  topology: createTopologyLogic({ rng, graph }),
  river: createRiverLogic({ rng, graph }),
  districts: createDistrictLogic({ rng, graph }),
  validator,
});

const DEFAULT_CONFIG: MapConfig = { columns: 8, rows: 6, exitCount: 3 };
/** Impossible: under `MIN_BANK * 2` on both axes, so no orientation can carry a river. */
const IMPOSSIBLE_CONFIG: MapConfig = { columns: 3, rows: 3, exitCount: 3 };
/** Narrow but ordinary: the river runs across the 6 rows. See M2.3's note. */
const NARROW_CONFIG: MapConfig = { columns: 3, rows: 6, exitCount: 3 };

const generate = (config: MapConfig, seed: number, maxAttempts?: number) =>
  generation.generate({
    config,
    balance: BALANCE,
    state: rng.seed(seed),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  });

describe("generate-until-valid", () => {
  it("returns a map that passes every validator rule", () => {
    const result = generate(DEFAULT_CONFIG, 1);
    expect(result.kind).toBe("map");
    if (result.kind !== "map") return;
    expect(validator.validate({ graph: result.graph, balance: BALANCE })).toEqual({
      kind: "valid",
    });
    expect(result.attempts).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic: the same seed yields an identical map and attempt count", () => {
    expect(generate(DEFAULT_CONFIG, 7)).toEqual(generate(DEFAULT_CONFIG, 7));
  });

  it("yields different maps for different seeds", () => {
    expect(generate(DEFAULT_CONFIG, 7)).not.toEqual(generate(DEFAULT_CONFIG, 8));
  });

  it("does not advance the caller's stream, so attempts stay independent of later draws", () => {
    const state = rng.seed(11);
    generation.generate({ config: DEFAULT_CONFIG, balance: BALANCE, state });
    expect(rng.uint32(state)).toEqual(rng.uint32(rng.seed(11)));
  });

  it("treats a narrow 3x6 grid as an ordinary config, not an impossible one", () => {
    const result = generate(NARROW_CONFIG, 3);
    expect(result.kind).toBe("map");
  });
});

describe("attempt cap", () => {
  it("reports the river refusal by name on an impossible config", () => {
    const result = generate(IMPOSSIBLE_CONFIG, 1);
    expect(result.kind).toBe("generation_failed");
    if (result.kind !== "generation_failed") return;
    // The failure is a stage refusal, not a validator violation: a 3x3 grid never reaches a rule.
    expect(result.lastFailure.kind).toBe("river_not_bridgeable");
    expect(result.attempts).toBe(LIMITS.maxMapGenerationAttempts);
  });

  it("stops at exactly the attempt cap it was given", () => {
    const capped = generate(IMPOSSIBLE_CONFIG, 1, 5);
    expect(capped).toMatchObject({ kind: "generation_failed", attempts: 5 });
  });

  it("runs one attempt when the cap is one, and never zero", () => {
    expect(generate(IMPOSSIBLE_CONFIG, 1, 1).attempts).toBe(1);
    expect(generate(IMPOSSIBLE_CONFIG, 1, 0).attempts).toBe(1);
  });

  it("reports the district refusal with its numbers when a config wants more exits than exist", () => {
    // Retried to the cap rather than short-circuited: unlike `map_too_large`, the count of usable
    // border sites depends on the topology, so another seed is a genuine second chance.
    const result = generate({ columns: 4, rows: 4, exitCount: 50 }, 1, 4);
    expect(result).toMatchObject({
      kind: "generation_failed",
      attempts: 4,
      lastFailure: { kind: "not_enough_exit_sites", available: 10, requested: 50 },
    });
  });

  it("gives up on a seed-independent refusal after one attempt, not at the cap", () => {
    const tooLarge = { columns: 40, rows: 40, exitCount: 3 };
    const result = generate(tooLarge, 1);
    expect(result.kind).toBe("generation_failed");
    if (result.kind !== "generation_failed") return;
    expect(result.lastFailure).toMatchObject({
      kind: "map_too_large",
      maxNodes: LIMITS.maxMapNodes,
    });
    // Retrying a config-only failure would burn every attempt to report the same numbers.
    expect(result.attempts).toBe(1);
  });
});
