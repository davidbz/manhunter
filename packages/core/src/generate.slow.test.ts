/**
 * The first `*.slow.test.ts` in the repo (PLAN "Where slow tests live"). Generate-until-valid runs
 * the validator, which runs min-cut, on every attempt, so a sweep over seeds costs real time:
 * roughly 5.8ms per map at the default grid. It lives in the `slow` Vitest project, which
 * `bun run test` and CI still run and which `bun run test:fast` skips.
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { BALANCE } from "./balance";
import type { MapConfig } from "./config";
import { createDistrictLogic } from "./districts";
import { createGenerationLogic } from "./generate";
import { createGraphLogic } from "./graph";
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

/**
 * Named rather than left to fast-check's default of 100, as the AC requires. 200 maps is about
 * 1.2s, which buys a run over the whole tail (the p999 attempt count is 38) while keeping the
 * project inside a few seconds.
 */
const VALIDITY_RUNS = 200;

/** Deliberately small: each run of this one is a full attempt cap on a config that cannot work. */
const IMPOSSIBLE_RUNS = 25;

describe("generate-until-valid over seeds", () => {
  test.prop([fc.integer({ min: 1, max: 2 ** 31 - 1 })], { numRuns: VALIDITY_RUNS })(
    "every returned map passes the validator",
    (seed) => {
      const result = generation.generate({
        config: DEFAULT_CONFIG,
        balance: BALANCE,
        state: rng.seed(seed),
      });
      // A failure here is a real finding, not a flake: at the measured rate it is 7e-11 per map.
      expect(result.kind).toBe("map");
      if (result.kind !== "map") return;
      expect(validator.validate({ graph: result.graph, balance: BALANCE })).toEqual({
        kind: "valid",
      });
    },
  );

  test.prop([fc.integer({ min: 1, max: 2 ** 31 - 1 })], { numRuns: IMPOSSIBLE_RUNS })(
    "an impossible config refuses by name on every seed",
    (seed) => {
      const result = generation.generate({
        config: { columns: 3, rows: 3, exitCount: 3 },
        balance: BALANCE,
        state: rng.seed(seed),
      });
      expect(result).toMatchObject({
        kind: "generation_failed",
        lastFailure: { kind: "river_not_bridgeable" },
      });
    },
  );
});
