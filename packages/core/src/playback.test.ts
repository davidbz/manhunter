/**
 * PLAN M3.9's acceptance criteria: a recorded hunt replays to the same final state, and what comes
 * out is renderable without a `WorldState` in sight. The second one is the reason `renderedFrom`
 * below takes nothing but frames - it stands in for `apps/web` (PLAN M5.6b), which may not name
 * that type at all (architecture rule 4).
 */

import { describe, expect, it } from "vitest";
import { createActionLogic } from "./actions";
import { createCriminalAiLogic } from "./ai";
import { BALANCE } from "./balance";
import { createBeliefLogic } from "./belief";
import type { GameSetup } from "./config";
import { createDistrictLogic } from "./districts";
import { createEventLogic } from "./eventtable";
import { createGameLogic } from "./game";
import { createGenerationLogic } from "./generate";
import { createGraphLogic } from "./graph";
import type { HunterAction } from "./hunter";
import type { NodeId } from "./ids";
import { createIntelLogic } from "./intel";
import { LIMITS } from "./limits";
import { createMinCutLogic } from "./mincut";
import { createPlaybackLogic, type PlaybackResult } from "./playback";
import { makeReplay, REPLAY_VERSION, type Replay } from "./replay";
import { createRiverLogic } from "./river";
import { createRng } from "./rng";
import { type SealedWorld, unseal } from "./sealed";
import { createTopologyLogic } from "./topology";
import { createTurnLogic } from "./turn";
import { createValidatorLogic } from "./validator";
import type { RevealFrame } from "./view";

const rng = createRng();
const graph = createGraphLogic();
const generation = createGenerationLogic({
  rng,
  topology: createTopologyLogic({ rng, graph }),
  river: createRiverLogic({ rng, graph }),
  districts: createDistrictLogic({ rng, graph }),
  validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
});
const game = createGameLogic({ rng, generation });
const turn = createTurnLogic({
  intel: createIntelLogic({ rng, graph }),
  events: createEventLogic({ rng }),
  belief: createBeliefLogic({ graph }),
  action: createActionLogic({ rng }),
  ai: createCriminalAiLogic({ rng, graph }),
  graph,
});
const playback = createPlaybackLogic({ game, turn });

const MAX_TURNS = 24;

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: MAX_TURNS,
  difficulty: "standard",
};

/** Hard-coded rather than drawn, per the house rule for seeds: a failure has to be reproducible. */
const SEEDS: readonly number[] = [1, 7, 13, 29, 41];

const FIRST_TURN = 0;
const NO_ACTIONS: readonly HunterAction[] = [];

type Recording = {
  readonly replay: Replay;
  readonly world: SealedWorld;
  /** Where the criminal truly stood at the start and after every turn played. */
  readonly path: readonly NodeId[];
};

/**
 * A hunt played the way `apps/web` plays one, keeping what a replay would have kept. The queue is
 * derived from the seed and the turn so that the recording exercises the action table rather than
 * a hunter who does nothing.
 */
const record = (seed: number, setup: GameSetup = SETUP): Recording => {
  const created = game.create({ setup, seed, balance: BALANCE });
  if (created.kind !== "game") {
    throw new Error(`expected a game, got ${created.kind}`);
  }

  let world = created.world;
  const actions: (readonly HunterAction[])[] = [];
  const path: NodeId[] = [unseal(world).criminal.nodeId];

  for (let taken = FIRST_TURN; taken < setup.maxTurns; taken += 1) {
    const queue = queueFor(world, seed + taken);
    const result = turn.step({ world, actions: queue, balance: BALANCE });
    if (result.kind !== "turn") {
      break;
    }
    actions.push(queue);
    world = result.world;
    path.push(unseal(world).criminal.nodeId);
  }

  return { replay: makeReplay({ seed, setup, actions }), world, path };
};

const queueFor = (world: SealedWorld, pick: number): readonly HunterAction[] => {
  const map = unseal(world).map;
  const nodeId = map.nodes[pick % map.nodes.length]?.id ?? map.incidentNodeId;
  const edge = map.edges[pick % map.edges.length];
  if (edge === undefined) {
    return [{ kind: "true_briefing" }];
  }
  return [
    { kind: "canvass", nodeId },
    { kind: "roadblock", edgeId: edge.id },
  ];
};

const playedOut = (replay: Replay): Extract<PlaybackResult, { kind: "playback" }> => {
  const result = playback.play({ replay, balance: BALANCE });
  if (result.kind !== "playback") {
    throw new Error(`expected a playback, got ${result.kind}`);
  }
  return result;
};

/** What a UI can build from a playback, and the whole of what it is given to build it from. */
const renderedFrom = (frames: readonly RevealFrame[]): readonly string[] =>
  frames.map((frame) => `${frame.turn}:${frame.criminalNodeId}:${frame.view.belief.length}`);

