/**
 * The runner, playing real hunts (PLAN M4.2b). The fold's arithmetic is pinned in `batch.test.ts`
 * over hand-built records; what is here is what only real play can show: that every hunt the loop
 * starts is counted once, that the seed sequence is the contiguous range it claims to be, that the
 * replay the report names reproduces the hunt it names, and that the batch bound is a refusal.
 *
 * Nothing here asserts a distribution. What a seed plays changes whenever the RNG stream moves
 * (PLAN M3.9), and pinning win rates is PLAN M4.3's job, with its own hard-coded seed list.
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
  createPlaybackLogic,
  createRiverLogic,
  createRng,
  createScoringLogic,
  createTopologyLogic,
  createTurnLogic,
  createValidatorLogic,
  type GameSetup,
  type HunterAction,
  type MapConfig,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import type { BatchReport } from "./batch";
import { BOT_KINDS, type BotKind, type BotLogic, createBotLogic } from "./bots/bots";
import { LIMITS } from "./limits";
import { type BatchRequest, type BatchResult, createRunnerLogic } from "./runner";

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
const runner = createRunnerLogic({
  rng,
  game,
  turn,
  bots: createBotLogic({ rng, graph }),
  scoring,
});

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

const SEED = 20_260_921;
const BATCH_GAMES = 8;
const SEQUENCE_GAMES = 3;
const BATCH_TIMEOUT_MS = 30_000;

/**
 * Over `core`'s `LIMITS.maxGameTurns` (240), which `core` does not export - the same
 * kept-in-step-by-comment arrangement `maxReplayStringLength` already has (PLAN M3.9).
 */
const TOO_LONG_DEADLINE = 1_000;

/** A grid no seed can carry a river across, so generation refuses every attempt (PLAN M2.3). */
const IMPOSSIBLE_MAP: MapConfig = { columns: 3, rows: 3, exitCount: 1 };

/**
 * Over `core`'s `LIMITS.maxQueuedActions` (32), kept in step by comment as `TOO_LONG_DEADLINE` is.
 * A bot that queues this many has its turn refused whole, which is the case the runner has to
 * record nothing from.
 */
const TOO_MANY_ACTIONS = 33;

const BRIEFING: HunterAction = { kind: "true_briefing" };

/** A bot whose every turn `step` refuses, which the shipped bots never do. */
const overqueueingBot: BotLogic = {
  plan: (request) => ({
    state: request.state,
    value: Array.from({ length: TOO_MANY_ACTIONS }, () => BRIEFING),
  }),
};

const runnerOverqueueing = createRunnerLogic({
  rng,
  game,
  turn,
  bots: overqueueingBot,
  scoring,
});

const requestFor = (bot: BotKind, parts?: Partial<BatchRequest>): BatchRequest => ({
  bot,
  setup: SETUP,
  seed: SEED,
  games: BATCH_GAMES,
  balance: BALANCE,
  ...parts,
});

const reportFor = (bot: BotKind, parts?: Partial<BatchRequest>): BatchReport => {
  const result = runner.run(requestFor(bot, parts));
  if (result.kind !== "report") {
    throw new Error(`expected a report, got ${result.kind}`);
  }
  return result.report;
};

const countedOutcomes = (report: BatchReport): number =>
  Object.values(report.outcomes).reduce((sum, count) => sum + count, 0);

const countedStarts = (report: BatchReport): number =>
  Object.values(report.notStarted).reduce((sum, count) => sum + count, 0);

/** Every ending in a set of reports, added up, so a batch can be compared with its own hunts. */
const totalledOutcomes = (reports: readonly BatchReport[]): Record<string, number> => {
  const totals: Record<string, number> = {};
  for (const [kind, count] of reports.flatMap((report) => Object.entries(report.outcomes))) {
    totals[kind] = (totals[kind] ?? 0) + count;
  }
  return totals;
};

