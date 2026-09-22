import type { GameSetup, HunterAction, SealedWorld, TurnLogic } from "@manhunter/core";
import {
  BALANCE,
  createActionLogic,
  createBeliefLogic,
  createCriminalAiLogic,
  createDistrictLogic,
  createEventLogic,
  createGameLogic,
  createGenerationLogic,
  createGraphLogic,
  createIntelLogic,
  createMinCutLogic,
  createPlaybackLogic,
  createRiverLogic,
  createRng,
  createScoringLogic,
  createTopologyLogic,
  createTurnLogic,
  createValidatorLogic,
  encodeReplay,
  makeEdgeId,
  makeReplay,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { createGameStore, type GameStore, type GameStoreState, type Hunt } from "./gamestore";
import { LIMITS } from "./limits";

/**
 * Architecture rule 4 in the type layer, on this side of the seam (PLAN M5.2's AC). `core`'s
 * `sealed.test.ts` asserts the same of `SealedWorld` where it is declared; what these assert is
 * that the store `apps/web` hands to its components exposes no member of the world it holds. A
 * readable field here fails `bun run typecheck` before any test runs.
 */
type AssertTrue<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;

export type SealedWorldNamesNoMember = AssertTrue<IsNever<Extract<keyof SealedWorld, string>>>;
export type StoredWorldNamesNoMember = AssertTrue<IsNever<Extract<keyof Hunt["world"], string>>>;
export type StoreExposesNoOtherWorld = AssertTrue<
  IsNever<Extract<keyof GameStoreState, "world" | "criminal" | "config">>
>;

const rng = createRng();
const graph = createGraphLogic();

const game = createGameLogic({
  rng,
  generation: createGenerationLogic({
    rng,
    topology: createTopologyLogic({ rng, graph }),
    river: createRiverLogic({ rng, graph }),
    districts: createDistrictLogic({ rng, graph }),
    validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
  }),
});

const turn = createTurnLogic({
  rng,
  intel: createIntelLogic({ rng, graph }),
  events: createEventLogic({ rng }),
  belief: createBeliefLogic({ graph }),
  action: createActionLogic({ rng }),
  ai: createCriminalAiLogic({ rng, graph }),
  graph,
});

const scoring = createScoringLogic();
const playback = createPlaybackLogic({ game, turn });

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

/** Hard-coded rather than drawn, so a failure names the hunt that failed (PLAN M3.6's rule). */
const SEED = 1;

/** Every MVP hunt is over well inside the deadline (PLAN M3.8c), so this only bounds the loop. */
const TURNS_TO_PLAY_OUT = 24;

/**
 * Comfortably past `core`'s own `LIMITS.maxQueuedActions`, which `web` cannot import (the
 * standing Inbox entry about the two `limits.ts` files).
 */
const OVER_CORE_QUEUE_LIMIT = 64;

const BRIEFING: HunterAction = { kind: "true_briefing" };
const NOWHERE: HunterAction = { kind: "roadblock", edgeId: makeEdgeId("no-such-edge") };

const huntIn = (store: GameStore): Hunt => {
  const { hunt } = store.getState();
  if (!hunt) throw new Error("expected a hunt to be running");
  return hunt;
};

const startedStore = (): GameStore => {
  const store = createGameStore({ game, turn, scoring, playback }, BALANCE);
  store.getState().start({ setup: SETUP, seed: SEED });
  return store;
};

/** Plays until the hunt settles, so the test after it is stepping a world `core` has finished. */
const playedOut = (store: GameStore): GameStore => {
  for (let played = 0; played < TURNS_TO_PLAY_OUT; played += 1) {
    if (huntIn(store).view.outcome.kind !== "in_progress") return store;
    store.getState().endTurn([]);
  }
  throw new Error("the hunt did not end inside its deadline");
};

describe("the game store", () => {
  it("runs under a DOM, which is what PLAN M5.2's jsdom environment buys", () => {
    expect(typeof document).toBe("object");
  });

  it("holds no hunt until one is started", () => {
    const store = createGameStore({ game, turn, scoring, playback }, BALANCE);

    expect(store.getState().hunt).toBeNull();
    expect(store.getState().refusal).toBeNull();
  });

  it("exposes the hunter's view of a started hunt", () => {
    const { view, seed, setup } = huntIn(startedStore());

    expect(view.clock.turn).toBe(0);
    expect(view.map.nodes.length).toBeGreaterThan(0);
    expect(view.outcome.kind).toBe("in_progress");
    expect({ seed, setup }).toEqual({ seed: SEED, setup: SETUP });
  });

  it("moves the view on with the world it was taken from", () => {
    const store = startedStore();
    const before = huntIn(store).view;

    store.getState().endTurn([]);

    expect(huntIn(store).view.clock.turn).toBe(before.clock.turn + 1);
    expect(huntIn(store).view).not.toBe(before);
  });

  it("records the queue of every turn it plays, in order", () => {
    const store = startedStore();

    store.getState().endTurn([BRIEFING]);
    store.getState().endTurn([]);

    expect(huntIn(store).recordedActions).toEqual([[BRIEFING], []]);
  });

  it("carries planning rejections out of the turn rather than dropping them", () => {
    const store = startedStore();

    store.getState().endTurn([BRIEFING, NOWHERE]);

    expect(store.getState().rejections).toEqual([
      { index: 1, reason: { kind: "unknown_edge", edgeId: NOWHERE.edgeId } },
    ]);
    expect(store.getState().refusal).toBeNull();
  });

  it("clears the rejections of the turn before", () => {
    const store = startedStore();

    store.getState().endTurn([NOWHERE]);
    store.getState().endTurn([]);

    expect(store.getState().rejections).toEqual([]);
  });

  it("refuses a hunt whose deadline core will not accept, and starts nothing", () => {
    const store = createGameStore({ game, turn, scoring, playback }, BALANCE);

    store.getState().start({ setup: { ...SETUP, maxTurns: Number.MAX_SAFE_INTEGER }, seed: SEED });

    expect(store.getState().hunt).toBeNull();
    expect(store.getState().refusal).toMatchObject({ kind: "deadline_too_long" });
  });

  it("refuses to end a turn when no hunt is running", () => {
    const store = createGameStore({ game, turn, scoring, playback }, BALANCE);

    store.getState().endTurn([]);

    expect(store.getState().refusal).toEqual({ kind: "no_hunt" });
  });

  it("surfaces a queue core refuses, and records nothing for it", () => {
    const store = startedStore();
    const queue = Array.from({ length: OVER_CORE_QUEUE_LIMIT }, () => BRIEFING);

    store.getState().endTurn(queue);

    expect(store.getState().refusal).toMatchObject({ kind: "too_many_actions" });
    expect(huntIn(store).recordedActions).toEqual([]);
    expect(huntIn(store).view.clock.turn).toBe(0);
  });

  it("surfaces a finished hunt rather than silently doing nothing", () => {
    const store = playedOut(startedStore());
    const settled = huntIn(store);

    store.getState().endTurn([]);

    expect(store.getState().refusal).toEqual({ kind: "hunt_over", outcome: settled.view.outcome });
    expect(huntIn(store).recordedActions).toEqual(settled.recordedActions);
  });
});

/**
 * PLAN M5.6b's replay scrubber reads `hunt.frames`. It is `null` while a hunt is running - the
 * only way `apps/web` may learn the criminal's path is to play the replay back, and doing that
 * before the hunt is over would hand a live world's position to the UI (`gamestore.ts`'s note).
 */
describe("the replay it builds once a hunt settles", () => {
  it("has no frames while the hunt is in progress", () => {
    const store = startedStore();

    expect(huntIn(store).frames).toBeNull();

    store.getState().endTurn([]);

    expect(huntIn(store).view.outcome.kind).toBe("in_progress");
    expect(huntIn(store).frames).toBeNull();
  });

  it("gets one frame per turn played, ending on the criminal's true final position", () => {
    const store = playedOut(startedStore());
    const settled = huntIn(store);

    expect(settled.frames).not.toBeNull();
    expect(settled.frames).toHaveLength(settled.recordedActions.length + 1);
    expect(settled.frames?.at(-1)?.turn).toBe(settled.view.clock.turn);
  });

  it("replays the same seed, setup and log the store recorded", () => {
    const store = playedOut(startedStore());
    const settled = huntIn(store);
    const replay = makeReplay({
      seed: settled.seed,
      setup: settled.setup,
      actions: settled.recordedActions,
    });
    const replayed = playback.play({ replay, balance: BALANCE });

    expect(replayed).toEqual({ kind: "playback", frames: settled.frames, world: settled.world });
  });
});

/**
 * PLAN M5.6b-2's `loadShared`. It decides not to invent a lighter path for a shared hunt than a
 * played one gets: a replay string is played back through the same `deps.playback` `framesFor`
 * already uses, and the `Hunt` it builds is asserted here to match, field by field, the `Hunt`
 * the store would have built by actually playing the same seed, setup and log turn by turn.
 */
describe("loading a shared replay", () => {
  const stringFor = (replay: Parameters<typeof makeReplay>[0]): string => {
    const encoded = encodeReplay(makeReplay(replay));
    if (encoded.kind !== "replay_string") {
      throw new Error(`expected a string, got ${encoded.kind}`);
    }
    return encoded.value;
  };

  it("builds the same hunt a played-out game would have, from its own replay string", () => {
    const settled = huntIn(playedOut(startedStore()));
    const value = stringFor({
      seed: settled.seed,
      setup: settled.setup,
      actions: settled.recordedActions,
    });

    const store = createGameStore({ game, turn, scoring, playback }, BALANCE);
    store.getState().loadShared(value);
    const loaded = huntIn(store);

    expect(loaded.seed).toBe(settled.seed);
    expect(loaded.setup).toEqual(settled.setup);
    expect(loaded.recordedActions).toEqual(settled.recordedActions);
    expect(loaded.view).toEqual(settled.view);
    expect(loaded.score).toEqual(settled.score);
    expect(loaded.frames).toEqual(settled.frames);
    expect(store.getState().shareLinkRefusal).toBeNull();
  });

  it("resumes an unfinished replay as a normal in-progress hunt, playable onward", () => {
    const live = startedStore();
    live.getState().endTurn([]);
    const midHunt = huntIn(live);
    const value = stringFor({
      seed: midHunt.seed,
      setup: midHunt.setup,
      actions: midHunt.recordedActions,
    });

    const store = createGameStore({ game, turn, scoring, playback }, BALANCE);
    store.getState().loadShared(value);
    const loaded = huntIn(store);

    expect(loaded.view.outcome.kind).toBe("in_progress");
    expect(loaded.frames).toBeNull();

    store.getState().endTurn([]);

    expect(huntIn(store).view.clock.turn).toBe(loaded.view.clock.turn + 1);
  });

  it("refuses a malformed replay string and leaves no hunt behind", () => {
    const store = createGameStore({ game, turn, scoring, playback }, BALANCE);

    store.getState().loadShared("not a replay");

    expect(store.getState().hunt).toBeNull();
    expect(store.getState().shareLinkRefusal).toMatchObject({ kind: "malformed" });
  });

  /** The task's own AC, at the store boundary this time: refused before `core` ever parses it. */
  it("refuses a replay string one character over web's own URL bound", () => {
    const store = createGameStore({ game, turn, scoring, playback }, BALANCE);
    const overLong = "a".repeat(LIMITS.maxReplayStringLength + 1);

    store.getState().loadShared(overLong);

    expect(store.getState().hunt).toBeNull();
    expect(store.getState().shareLinkRefusal).toEqual({
      kind: "share_link_too_long",
      length: LIMITS.maxReplayStringLength + 1,
      maxLength: LIMITS.maxReplayStringLength,
    });
  });
});

/**
 * The bound on the action log (AGENTS.md section 5). A hunt with no outcome has no deadline rule
 * to stop it, so the log is the thing that grows; the shipped turn logic cannot reach the cap
 * because every MVP hunt ends in about five turns, so the turn it steps is faked while the world
 * it holds stays the real one `core` produced.
 */
describe("the action log's bound", () => {
  const echoing: TurnLogic = {
    step: ({ world }) => ({ kind: "turn", world, events: [], rejections: [] }),
  };
  const echoingPlayback = createPlaybackLogic({ game, turn: echoing });

  const filledStore = (): GameStore => {
    const store = createGameStore(
      { game, turn: echoing, scoring, playback: echoingPlayback },
      BALANCE,
    );
    store.getState().start({ setup: SETUP, seed: SEED });
    for (let played = 0; played < LIMITS.maxRecordedTurns; played += 1) {
      store.getState().endTurn([]);
    }
    return store;
  };

  it("records turns up to the limit", () => {
    const store = filledStore();

    expect(huntIn(store).recordedActions).toHaveLength(LIMITS.maxRecordedTurns);
    expect(store.getState().refusal).toBeNull();
  });

  it("refuses the turn one over the limit, and truncates nothing", () => {
    const store = filledStore();

    store.getState().endTurn([BRIEFING]);

    expect(store.getState().refusal).toEqual({
      kind: "too_many_recorded_turns",
      recordedTurns: LIMITS.maxRecordedTurns,
      maxTurns: LIMITS.maxRecordedTurns,
    });
    expect(huntIn(store).recordedActions).toHaveLength(LIMITS.maxRecordedTurns);
  });
});