describe("replaying a recorded hunt", () => {
  it("reproduces the final state exactly", () => {
    for (const seed of SEEDS) {
      const recorded = record(seed);

      expect(JSON.stringify(unseal(playedOut(recorded.replay).world))).toBe(
        JSON.stringify(unseal(recorded.world)),
      );
    }
  });

  it("reproduces the same frames every time it is played", () => {
    const recorded = record(SEEDS[0] ?? 1);

    expect(JSON.stringify(playedOut(recorded.replay).frames)).toBe(
      JSON.stringify(playedOut(recorded.replay).frames),
    );
  });

  it("gives one frame for the starting world and one for every turn played", () => {
    for (const seed of SEEDS) {
      const recorded = record(seed);

      expect(playedOut(recorded.replay).frames).toHaveLength(recorded.replay.actions.length + 1);
    }
  });

  it("stamps each frame with the turn it shows", () => {
    const frames = playedOut(record(SEEDS[1] ?? 1).replay).frames;

    expect(frames.map((frame) => frame.turn)).toEqual(frames.map((_, index) => index));
    expect(frames.map((frame) => frame.view.clock.turn)).toEqual(frames.map((frame) => frame.turn));
  });

  it("reveals where the criminal truly was on each of them", () => {
    for (const seed of SEEDS) {
      const recorded = record(seed);

      expect(playedOut(recorded.replay).frames.map((frame) => frame.criminalNodeId)).toEqual(
        recorded.path,
      );
    }
  });

  it("hands the UI frames rather than worlds", () => {
    const rendered = renderedFrom(playedOut(record(SEEDS[0] ?? 1).replay).frames);

    expect(rendered[FIRST_TURN]).toMatch(/^0:/);
  });
});

describe("a replay recorded past the end of the hunt", () => {
  it("reaches the same final state as one that stopped on time", () => {
    const recorded = record(SEEDS[0] ?? 1);
    const padded = makeReplay({
      seed: recorded.replay.seed,
      setup: recorded.replay.setup,
      actions: [...recorded.replay.actions, NO_ACTIONS, NO_ACTIONS, NO_ACTIONS],
    });

    expect(JSON.stringify(unseal(playedOut(padded).world))).toBe(
      JSON.stringify(unseal(recorded.world)),
    );
    expect(JSON.stringify(playedOut(padded).frames)).toBe(
      JSON.stringify(playedOut(recorded.replay).frames),
    );
  });

  it("ends on a settled outcome rather than a hunt still running", () => {
    expect(unseal(playedOut(record(SEEDS[0] ?? 1).replay).world).outcome.kind).not.toBe(
      "in_progress",
    );
  });
});

describe("a replay that cannot be played", () => {
  it("refuses a version this build cannot reproduce", () => {
    const foreign: Replay = { ...record(SEEDS[0] ?? 1).replay, version: REPLAY_VERSION + 1 };

    expect(playback.play({ replay: foreign, balance: BALANCE })).toEqual({
      kind: "unsupported_version",
      version: REPLAY_VERSION + 1,
      supported: REPLAY_VERSION,
    });
  });

  it("refuses more recorded turns than a hunt may last, before a map is generated", () => {
    const recorded = Array.from({ length: LIMITS.maxGameTurns + 1 }, () => NO_ACTIONS);

    expect(
      playback.play({
        replay: makeReplay({ seed: 1, setup: SETUP, actions: recorded }),
        balance: BALANCE,
      }),
    ).toEqual({
      kind: "too_many_turns",
      recordedTurns: LIMITS.maxGameTurns + 1,
      maxTurns: LIMITS.maxGameTurns,
    });
  });

  it("forwards a setup that cannot start a hunt", () => {
    const impossible: GameSetup = { ...SETUP, map: { columns: 3, rows: 3, exitCount: 3 } };
    const result = playback.play({
      replay: makeReplay({ seed: 1, setup: impossible, actions: [] }),
      balance: BALANCE,
    });

    expect(result).toMatchObject({ kind: "not_started", failure: { kind: "generation_failed" } });
  });

  it("forwards a deadline past the cap as the refusal `create` gives it", () => {
    const result = playback.play({
      replay: makeReplay({
        seed: 1,
        setup: { ...SETUP, maxTurns: LIMITS.maxGameTurns + 1 },
        actions: [],
      }),
      balance: BALANCE,
    });

    expect(result).toMatchObject({
      kind: "not_started",
      failure: { kind: "deadline_too_long", maxTurns: LIMITS.maxGameTurns },
    });
  });

  it("forwards the turn a queue was too long, rather than playing a shorter hunt", () => {
    const overlong = Array.from(
      { length: LIMITS.maxQueuedActions + 1 },
      (): HunterAction => ({ kind: "true_briefing" }),
    );
    const result = playback.play({
      replay: makeReplay({ seed: 1, setup: SETUP, actions: [NO_ACTIONS, overlong] }),
      balance: BALANCE,
    });

    expect(result).toMatchObject({
      kind: "turn_refused",
      turn: 1,
      failure: { kind: "too_many_actions", requestedActions: LIMITS.maxQueuedActions + 1 },
    });
  });
});