describe("a batch of real hunts", () => {
  for (const bot of BOT_KINDS) {
    it(
      `${bot} plays every seed in the run and counts each hunt once`,
      () => {
        const report = reportFor(bot);

        expect(report.games).toBe(BATCH_GAMES);
        expect(report.played + countedStarts(report)).toBe(BATCH_GAMES);
        expect(countedOutcomes(report)).toBe(report.played);
        expect(report.played).toBeGreaterThan(0);
        expect(report.outcomes.in_progress).toBe(0);
      },
      BATCH_TIMEOUT_MS,
    );
  }

  it(
    "plays the seeds that follow the one it was given",
    () => {
      const batch = reportFor("greedy_roadblock", { games: SEQUENCE_GAMES });
      const alone = Array.from({ length: SEQUENCE_GAMES }, (_unused, index) =>
        reportFor("greedy_roadblock", { games: 1, seed: SEED + index }),
      );

      expect(totalledOutcomes([batch])).toEqual(totalledOutcomes(alone));
      expect(batch.averageTurns * SEQUENCE_GAMES).toBeCloseTo(
        alone.reduce((sum, one) => sum + one.averageTurns, 0),
      );
      expect(batch.averageScore * SEQUENCE_GAMES).toBeCloseTo(
        alone.reduce((sum, one) => sum + one.averageScore, 0),
      );
    },
    BATCH_TIMEOUT_MS,
  );

  it(
    "names hunts from inside the run it played",
    () => {
      const report = reportFor("random");
      const seeds = new Set(Array.from({ length: BATCH_GAMES }, (_unused, at) => SEED + at));

      expect(seeds.has(report.best?.seed ?? -1)).toBe(true);
      expect(seeds.has(report.worst?.seed ?? -1)).toBe(true);
      expect(report.best?.score).toBeGreaterThanOrEqual(report.worst?.score ?? 0);
    },
    BATCH_TIMEOUT_MS,
  );

  it(
    "records a replay that plays the hunt it named back",
    () => {
      const best = reportFor("greedy_roadblock").best;
      if (best === null) {
        throw new Error("expected a hunt to be named");
      }

      const replayed = playback.play({ replay: best.replay, balance: BALANCE });
      if (replayed.kind !== "playback") {
        throw new Error(`expected a playback, got ${replayed.kind}`);
      }

      expect(scoring.score({ world: replayed.world, balance: BALANCE })).toMatchObject({
        outcome: best.outcome,
        total: best.score,
      });
      expect(best.replay.actions).toHaveLength(best.turns);
      expect(best.replay.seed).toBe(best.seed);
    },
    BATCH_TIMEOUT_MS,
  );

  it(
    "reports the same run twice",
    () => {
      expect(reportFor("heatmap_chaser", { games: SEQUENCE_GAMES })).toEqual(
        reportFor("heatmap_chaser", { games: SEQUENCE_GAMES }),
      );
    },
    BATCH_TIMEOUT_MS,
  );

  it(
    "round-trips through JSON",
    () => {
      const report = reportFor("random", { games: SEQUENCE_GAMES });

      expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    },
    BATCH_TIMEOUT_MS,
  );
});

describe("a batch that cannot be played", () => {
  it("refuses one game over the limit rather than clamping to it", () => {
    const result: BatchResult = runner.run(
      requestFor("random", { games: LIMITS.maxGamesPerRun + 1 }),
    );

    expect(result).toEqual({
      kind: "too_many_games",
      requestedGames: LIMITS.maxGamesPerRun + 1,
      maxGames: LIMITS.maxGamesPerRun,
    });
  });

  it("plays a run that sits exactly on the limit", () => {
    const report = reportFor("random", { games: SEQUENCE_GAMES, maxGames: SEQUENCE_GAMES });

    expect(report.games).toBe(SEQUENCE_GAMES);
  });

  it("refuses one game over a limit of its own", () => {
    const result = runner.run(
      requestFor("random", { games: SEQUENCE_GAMES + 1, maxGames: SEQUENCE_GAMES }),
    );

    expect(result).toEqual({
      kind: "too_many_games",
      requestedGames: SEQUENCE_GAMES + 1,
      maxGames: SEQUENCE_GAMES,
    });
  });

  it("plays nothing when asked for no games", () => {
    const report = reportFor("random", { games: 0 });

    expect(report).toMatchObject({ games: 0, played: 0, best: null, worst: null });
  });

  it("counts a hunt whose deadline is too long as attempted and never started", () => {
    const report = reportFor("random", {
      games: SEQUENCE_GAMES,
      setup: { ...SETUP, maxTurns: TOO_LONG_DEADLINE },
    });

    expect(report.games).toBe(SEQUENCE_GAMES);
    expect(report.played).toBe(0);
    expect(report.notStarted.deadline_too_long).toBe(SEQUENCE_GAMES);
    expect(report.best).toBeNull();
  });

  it("records nothing from a turn the step refused", () => {
    const result = runnerOverqueueing.run(requestFor("random", { games: 1 }));
    if (result.kind !== "report") {
      throw new Error(`expected a report, got ${result.kind}`);
    }

    expect(result.report.played).toBe(1);
    expect(result.report.best?.turns).toBe(0);
    expect(result.report.best?.replay.actions).toEqual([]);
  });

  it("counts a hunt whose map cannot be generated as attempted and never started", () => {
    const report = reportFor("random", {
      games: SEQUENCE_GAMES,
      setup: { ...SETUP, map: IMPOSSIBLE_MAP },
    });

    expect(report.games).toBe(SEQUENCE_GAMES);
    expect(report.notStarted.generation_failed).toBe(SEQUENCE_GAMES);
    expect(report.averageTurns).toBe(0);
  });
});
