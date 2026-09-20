/**
 * Playing a replay back (PLAN M3.9). A `Replay` is a seed, a setup and a list of queues; running
 * it through the same `create` and `step` the hunt itself ran through reproduces that hunt, which
 * is the whole reason nothing but those three things is stored.
 *
 * What comes out is `RevealFrame`s, never worlds. `apps/web` renders the replay (PLAN M5.6b) and
 * may not name a `WorldState`, so the projection happens here, on this side of the boundary: a
 * frame is the hunter's view of that turn plus the criminal's true position, which is exactly what
 * DESIGN.md's after-action replay draws - the true path over the heatmap the player was looking
 * at. `frameOf` stays private for the same reason `seal` does: a caller that could project a live
 * world could reveal a hunt that is still running.
 *
 * The final `world` is returned sealed alongside the frames, because the caller that wants a score
 * needs the world `createScoringLogic` takes and re-deriving it would mean playing the replay
 * twice.
 */

import type { Balance } from "./balance";
import type { GameLogic, GameResult } from "./game";
import type { HunterAction } from "./hunter";
import { LIMITS } from "./limits";
import { REPLAY_VERSION, type Replay, type ReplayRefusal } from "./replay";
import { type SealedWorld, unseal } from "./sealed";
import type { Turn } from "./time";
import type { TurnLogic, TurnResult } from "./turn";
import { type RevealFrame, toHunterView } from "./view";

export type PlaybackDeps = {
  readonly game: GameLogic;
  readonly turn: TurnLogic;
};

export type PlaybackRequest = {
  readonly replay: Replay;
  readonly balance: Balance;
};

/**
 * Frames, or why there are none. The two refusals this owns are the two nothing downstream
 * checks: a version this build cannot reproduce, and more recorded turns than a hunt may last.
 * The rest are forwarded with their numbers intact - `create`'s refusals as `not_started`, and
 * `step`'s one refusal as `turn_refused` naming the turn it happened on - because "this setup
 * cannot make a map" and "turn 4 asked for 50 actions" are different answers.
 */
export type PlaybackResult =
  | {
      readonly kind: "playback";
      /** One for the starting world, then one per turn played. Never empty. */
      readonly frames: readonly RevealFrame[];
      readonly world: SealedWorld;
    }
  | Extract<ReplayRefusal, { readonly kind: "unsupported_version" | "too_many_turns" }>
  | { readonly kind: "not_started"; readonly failure: Exclude<GameResult, { kind: "game" }> }
  | {
      readonly kind: "turn_refused";
      readonly turn: Turn;
      readonly failure: Extract<TurnResult, { kind: "too_many_actions" }>;
    };

export type PlaybackLogic = {
  readonly play: (request: PlaybackRequest) => PlaybackResult;
};

const frameOf = (world: SealedWorld): RevealFrame => {
  const state = unseal(world);
  return {
    turn: state.clock.turn,
    view: toHunterView(world),
    criminalNodeId: state.criminal.nodeId,
  };
};

/**
 * A finished world is a fixed point (PLAN M3.8c): `step` refuses a settled world whole rather than
 * running a phase of it, so a replay with actions recorded past the end stops here and reaches the
 * same final state as one that stopped on time. Those trailing queues are dropped rather than
 * refused - they are a longer recording of the same hunt, not a different one.
 */
const runTurns = (
  turnLogic: TurnLogic,
  balance: Balance,
  start: SealedWorld,
  recorded: readonly (readonly HunterAction[])[],
): PlaybackResult => {
  const frames: RevealFrame[] = [frameOf(start)];
  let world = start;

  for (const [index, actions] of recorded.entries()) {
    const result = turnLogic.step({ world, actions, balance });
    if (result.kind === "too_many_actions") {
      return { kind: "turn_refused", turn: index, failure: result };
    }
    if (result.kind === "hunt_over") {
      break;
    }
    world = result.world;
    frames.push(frameOf(world));
  }

  return { kind: "playback", frames, world };
};

export const createPlaybackLogic = ({ game, turn }: PlaybackDeps): PlaybackLogic => ({
  play: ({ replay, balance }) => {
    if (replay.version !== REPLAY_VERSION) {
      return { kind: "unsupported_version", version: replay.version, supported: REPLAY_VERSION };
    }
    if (replay.actions.length > LIMITS.maxGameTurns) {
      return {
        kind: "too_many_turns",
        recordedTurns: replay.actions.length,
        maxTurns: LIMITS.maxGameTurns,
      };
    }

    const created = game.create({ setup: replay.setup, seed: replay.seed, balance });
    if (created.kind !== "game") {
      return { kind: "not_started", failure: created };
    }

    return runTurns(turn, balance, created.world, replay.actions);
  },
});
