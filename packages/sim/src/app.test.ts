/**
 * The app, wired to the real thing (PLAN M4.2c). What is pinned here is the behaviour that only
 * appears once the pieces are together: that a refusal stops the run before a hunt is played, that
 * `--out` produces exactly the two artefacts M2.4 left for this task, and that nothing a user or a
 * disk can do reaches the caller as a throw.
 *
 * The object graph is the production one from `main.ts`, minus the seams a test has to hold: the
 * sink is a hand-written fake (AGENTS.md forbids module mocking), and the fakes that replace a
 * whole collaborator are only there to force an outcome real play cannot be asked for cheaply.
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
  type GameLogic,
  type SealedWorld,
  toHunterView,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { createSimAppLogic, type SimAppDeps, type SimAppLogic, type SimOutcome } from "./app";
import {
  type ArtifactResult,
  type ArtifactWriter,
  createArtifactWriter,
  type FileSink,
} from "./artifact";
import { createBotLogic } from "./bots/bots";
import { FLAGS } from "./cli";
import { LIMITS } from "./limits";
import { type BatchRequest, createRunnerLogic, type RunnerLogic } from "./runner";
import { createMapSvgLogic } from "./svg";

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
const runner = createRunnerLogic({
  rng,
  game,
  turn,
  bots: createBotLogic({ rng, graph }),
  scoring: createScoringLogic(),
});

type Recorded = { readonly path: string; readonly contents: string };

const createRecordingSink = (): { sink: FileSink; writes: Recorded[] } => {
  const writes: Recorded[] = [];
  return {
    sink: {
      write: (path, contents) => {
        writes.push({ path, contents });
        return Promise.resolve();
      },
    },
    writes,
  };
};

const SINK_FAILURE = "EACCES: permission denied";

const createRejectingSink = (): FileSink => ({
  write: () => Promise.reject(new Error(SINK_FAILURE)),
});

/** A filesystem that rejects with something that is not an `Error`, which a promise permits. */
const createOddlyRejectingSink = (): FileSink => ({
  write: () => Promise.reject(SINK_FAILURE),
});

/** Counts what reached the runner, so a test can claim a refusal stopped before any hunt ran. */
const createCountingRunner = (): { runner: RunnerLogic; requests: BatchRequest[] } => {
  const requests: BatchRequest[] = [];
  return {
    runner: {
      run: (request) => {
        requests.push(request);
        return runner.run({ ...request, games: 0 });
      },
    },
    requests,
  };
};

/** A hunt that cannot be created, which is the only way `--out` has no city to draw. */
const UNCREATABLE_GAME: GameLogic = {
  create: () => ({
    kind: "generation_failed",
    attempts: 1,
    lastFailure: { kind: "not_enough_exit_sites", available: 0, requested: 1 },
  }),
};

const TOO_LARGE_BYTES = 4_913;
const TOO_LARGE_MAX = 256;

const OVERSIZED_WRITER: ArtifactWriter = {
  write: () =>
    Promise.resolve({ kind: "too_large", bytes: TOO_LARGE_BYTES, maxBytes: TOO_LARGE_MAX }),
};

/** A result the writer does not have today, forced past the types to reach the `never` default. */
const UNKNOWN_RESULT_WRITER: ArtifactWriter = {
  write: () => Promise.resolve({ kind: "vanished" } as unknown as ArtifactResult),
};

/** The city a seed generates, so a test can claim the map written is that seed's and no other. */
const worldOfSeed = (seed: number): SealedWorld => {
  const created = game.create({
    setup: { map: BALANCE.map.defaults, maxTurns: BALANCE.time.maxTurns, difficulty: "standard" },
    seed,
    balance: BALANCE,
  });
  if (created.kind !== "game") {
    throw new Error(`expected a hunt for seed ${seed}, got ${created.kind}`);
  }
  return created.world;
};

const appWith = (overrides: Partial<SimAppDeps>): SimAppLogic =>
  createSimAppLogic({
    runner,
    game,
    svg: createMapSvgLogic(),
    writer: createArtifactWriter({ sink: createRecordingSink().sink }),
    ...overrides,
  });

