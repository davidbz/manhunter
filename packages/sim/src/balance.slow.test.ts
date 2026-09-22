/**
 * The balance targets (PLAN M4.3): what the shipped `core/src/balance.ts` has to produce when real
 * hunts are played against it. `balance.test.ts` in `core` asserts the relations between the
 * numbers; this asserts what the numbers do, which only playing can show.
 *
 * Why each target is the number it is, and the measured curve it was tuned on, are in the
 * `ROADBLOCK` comment in `core/src/balance.ts`. Kept there rather than here because the targets are
 * a statement about the balance, and the place to read them is beside the knob they set.
 *
 * **Nothing here is generated.** The seed blocks and the batch size are named constants, so this
 * file measures the same 1200 hunts on every run of the same commit: a target that drifts between
 * two runs of one commit is not a target. It does move when the RNG stream does (PLAN M3.9), which
 * is what `REPLAY_VERSION` exists to make loud, and re-measuring after such a change is the work
 * that keeps these numbers honest rather than a reason to widen the bands.
 *
 * **The runner is driven directly, not through the CLI.** `--seed` takes the first of a contiguous
 * range (PLAN M4.2c), so a non-contiguous list would need a `--seeds` flag - a new argv boundary,
 * with its own bound and its own over-the-limit test, added for a consumer that is a test and not a
 * user. Calling `run` once per block instead costs one loop here and adds no surface. Four disjoint
 * blocks rather than one range of 400 because a target that only held in one neighbourhood of the
 * seed space would pass the single range and should not.
 *
 * It lives in the `slow` project (PLAN "Where slow tests live") because 1200 hunts is about ten
 * seconds, which is most of what `bun run test` costs today.
 */

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
  createRiverLogic,
  createRng,
  createScoringLogic,
  createTopologyLogic,
  createTurnLogic,
  createValidatorLogic,
  type GameSetup,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { type BotKind, type BotLogic, createBotLogic } from "./bots/bots";
import { createRunnerLogic } from "./runner";

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
const bots = createBotLogic({ rng, graph });

/**
 * The hunter the two Inbox entries measure everything else against: one who buys nothing, blocks
 * nothing and lets the hunt happen to them. It is a fake wired into the runner rather than a fourth
 * entry in `BOT_KINDS`, because `bots.ts` belongs to PLAN M4.1 and a baseline is not a strategy
 * anybody would ship - which is exactly what the injected `BotLogic` seam is for.
 */
const IDLE_BOT: BotLogic = { plan: ({ state }) => ({ state, value: [] }) };

/** Four unrelated neighbourhoods of the seed space, so no target rests on one of them. */
const TARGET_SEED_BLOCKS: readonly number[] = [1, 5001, 90001, 1000001];

const GAMES_PER_BLOCK = 100;

const TARGET_GAMES = TARGET_SEED_BLOCKS.length * GAMES_PER_BLOCK;

/** Every figure below is a figure about today's `BALANCE`, grid and deadline included (M4.2c). */
const SETUP: GameSetup = {
  map: BALANCE.map.defaults,
  maxTurns: BALANCE.time.maxTurns,
  difficulty: "standard",
};

/** A hunter playing the criminal's own route wins most hunts, and loses three in ten. */
const WORKED_CAPTURE_MIN = 0.5;
const WORKED_CAPTURE_MAX = 0.7;

/** An untargeted checkpoint is not decoration, and flailing is not a strategy. */
const AIMLESS_CAPTURE_MIN = 0.02;
const AIMLESS_CAPTURE_MAX = 0.2;

/** DESIGN.md's hunt is a hunt, not four decisions (PLAN Inbox). */
const WORKED_HUNT_MIN_TURNS = 6;

/** Playing is not punished (PLAN Inbox): working the case is worth a multiple of sitting on it. */
const PLAYING_PAYS_MULTIPLE = 3;

const BATCH_TIMEOUT_MS = 120_000;

const NOTHING = 0;

type Measurement = {
  readonly played: number;
  readonly notStarted: number;
  readonly captureRate: number;
  readonly averageTurns: number;
  readonly averageScore: number;
};

