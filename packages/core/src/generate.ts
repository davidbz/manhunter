/**
 * Generate-until-valid (PLAN M2.3). Composes the three generation stages and M2.2's validator,
 * retrying from derived seeds until a map passes every rule or the attempt cap is reached.
 *
 * The cap is AGENTS.md section 5 applied to a loop over generated data: an unlucky seed must cost
 * a bounded amount of work, and a config that can never work must say so by name rather than
 * looping quietly. `AttemptFailure` therefore carries either a stage refusal or the validator's
 * violations, because the two have genuinely different causes and the caller has to tell them
 * apart - a 3x3 grid refuses at the river stage and never reaches a validator rule at all.
 */

import type { Balance } from "./balance";
import type { MapConfig } from "./config";
import type { DistrictLogic } from "./districts";
import { LIMITS } from "./limits";
import type { MapGraph } from "./map";
import type { RiverLogic } from "./river";
import type { NonEmptyArray, Rng, RngState } from "./rng";
import type { TopologyLogic } from "./topology";
import type { ValidatorLogic, Violation } from "./validator";

export type GenerationRequest = {
  readonly config: MapConfig;
  readonly balance: Balance;
  readonly state: RngState;
  /** Defaults to `LIMITS.maxMapGenerationAttempts`. Overridable so a test can reach the cap. */
  readonly maxAttempts?: number;
};

/**
 * Why one attempt failed. The first three are stage refusals, re-exported as-is from the stage
 * that raised them so their numbers survive; `invalid` is M2.2's violation list.
 */
export type AttemptFailure =
  | { readonly kind: "map_too_large"; readonly requestedNodes: number; readonly maxNodes: number }
  | {
      readonly kind: "river_not_bridgeable";
      readonly crossings: number;
      readonly requiredBridges: number;
    }
  | {
      readonly kind: "not_enough_exit_sites";
      readonly available: number;
      readonly requested: number;
    }
  | { readonly kind: "invalid"; readonly violations: NonEmptyArray<Violation> };

export type GenerationResult =
  | {
      readonly kind: "map";
      readonly graph: MapGraph;
      readonly state: RngState;
      readonly attempts: number;
    }
  | {
      readonly kind: "generation_failed";
      readonly attempts: number;
      readonly lastFailure: AttemptFailure;
    };

export type GenerationLogic = {
  readonly generate: (request: GenerationRequest) => GenerationResult;
};

type GenerationDeps = {
  readonly rng: Rng;
  readonly topology: TopologyLogic;
  readonly river: RiverLogic;
  readonly districts: DistrictLogic;
  readonly validator: ValidatorLogic;
};

/**
 * `map_too_large` is a function of `config` alone, so no derived seed can ever change it. Retrying
 * it to the cap would burn every attempt and then report the same numbers, which reads as "unlucky"
 * when it is "impossible". Every other failure varies with the seed and is worth another attempt.
 */
const isSeedIndependent = (failure: AttemptFailure): boolean => failure.kind === "map_too_large";

type AttemptResult =
  | { readonly kind: "map"; readonly graph: MapGraph; readonly state: RngState }
  | { readonly kind: "failed"; readonly failure: AttemptFailure };

const attempt = (
  deps: GenerationDeps,
  config: MapConfig,
  balance: Balance,
  state: RngState,
): AttemptResult => {
  const built = deps.topology.generate({ config, balance, state });
  if (built.kind !== "topology") {
    return { kind: "failed", failure: built };
  }

  const carved = deps.river.carve({ topology: built.topology, balance, state: built.state });
  if (carved.kind !== "river") {
    return { kind: "failed", failure: carved };
  }

  const labelled = deps.districts.label({
    topology: carved.topology,
    config,
    balance,
    state: carved.state,
  });
  if (labelled.kind !== "map") {
    return { kind: "failed", failure: labelled };
  }

  const checked = deps.validator.validate({ graph: labelled.graph, balance });
  if (checked.kind === "invalid") {
    return { kind: "failed", failure: { kind: "invalid", violations: checked.violations } };
  }

  return { kind: "map", graph: labelled.graph, state: labelled.state };
};

/**
 * One attempt, resolved into either a final answer or a reason to try another seed. Splitting it
 * out is what lets the loop below carry the last failure in a typed variable instead of a sentinel:
 * there is no "no attempt has run yet" state to invent, because the first attempt runs before the
 * loop and the cap is at least 1.
 */
type Step =
  | { readonly kind: "done"; readonly result: GenerationResult }
  | { readonly kind: "retry"; readonly failure: AttemptFailure };

const step = (
  deps: GenerationDeps,
  { config, balance, state }: GenerationRequest,
  index: number,
): Step => {
  // `fork` derives without advancing the parent (M1.1), so attempt streams are independent of each
  // other and of whatever the caller draws next from `state`.
  const outcome = attempt(deps, config, balance, deps.rng.fork(state, `attempt-${index}`));
  const attempts = index + 1;
  if (outcome.kind === "map") {
    return {
      kind: "done",
      result: { kind: "map", graph: outcome.graph, state: outcome.state, attempts },
    };
  }
  if (isSeedIndependent(outcome.failure)) {
    return {
      kind: "done",
      result: { kind: "generation_failed", attempts, lastFailure: outcome.failure },
    };
  }
  return { kind: "retry", failure: outcome.failure };
};

export const createGenerationLogic = (deps: GenerationDeps): GenerationLogic => ({
  generate: (request) => {
    const cap = Math.max(1, Math.floor(request.maxAttempts ?? LIMITS.maxMapGenerationAttempts));
    let latest = step(deps, request, 0);
    for (let index = 1; index < cap && latest.kind === "retry"; index += 1) {
      latest = step(deps, request, index);
    }
    if (latest.kind === "done") {
      return latest.result;
    }
    return { kind: "generation_failed", attempts: cap, lastFailure: latest.failure };
  },
});