const SEED = 20_260_921;
const GAMES = 2;
const OUT_DIR = "/tmp/manhunter-app-test";
const RUN_TIMEOUT_MS = 30_000;

const SMALL_RUN: readonly string[] = [
  FLAGS.games,
  String(GAMES),
  FLAGS.seed,
  String(SEED),
  FLAGS.bot,
  "random",
];

const run = (app: SimAppLogic, argv: readonly string[]) => app.run({ argv, balance: BALANCE });

/** Only what the run said about its artefacts, so a report line cannot carry an assertion. */
const writeLinesOf = (outcome: SimOutcome): readonly string[] =>
  outcome.lines.filter((line) => line.startsWith("wrote ") || line.startsWith("did not write "));

describe("sim app", () => {
  it(
    "plays the run it was asked for and prints a report of it",
    async () => {
      const outcome = await run(appWith({}), SMALL_RUN);

      expect(outcome.status).toBe("ok");
      expect(outcome.lines.join("\n")).toContain("bot: random");
      expect(outcome.lines.join("\n")).toContain(`games: ${GAMES}`);
      expect(outcome.lines.join("\n")).toContain(`seeds: ${SEED}-${SEED + GAMES - 1}`);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "prints the report as JSON when asked to",
    async () => {
      const outcome = await run(appWith({}), [...SMALL_RUN, FLAGS.format, "json"]);

      expect(outcome.status).toBe("ok");
      expect(JSON.parse(outcome.lines.join("\n"))).toMatchObject({ games: GAMES });
    },
    RUN_TIMEOUT_MS,
  );

  it("passes the games, the first seed and the bot it read to the runner", async () => {
    const counting = createCountingRunner();
    await run(appWith({ runner: counting.runner }), [
      FLAGS.games,
      "5",
      FLAGS.seed,
      "11",
      FLAGS.bot,
      "heatmap_chaser",
    ]);

    expect(counting.requests[0]).toMatchObject({ games: 5, seed: 11, bot: "heatmap_chaser" });
  });

  it("takes the difficulty from the flag rather than a default", async () => {
    const counting = createCountingRunner();
    await run(appWith({ runner: counting.runner }), [FLAGS.difficulty, "hard"]);

    expect(counting.requests[0]?.setup.difficulty).toBe("hard");
  });

  it("takes the grid and the deadline from balance, which no flag names", async () => {
    const counting = createCountingRunner();
    await run(appWith({ runner: counting.runner }), []);

    expect(counting.requests[0]?.setup).toEqual({
      map: BALANCE.map.defaults,
      maxTurns: BALANCE.time.maxTurns,
      difficulty: "standard",
    });
  });
});

describe("sim app refusals", () => {
  it("names a bad flag and prints the usage instead of playing anything", async () => {
    const counting = createCountingRunner();
    const outcome = await run(appWith({ runner: counting.runner }), ["--profile", "amateur"]);

    expect(outcome.status).toBe("failed");
    expect(outcome.lines[0]).toContain("--profile");
    expect(outcome.lines.join("\n")).toContain("usage:");
    expect(counting.requests).toHaveLength(0);
  });

  it("surfaces the runner's refusal of a --games one over the limit, and does not clamp", async () => {
    const outcome = await run(appWith({}), [FLAGS.games, String(LIMITS.maxGamesPerRun + 1)]);

    expect(outcome.status).toBe("failed");
    expect(outcome.lines.join("\n")).toContain(String(LIMITS.maxGamesPerRun + 1));
    expect(outcome.lines.join("\n")).toContain(String(LIMITS.maxGamesPerRun));
  });
});

describe("sim app artefacts", () => {
  it(
    "writes nothing at all when no --out is given",
    async () => {
      const { sink, writes } = createRecordingSink();
      const outcome = await run(appWith({ writer: createArtifactWriter({ sink }) }), SMALL_RUN);

      expect(outcome.status).toBe("ok");
      expect(writes).toHaveLength(0);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "writes the report and the map of the first seed into --out",
    async () => {
      const { sink, writes } = createRecordingSink();
      const outcome = await run(appWith({ writer: createArtifactWriter({ sink }) }), [
        ...SMALL_RUN,
        FLAGS.out,
        OUT_DIR,
      ]);

      expect(outcome.status).toBe("ok");
      expect(writes.map((write) => write.path)).toEqual([
        `${OUT_DIR}/batch-random-${SEED}.json`,
        `${OUT_DIR}/map-${SEED}.svg`,
      ]);
      expect(JSON.parse(writes[0]?.contents ?? "")).toMatchObject({ games: GAMES });
      expect(writes[1]?.contents).toContain("<svg");
      expect(outcome.lines.join("\n")).toContain(`wrote ${OUT_DIR}/batch-random-${SEED}.json`);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "draws the city the first seed generated, not some other seed's",
    async () => {
      const { sink, writes } = createRecordingSink();
      await run(appWith({ writer: createArtifactWriter({ sink }) }), [
        ...SMALL_RUN,
        FLAGS.out,
        OUT_DIR,
      ]);
      const drawn = createMapSvgLogic().render({ graph: toHunterView(worldOfSeed(SEED)).map });

      expect(writes[1]?.contents).toBe(drawn);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "writes the report file as JSON even when the run printed text",
    async () => {
      const { sink, writes } = createRecordingSink();
      await run(appWith({ writer: createArtifactWriter({ sink }) }), [
        ...SMALL_RUN,
        FLAGS.format,
        "text",
        FLAGS.out,
        OUT_DIR,
      ]);

      expect(() => JSON.parse(writes[0]?.contents ?? "")).not.toThrow();
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "reports a filesystem that rejected the write rather than throwing",
    async () => {
      const app = appWith({ writer: createArtifactWriter({ sink: createRejectingSink() }) });
      const outcome = await run(app, [...SMALL_RUN, FLAGS.out, OUT_DIR]);

      expect(outcome.status).toBe("failed");
      expect(writeLinesOf(outcome).join("\n")).toContain(SINK_FAILURE);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "reports a rejection that was not an Error rather than losing the reason",
    async () => {
      const app = appWith({ writer: createArtifactWriter({ sink: createOddlyRejectingSink() }) });
      const outcome = await run(app, [...SMALL_RUN, FLAGS.out, OUT_DIR]);

      expect(outcome.status).toBe("failed");
      expect(writeLinesOf(outcome).join("\n")).toContain(SINK_FAILURE);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "reports an artefact the writer refused as too large",
    async () => {
      const outcome = await run(appWith({ writer: OVERSIZED_WRITER }), [
        ...SMALL_RUN,
        FLAGS.out,
        OUT_DIR,
      ]);

      expect(outcome.status).toBe("failed");
      expect(writeLinesOf(outcome).join("\n")).toContain(String(TOO_LARGE_BYTES));
      expect(writeLinesOf(outcome).join("\n")).toContain(String(TOO_LARGE_MAX));
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "treats a write result it does not recognise as a failure, not a success",
    async () => {
      const outcome = await run(appWith({ writer: UNKNOWN_RESULT_WRITER }), [
        ...SMALL_RUN,
        FLAGS.out,
        OUT_DIR,
      ]);

      expect(outcome.status).toBe("failed");
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "says why the map is missing when the seed's hunt cannot be created",
    async () => {
      const { sink, writes } = createRecordingSink();
      const app = appWith({ game: UNCREATABLE_GAME, writer: createArtifactWriter({ sink }) });
      const outcome = await run(app, [...SMALL_RUN, FLAGS.out, OUT_DIR]);

      expect(outcome.status).toBe("failed");
      expect(writeLinesOf(outcome).join("\n")).toContain("no hunt could be created");
      expect(writes.map((write) => write.path)).toEqual([`${OUT_DIR}/batch-random-${SEED}.json`]);
    },
    RUN_TIMEOUT_MS,
  );
});