/**
 * One block per listed seed, folded into one measurement. The per-block reports carry means over
 * their own `played`, so they are weighted back into sums before the single division: four means
 * of unequal denominators averaged flat would not be the mean of the 400 hunts.
 */
const measure = (playedBy: BotLogic, bot: BotKind): Measurement => {
  const runner = createRunnerLogic({ rng, game, turn, bots: playedBy, scoring });
  let played = NOTHING;
  let notStarted = NOTHING;
  let captured = NOTHING;
  let turns = NOTHING;
  let score = NOTHING;
  for (const seed of TARGET_SEED_BLOCKS) {
    const result = runner.run({
      bot,
      setup: SETUP,
      seed,
      games: GAMES_PER_BLOCK,
      balance: BALANCE,
    });
    if (result.kind !== "report") {
      throw new Error(`a target batch was refused: ${result.kind}`);
    }
    played += result.report.played;
    notStarted += result.report.games - result.report.played;
    captured += result.report.outcomes.captured;
    turns += result.report.averageTurns * result.report.played;
    score += result.report.averageScore * result.report.played;
  }
  return {
    played,
    notStarted,
    captureRate: captured / played,
    averageTurns: turns / played,
    averageScore: score / played,
  };
};

/**
 * Measured once at module scope rather than per test: the three batches are the expensive part and
 * every assertion below reads one of them. The bot named alongside `IDLE_BOT` is never consulted,
 * because a hunter who queues nothing never reaches a strategy.
 */
const idle = measure(IDLE_BOT, "random");
const aimless = measure(bots, "random");
const worked = measure(bots, "greedy_roadblock");

describe("the batch the targets are measured on", () => {
  it(
    "plays every seed in the list, so no target is read off a short denominator",
    () => {
      for (const measurement of [idle, aimless, worked]) {
        expect(measurement.played).toBe(TARGET_GAMES);
        expect(measurement.notStarted).toBe(NOTHING);
      }
    },
    BATCH_TIMEOUT_MS,
  );
});

describe("how often the hunter wins", () => {
  it("takes the criminal in most hunts a hunter works, and loses three in ten", () => {
    expect(worked.captureRate).toBeGreaterThanOrEqual(WORKED_CAPTURE_MIN);
    expect(worked.captureRate).toBeLessThanOrEqual(WORKED_CAPTURE_MAX);
  });

  it("lets a hunter with no plan win sometimes, and rarely", () => {
    expect(aimless.captureRate).toBeGreaterThanOrEqual(AIMLESS_CAPTURE_MIN);
    expect(aimless.captureRate).toBeLessThanOrEqual(AIMLESS_CAPTURE_MAX);
  });

  it("leaves a wide gap between working the route and guessing at it", () => {
    expect(worked.captureRate).toBeGreaterThan(aimless.captureRate);
  });

  /**
   * Not a target but the floor under one: a hunter who never closes an edge cannot win, because a
   * checkpoint is the MVP's only capture (PLAN M3.11). It is here so that a change which made the
   * win fall out of doing nothing would be caught by the targets rather than flatter them.
   */
  it("gives nothing away to a hunter who does not act", () => {
    expect(idle.captureRate).toBe(NOTHING);
  });
});

describe("how long a hunt lasts", () => {
  it("runs a worked hunt well past the five turns an unworked one takes", () => {
    expect(worked.averageTurns).toBeGreaterThan(WORKED_HUNT_MIN_TURNS);
    expect(worked.averageTurns).toBeGreaterThan(idle.averageTurns);
  });
});

describe("what a hunt is worth", () => {
  it("pays a hunter who works the case a multiple of one who sits on it", () => {
    expect(worked.averageScore).toBeGreaterThan(idle.averageScore * PLAYING_PAYS_MULTIPLE);
  });

  it("does not punish a hunter for spending on a plan that is only half a plan", () => {
    expect(aimless.averageScore).toBeGreaterThan(idle.averageScore);
  });
});
