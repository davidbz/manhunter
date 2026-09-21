/**
 * The game the UI is holding, and the two dispatches that move it (PLAN M5.2).
 *
 * The store is a data holder, not logic. It keeps the `SealedWorld` - opaque data it can hand
 * back to `core` and never read (architecture rule 4) - the `HunterView` projected from it, and
 * the per-turn action log a replay is made of (PLAN M3.9: "keep the queue handed to each `step`
 * that returned `{ kind: "turn" }`"). Every transition is a pure function of the deps, the
 * current state and the request; the store only holds what they return.
 *
 * `GameLogic` and `TurnLogic` arrive wired from the composition root (`main.tsx`), per the plan's
 * "How `core`'s game functions are wired" decision. `toHunterView` is a bare function and is
 * imported rather than injected, which is the line that decision draws between the two.
 *
 * The balance is data, so it is the store's initial state rather than something the dispatches
 * capture: every turn of a hunt is then played under the numbers the hunt was created with, and
 * no second copy can drift from them (PLAN M3.10's note).
 */

import type {
  Balance,
  GameLogic,
  GameResult,
  GameSetup,
  HunterAction,
  HunterView,
  PlanningRejection,
  SealedWorld,
  TurnLogic,
  TurnResult,
  TurnTaken,
} from "@manhunter/core";
import { toHunterView } from "@manhunter/core";
import { createStore, type StoreApi } from "zustand/vanilla";
import { LIMITS } from "./limits";

/** What the hunter asked for on one turn, in submitted order. One entry per turn played. */
export type RecordedTurn = readonly HunterAction[];

/**
 * A hunt in progress. The world and the view move together, so a view that predates the world
 * it was taken from is not representable, and `seed` and `setup` are here because PLAN M5.6b's
 * share link needs them beside the log (`makeReplay({ seed, setup, actions })`).
 */
export type Hunt = {
  readonly world: SealedWorld;
  readonly view: HunterView;
  readonly seed: number;
  readonly setup: GameSetup;
  readonly recordedActions: readonly RecordedTurn[];
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
};

/** Everything a dispatch may change. The dispatches themselves and the balance never move. */
type Transition = Pick<GameStoreState, "hunt" | "refusal" | "rejections">;

const NO_REJECTIONS: readonly PlanningRejection[] = [];

const refused = (hunt: Hunt | null, refusal: StoreRefusal): Transition => ({
  hunt,
  refusal,
  rejections: NO_REJECTIONS,
});

const started = (deps: GameStoreDeps, state: GameStoreState, request: StartRequest): Transition => {
  const result = deps.game.create({ ...request, balance: state.balance });
  if (result.kind !== "game") return refused(null, result);

  return {
    hunt: {
      world: result.world,
      view: toHunterView(result.world),
      seed: request.seed,
      setup: request.setup,
      recordedActions: [],
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

  return {
    hunt: {
      ...hunt,
      world: result.world,
      view: toHunterView(result.world),
      recordedActions: [...hunt.recordedActions, actions],
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
