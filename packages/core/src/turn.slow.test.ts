/**
 * Architecture rule 2 over whole hunts: same seed plus same action list gives a byte-identical
 * final state. `turn.test.ts` pins it for one seed; this is the 200-game sweep the rule has been
 * owed since PLAN M0.3, and it costs a map generation and a full hunt per run, which is why it
 * lives in the `slow` Vitest project (PLAN "Where slow tests live").
 *
 * It compares the whole transcript rather than only the last world. A hunt that diverged mid-way
 * and converged again would pass the weaker check, and the transcript is also what M3.9's replay
 * has to reproduce.
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";
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
import type { EdgeId } from "./ids";
import { createIntelLogic } from "./intel";
import type { MapGraph } from "./map";
import { createMinCutLogic } from "./mincut";
import { createRiverLogic } from "./river";
import { createRng } from "./rng";
import { type SealedWorld, unseal } from "./sealed";
import { createTopologyLogic } from "./topology";
import { createTurnLogic, type TurnResult } from "./turn";
import { createValidatorLogic } from "./validator";

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

const MAX_TURNS = 24;

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: MAX_TURNS,
  difficulty: "standard",
};

/** The AC's count, named rather than left to fast-check's default of 100. */
const DETERMINISM_RUNS = 200;

const MAX_SEED = 2 ** 31 - 1;

/**
 * Stated rather than inherited: 200 runs of two whole hunts measure at about 6s, which is over
 * Vitest's 5s default. Five times the measurement, so a slower CI box reports a failure and never
 * a timeout.
 */
const DETERMINISM_TIMEOUT_MS = 30_000;

/** A queue the hunter could plausibly send: the action points one turn grants, and no more. */
const MAX_QUEUED = 3;

type ActionBuilder = (map: MapGraph, pick: number) => HunterAction;

const nodeAt = (map: MapGraph, pick: number) =>
  map.nodes[pick % map.nodes.length]?.id ?? map.incidentNodeId;

const edgeAt = (map: MapGraph, pick: number): EdgeId | null =>
  map.edges[pick % map.edges.length]?.id ?? null;

const BRIEFING: ActionBuilder = () => ({ kind: "true_briefing" });

/**
 * One builder per hunter action, so a queue drawn from picks exercises the whole action table
 * rather than the one action a passive hunter can always afford.
 */
const BUILDERS: readonly ActionBuilder[] = [
  BRIEFING,
  (map, pick) => ({ kind: "canvass", nodeId: nodeAt(map, pick) }),
  (map, pick) => ({ kind: "pull_cctv", nodeId: nodeAt(map, pick) }),
  (map, pick) => {
    const edgeId = edgeAt(map, pick);
    if (edgeId === null) {
      return BRIEFING(map, pick);
    }
    return { kind: "roadblock", edgeId };
  },
];

const actionsFrom = (map: MapGraph, picks: readonly number[]): readonly HunterAction[] =>
  picks.map((pick) => (BUILDERS[pick % BUILDERS.length] ?? BRIEFING)(map, pick));

const startedAt = (seed: number): SealedWorld => {
  const created = game.create({ setup: SETUP, seed, balance: BALANCE });
  if (created.kind !== "game") {
    throw new Error(`expected a game, got ${created.kind}`);
  }
  return created.world;
};

/** Every turn the hunt took, sealed worlds included, as the one string two runs must agree on. */
const transcriptOf = (seed: number, picks: readonly number[]): string => {
  let world = startedAt(seed);
  const steps: TurnResult[] = [];
  for (let taken = 0; taken < MAX_TURNS; taken += 1) {
    const result = turn.step({
      world,
      actions: actionsFrom(unseal(world).map, picks),
      balance: BALANCE,
    });
    steps.push(result);
    if (result.kind !== "turn") {
      break;
    }
    world = result.world;
  }
  return JSON.stringify({ steps, final: world });
};

describe("a hunt played twice", () => {
  test.prop(
    [fc.integer({ min: 1, max: MAX_SEED }), fc.array(fc.nat(), { maxLength: MAX_QUEUED })],
    { numRuns: DETERMINISM_RUNS },
  )(
    "ends byte-identical from the same seed and the same actions",
    (seed, picks) => {
      expect(transcriptOf(seed, picks)).toBe(transcriptOf(seed, picks));
    },
    DETERMINISM_TIMEOUT_MS,
  );
});
