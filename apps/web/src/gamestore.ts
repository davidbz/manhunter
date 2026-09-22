/**
 * The game the UI is holding, and the two dispatches that move it (PLAN M5.2).
 *
 * The store is a data holder, not logic. It keeps the `SealedWorld` - opaque data it can hand
 * back to `core` and never read (architecture rule 4) - the `HunterView` projected from it, and
 * the per-turn action log a replay is made of (PLAN M3.9: "keep the queue handed to each `step`
 * that returned `{ kind: "turn" }`"). Every transition is a pure function of the deps, the
 * current state and the request; the store only holds what they return.
 *
 * `GameLogic`, `TurnLogic` and `ScoringLogic` (PLAN M5.6a) arrive wired from the composition root
 * (`main.tsx`), per the plan's "How `core`'s game functions are wired" decision. `toHunterView` is
 * a bare function and is imported rather than injected, which is the line that decision draws
 * between the two; `createScoringLogic` takes no deps of its own, but it is still wired at the
 * root rather than called here, the same line drawn for `game` and `turn`.
 *
 * The balance is data, so it is the store's initial state rather than something the dispatches
 * capture: every turn of a hunt is then played under the numbers the hunt was created with, and
 * no second copy can drift from them (PLAN M3.10's note).
 *
 * `Hunt` also carries `frames: readonly RevealFrame[] | null` for PLAN M5.6b's replay scrubber.
 * Unlike `view` and `score`, this is not projected on every transition: `PlaybackLogic.play`
 * replays a hunt from `seed` and `setup` through every recorded turn to build `RevealFrame`s, and
 * `frameOf` (`playback.ts`) unseals whatever world it reaches - including, if called on a replay
 * shorter than the turns actually played, the *live* one. Calling it while `state.hunt.view.
 * outcome.kind` is still `"in_progress"` would therefore hand the UI the criminal's current
 * position mid-hunt, which architecture rule 4 forbids. `framesFor` below only calls `playback`
 * once the world it was just handed has already settled, so `frames` stays `null` for every
 * transition before the last one - one playback per hunt, not one per turn.
 */

import type {
  Balance,
  GameLogic,
  GameResult,
  GameSetup,
  HunterAction,
  HunterView,
  PlanningRejection,
  PlaybackLogic,
  RevealFrame,
  ScoreBreakdown,
  ScoringLogic,
  SealedWorld,
  TurnLogic,
  TurnResult,
  TurnTaken,
} from "@manhunter/core";
import { makeReplay, toHunterView } from "@manhunter/core";
import { createStore, type StoreApi } from "zustand/vanilla";
import { LIMITS } from "./limits";

/** What the hunter asked for on one turn, in submitted order. One entry per turn played. */
export type RecordedTurn = readonly HunterAction[];

/**
 * A hunt in progress. The world, the view and the score move together, so a view or a score that
 * predates the world it was taken from is not representable, and `seed` and `setup` are here
 * because PLAN M5.6b's share link needs them beside the log (`makeReplay({ seed, setup, actions
 * })`). `score` is projected every transition rather than only at the end, the same trade `view`
 * makes (PLAN M5.2's note): `core` already scores an in-progress world rather than refusing to
 * (PLAN M3.10's note), so there is no second case for the store to special-case, and PLAN M5.6a's
 * end screen reads a value that is always there rather than computing one on the way in.
 */
export type Hunt = {
  readonly world: SealedWorld;
  readonly view: HunterView;
  readonly score: ScoreBreakdown;
  readonly seed: number;
  readonly setup: GameSetup;
  readonly recordedActions: readonly RecordedTurn[];
  /** The after-action replay (PLAN M5.6b), or `null` while the hunt is still in progress. */
  readonly frames: readonly RevealFrame[] | null;
};

/**
 * Why a dispatch did nothing. `core`'s own refusals are reused rather than restated, so a new
 * variant on either side arrives here without an edit; the two local ones are the cases `core`
 * never sees, because the store refuses them before it calls anything.
 *
 * Refusals are held rather than thrown or dropped: PLAN M5.5 renders validation errors inline,
 * and a swallowed `hunt_over` or `too_many_actions` is a button that silently does nothing.
 */
