/**
 * The batch runner (PLAN M4.2b): play N hunts from a seed sequence with one of PLAN M4.1's bots
 * and fold them into one report (`batch.ts`).
 *
 * Logic only. Nothing here parses an argument, touches a disk or writes a line - PLAN M4.2c owns
 * every boundary this run sits behind, and wires this unit at `main.ts` beside the artefact writer
 * PLAN M2.4 left there. The one bound the run owns itself is `LIMITS.maxGamesPerRun`, checked
 * before a single hunt is created (AGENTS.md section 5).
 *
 * This is the consumer PLAN's "How `sim` reaches inside a sealed world" named: a finished hunt is
 * read through `unseal`. The outcome and the clock are both in `HunterView` too, but projecting a
 * whole view - belief, reports, events - to read two numbers off it, once per game and up to
 * `maxGamesPerRun` times, is work for nothing. The bots may not do this and cannot: `biome.json`
 * denies `unseal` to `packages/sim/src/bots/**`, which is why the runner lives outside it.
 */

import {
  type Balance,
  type GameLogic,
  type GameSetup,
  type HunterAction,
  isHuntOver,
  makeReplay,
  type Rng,
  type ScoringLogic,
  type SealedWorld,
  type TurnLogic,
  toHunterView,
  unseal,
} from "@manhunter/core";
import { type BatchReport, EMPTY_BATCH, type HuntRecord, toBatchReport, withHunt } from "./batch";
import type { BotKind, BotLogic } from "./bots/bots";
import { LIMITS } from "./limits";

export type RunnerDeps = {
  readonly rng: Rng;
  readonly game: GameLogic;
  readonly turn: TurnLogic;
  readonly bots: BotLogic;
  readonly scoring: ScoringLogic;
};

export type BatchRequest = {
  readonly bot: BotKind;
  readonly setup: GameSetup;
  /** The first seed. Hunt `n` of the run plays `seed + n`, so a run is one contiguous range. */
  readonly seed: number;
  readonly games: number;
  readonly balance: Balance;
  /**
   * Defaults to `LIMITS.maxGamesPerRun`. Overridable for the same reason `ArtifactRequest.maxBytes`
   * is (PLAN M2.4): a test that has to stand on both sides of the cap should not have to play ten
   * thousand hunts to reach it.
   */
  readonly maxGames?: number;
};

/**
 * A report, or the one thing a run refuses. Oversized is an error result carrying both numbers,
 * never a clamp (AGENTS.md section 5), and it is refused before any hunt is created rather than
 * after `maxGamesPerRun` of them have been played.
 */
export type BatchResult =
  | { readonly kind: "report"; readonly report: BatchReport }
  | {
      readonly kind: "too_many_games";
      readonly requestedGames: number;
      readonly maxGames: number;
    };

export type RunnerLogic = {
  readonly run: (request: BatchRequest) => BatchResult;
};

type PlayedHunt = {
  readonly world: SealedWorld;
  /** The queues `step` accepted, in order, which is what `makeReplay` records (PLAN M3.9). */
  readonly actions: readonly (readonly HunterAction[])[];
};

/**
 * A whole hunt, turn by turn, until it ends or its deadline does.
 *
 * `setup.maxTurns` bounds the loop: since PLAN M4.2a a hunt that reaches it ends `timed_out`, so
 * the loop and the game agree on when to stop, and `create` has already refused a deadline over
 * `core`'s own `maxGameTurns`. A queue is recorded only after the step that accepted it, so a
 * refused turn leaves no trace in the replay and the recording is of the hunt that happened.
 *
 * The bot draws from its own stream, forked off the game seed by bot name, so two bots on one seed
 * play the same city from the same first position without sharing draws.
 */
const playHunt = (
  deps: RunnerDeps,
  request: BatchRequest,
  seed: number,
  start: SealedWorld,
): PlayedHunt => {
  let world = start;
  let state = deps.rng.fork(deps.rng.seed(seed), request.bot);
  const actions: (readonly HunterAction[])[] = [];
  for (let played = 0; played < request.setup.maxTurns; played += 1) {
    const view = toHunterView(world);
    if (isHuntOver(view.outcome)) {
      return { world, actions };
    }
    const decision = deps.bots.plan({
      kind: request.bot,
      view,
      balance: request.balance,
      state,
    });
    state = decision.state;
    const taken = deps.turn.step({ world, actions: decision.value, balance: request.balance });
    if (taken.kind !== "turn") {
      return { world, actions };
    }
    actions.push(decision.value);
    world = taken.world;
  }
  return { world, actions };
};

/**
 * `turns` is the clock rather than the outcome's stamp. For a settled hunt the two are the same
 * number (PLAN M3.8c: the conditions are checked after the clock ticks), and the clock is also
 * right for a hunt the loop left unsettled, which the stamp cannot be because there is none.
 */
const huntFrom = (deps: RunnerDeps, request: BatchRequest, seed: number): HuntRecord => {
  const created = deps.game.create({ setup: request.setup, seed, balance: request.balance });
  if (created.kind !== "game") {
    return { kind: "not_started", seed, reason: created.kind };
  }
  const { world, actions } = playHunt(deps, request, seed, created.world);
  const finished = unseal(world);
  return {
    kind: "played",
    seed,
    outcome: finished.outcome,
    turns: finished.clock.turn,
    score: deps.scoring.score({ world, balance: request.balance }).total,
    replay: makeReplay({ seed, setup: request.setup, actions }),
  };
};

export const createRunnerLogic = (deps: RunnerDeps): RunnerLogic => ({
  run: (request) => {
    const maxGames = request.maxGames ?? LIMITS.maxGamesPerRun;
    if (request.games > maxGames) {
      return { kind: "too_many_games", requestedGames: request.games, maxGames };
    }
    let accumulator = EMPTY_BATCH;
    for (let game = 0; game < request.games; game += 1) {
      accumulator = withHunt(accumulator, huntFrom(deps, request, request.seed + game));
    }
    return { kind: "report", report: toBatchReport(accumulator) };
  },
});