export type StoreRefusal =
  | Exclude<GameResult, { readonly kind: "game" }>
  | Exclude<TurnResult, TurnTaken>
  | { readonly kind: "no_hunt" }
  | {
      readonly kind: "too_many_recorded_turns";
      readonly recordedTurns: number;
      readonly maxTurns: number;
    };

export type StartRequest = {
  readonly setup: GameSetup;
  readonly seed: number;
};

export type GameStoreState = {
  readonly balance: Balance;
  readonly hunt: Hunt | null;
  readonly refusal: StoreRefusal | null;
  /** The actions the last played turn declined, by their position in the submitted queue. */
  readonly rejections: readonly PlanningRejection[];
  readonly start: (request: StartRequest) => void;
  readonly endTurn: (actions: readonly HunterAction[]) => void;
};

export type GameStore = StoreApi<GameStoreState>;

export type GameStoreDeps = {
  readonly game: GameLogic;
  readonly turn: TurnLogic;
  readonly scoring: ScoringLogic;
  readonly playback: PlaybackLogic;
};

/** Everything a dispatch may change. The dispatches themselves and the balance never move. */
type Transition = Pick<GameStoreState, "hunt" | "refusal" | "rejections">;

const NO_REJECTIONS: readonly PlanningRejection[] = [];
const NO_FRAMES = null;

const refused = (hunt: Hunt | null, refusal: StoreRefusal): Transition => ({
  hunt,
  refusal,
  rejections: NO_REJECTIONS,
});

/**
 * `RevealFrame`s for a settled hunt, or `null` for one still running. Playing the replay back is
 * the only way `apps/web` may learn the criminal's path (architecture rule 4: it may not import
 * `WorldState`, so it cannot build a `RevealFrame` any other way), and it is only safe once the
 * world just produced has an outcome other than `in_progress` - see the module note.
 */
const framesFor = (
  playback: PlaybackLogic,
  balance: Balance,
  view: HunterView,
  seed: number,
  setup: GameSetup,
  recordedActions: readonly RecordedTurn[],
): readonly RevealFrame[] | null => {
  if (view.outcome.kind === "in_progress") return NO_FRAMES;

  const replay = makeReplay({ seed, setup, actions: recordedActions });
  const result = playback.play({ replay, balance });
  return result.kind === "playback" ? result.frames : NO_FRAMES;
};

const started = (deps: GameStoreDeps, state: GameStoreState, request: StartRequest): Transition => {
  const result = deps.game.create({ ...request, balance: state.balance });
  if (result.kind !== "game") return refused(null, result);

  const view = toHunterView(result.world);
  return {
    hunt: {
      world: result.world,
      view,
      score: deps.scoring.score({ world: result.world, balance: state.balance }),
      seed: request.seed,
      setup: request.setup,
      recordedActions: [],
      frames: framesFor(deps.playback, state.balance, view, request.seed, request.setup, []),
    },
    refusal: null,
    rejections: NO_REJECTIONS,
  };
};

const ended = (
  deps: GameStoreDeps,
  state: GameStoreState,
  actions: readonly HunterAction[],
): Transition => {
  const { hunt } = state;
  if (!hunt) return refused(null, { kind: "no_hunt" });

  const recordedTurns = hunt.recordedActions.length;
  if (recordedTurns >= LIMITS.maxRecordedTurns) {
    return refused(hunt, {
      kind: "too_many_recorded_turns",
      recordedTurns,
      maxTurns: LIMITS.maxRecordedTurns,
    });
  }

  const result = deps.turn.step({ world: hunt.world, actions, balance: state.balance });
  if (result.kind !== "turn") return refused(hunt, result);

  const view = toHunterView(result.world);
  const recordedActions = [...hunt.recordedActions, actions];
  return {
    hunt: {
      ...hunt,
      world: result.world,
      view,
      score: deps.scoring.score({ world: result.world, balance: state.balance }),
      recordedActions,
      frames: framesFor(deps.playback, state.balance, view, hunt.seed, hunt.setup, recordedActions),
    },
    refusal: null,
    rejections: result.rejections,
  };
};

export const createGameStore = (deps: GameStoreDeps, balance: Balance): GameStore =>
  createStore<GameStoreState>()((set, get) => ({
    balance,
    hunt: null,
    refusal: null,
    rejections: NO_REJECTIONS,
    start: (request) => set(started(deps, get(), request)),
    endTurn: (actions) => set(ended(deps, get(), actions)),
  }));
