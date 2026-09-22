/**
 * What a run prints (PLAN M4.2c). Every assertion here is over a hand-built report, so nothing
 * depends on what a seed happens to play - the same separation `batch.test.ts` keeps from
 * `runner.test.ts`.
 *
 * The one structural claim is `EVERY_FAILURE`: a total record over `CliFailure["kind"]`, so a new
 * refusal in `cli.ts` is a compile error here until it has a message, and the loop below proves
 * none of them falls through to the `never` default.
 */

import {
  decodeReplay,
  encodeReplay,
  type GameOutcome,
  type GameSetup,
  type HunterAction,
  makeReplay,
  type Replay,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import {
  type BatchReport,
  EMPTY_BATCH,
  type HuntHighlight,
  type HuntRecord,
  toBatchReport,
  withHunt,
} from "./batch";
import { BOT_KINDS } from "./bots/bots";
import {
  type CliFailure,
  type CliOptions,
  DEFAULT_OPTIONS,
  DIFFICULTIES,
  FLAG_NAMES,
  FLAGS,
  OUTPUT_FORMATS,
} from "./cli";
import { LIMITS } from "./limits";
import {
  describeBatchRefusal,
  describeCliFailure,
  describeWrite,
  formatBatch,
  formatBatchReport,
  isWriteFailure,
  makeBatchReportFileName,
  toBatchJson,
  USAGE_LINES,
  type WriteReport,
} from "./output";

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

const BRIEFING: readonly HunterAction[] = [{ kind: "true_briefing" }];

const replayOf = (seed: number, turns: number): Replay =>
  makeReplay({ seed, setup: SETUP, actions: Array.from({ length: turns }, () => BRIEFING) });

const played = (seed: number, outcome: GameOutcome, turns: number, score: number): HuntRecord => ({
  kind: "played",
  seed,
  outcome,
  turns,
  score,
  replay: replayOf(seed, turns),
});

const reportOf = (records: readonly HuntRecord[]): BatchReport =>
  toBatchReport(records.reduce(withHunt, EMPTY_BATCH));

const bestOf = (report: BatchReport): HuntHighlight => {
  if (report.best === null) {
    throw new Error("expected a best hunt");
  }
  return report.best;
};

const encodedOf = (replay: Replay): string => {
  const encoded = encodeReplay(replay);
  if (encoded.kind !== "replay_string") {
    throw new Error(`expected a replay string, got ${encoded.kind}`);
  }
  return encoded.value;
};

const CAPTURE = played(7, { kind: "captured", turn: 9 }, 9, 900);
const ESCAPE = played(8, { kind: "escaped", turn: 4 }, 4, 40);

/**
 * A hunt whose replay carries more turns than its own deadline, which is what `encodeReplay`
 * refuses (PLAN M3.9). Built by hand, because no run can produce one.
 */
const OVER_DEADLINE: HuntRecord = {
  kind: "played",
  seed: 3,
  outcome: { kind: "escaped", turn: 2 },
  turns: 2,
  score: 0,
  replay: makeReplay({
    seed: 3,
    setup: SETUP,
    actions: Array.from({ length: SETUP.maxTurns + 1 }, () => BRIEFING),
  }),
};

const TWO_HUNTS = reportOf([CAPTURE, ESCAPE]);
const OPTIONS: CliOptions = { ...DEFAULT_OPTIONS, bot: "random", seed: 7, games: 2 };

const textOf = (report: BatchReport, options: CliOptions): string =>
  formatBatchReport(report, options).join("\n");

describe("human-readable batch report", () => {
  it("names the run the report came from, which the report itself does not carry", () => {
    const text = textOf(TWO_HUNTS, OPTIONS);

    expect(text).toContain("bot: random");
    expect(text).toContain("difficulty: standard");
    expect(text).toContain("seeds: 7-8");
  });

  it("shows the counts, both rates and both averages", () => {
    const text = textOf(TWO_HUNTS, OPTIONS);

    expect(text).toContain("games: 2");
    expect(text).toContain("played: 2");
    expect(text).toContain("capture rate: 50.0%");
    expect(text).toContain("escape rate: 50.0%");
    expect(text).toContain("average turns: 6.50");
    expect(text).toContain("average score: 470.00");
  });

  it("shows every outcome kind and every reason a hunt did not start", () => {
    const text = textOf(TWO_HUNTS, OPTIONS);

    expect(text).toContain("captured: 1");
    expect(text).toContain("escaped: 1");
    expect(text).toContain("timed_out: 0");
    expect(text).toContain("generation_failed: 0");
    expect(text).toContain("deadline_too_long: 0");
  });

  it("names the best and worst hunt with a replay link that decodes", () => {
    const text = textOf(TWO_HUNTS, OPTIONS);
    const link = encodedOf(bestOf(TWO_HUNTS).replay);

    expect(text).toContain("best: seed 7, score 900, captured after 9 turns");
    expect(text).toContain("worst: seed 8, score 40, escaped after 4 turns");
    expect(text).toContain(link);
    expect(decodeReplay(link)).toMatchObject({ kind: "replay" });
  });

  it("says so rather than printing a blank when a run singled out no hunt", () => {
    const text = textOf(reportOf([]), OPTIONS);

    expect(text).toContain("best: none");
    expect(text).toContain("worst: none");
  });

  it("reports a replay it could not encode instead of an empty link", () => {
    const text = textOf(reportOf([OVER_DEADLINE]), OPTIONS);

    expect(text).toContain("replay: unavailable (");
  });
});

describe("JSON batch report", () => {
  it("is the report verbatim, and parses back into it", () => {
    expect(JSON.parse(toBatchJson(TWO_HUNTS))).toEqual(TWO_HUNTS);
  });

  it("keeps the replay of the hunt it singles out", () => {
    const parsed: BatchReport = JSON.parse(toBatchJson(TWO_HUNTS));

    expect(decodeReplay(encodedOf(bestOf(parsed).replay))).toMatchObject({ kind: "replay" });
  });
});

describe("format selection", () => {
  it("prints text by default", () => {
    expect(formatBatch(TWO_HUNTS, { ...OPTIONS, format: "text" })[0]).toBe("bot: random");
  });

  it("prints JSON when asked for it", () => {
    const lines = formatBatch(TWO_HUNTS, { ...OPTIONS, format: "json" });

    expect(JSON.parse(lines.join("\n"))).toEqual(TWO_HUNTS);
  });

  it("has a formatter for every format the grammar accepts", () => {
    for (const format of OUTPUT_FORMATS) {
      expect(formatBatch(TWO_HUNTS, { ...OPTIONS, format }).length).toBeGreaterThan(0);
    }
  });
});

/**
 * Total over the refusal kinds, so a new one in `cli.ts` does not compile until it is listed here.
 */
const EVERY_FAILURE: Readonly<Record<CliFailure["kind"], CliFailure>> = {
  too_many_arguments: { kind: "too_many_arguments", count: 33, maxArguments: 32 },
  argument_too_long: { kind: "argument_too_long", length: 4097, maxLength: 4096 },
  unknown_flag: { kind: "unknown_flag", flag: "--profile" },
  missing_value: { kind: "missing_value", flag: FLAGS.bot },
  empty_value: { kind: "empty_value", flag: FLAGS.out },
  invalid_number: { kind: "invalid_number", flag: FLAGS.games, value: "lots", minimum: 1 },
  unknown_bot: { kind: "unknown_bot", value: "sniffer_dog", allowed: BOT_KINDS },
  unknown_difficulty: { kind: "unknown_difficulty", value: "brutal", allowed: DIFFICULTIES },
  unknown_format: { kind: "unknown_format", value: "yaml", allowed: OUTPUT_FORMATS },
};

describe("refusal messages", () => {
  it("has a message for every refusal, and none of them falls through", () => {
    for (const failure of Object.values(EVERY_FAILURE)) {
      const message = describeCliFailure(failure);

      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("unrecognised");
    }
  });

  it("names the flag it did not recognise and the ones it would have", () => {
    const message = describeCliFailure(EVERY_FAILURE.unknown_flag);

    expect(message).toContain("--profile");
    expect(message).toContain(FLAGS.games);
  });

  it("names the bot it did not recognise and every bot there is", () => {
    const message = describeCliFailure(EVERY_FAILURE.unknown_bot);

    expect(message).toContain("sniffer_dog");
    for (const bot of BOT_KINDS) {
      expect(message).toContain(bot);
    }
  });

  it("names the flag left without a value", () => {
    expect(describeCliFailure(EVERY_FAILURE.missing_value)).toContain(FLAGS.bot);
  });

  it("carries both numbers of a bound it refused", () => {
    const message = describeCliFailure(EVERY_FAILURE.too_many_arguments);

    expect(message).toContain("33");
    expect(message).toContain("32");
  });
});

describe("batch refusal message", () => {
  it("carries the games asked for and the limit, not a clamp", () => {
    const message = describeBatchRefusal({
      kind: "too_many_games",
      requestedGames: LIMITS.maxGamesPerRun + 1,
      maxGames: LIMITS.maxGamesPerRun,
    });

    expect(message).toContain(String(LIMITS.maxGamesPerRun + 1));
    expect(message).toContain(String(LIMITS.maxGamesPerRun));
  });
});

const TOO_LARGE_BYTES = 4_913;
const TOO_LARGE_MAX_BYTES = 256;

const EVERY_WRITE: Readonly<Record<WriteReport["kind"], WriteReport>> = {
  written: { kind: "written", path: "/tmp/out/batch.json", bytes: 12 },
  too_large: {
    kind: "too_large",
    path: "/tmp/out/batch.json",
    bytes: TOO_LARGE_BYTES,
    maxBytes: TOO_LARGE_MAX_BYTES,
  },
  write_failed: { kind: "write_failed", path: "/tmp/out/batch.json", reason: "ENOENT" },
  not_written: { kind: "not_written", path: "/tmp/out/map-1.svg", reason: "no city" },
};

describe("write messages", () => {
  it("has a message for every write outcome, and each names its path", () => {
    for (const write of Object.values(EVERY_WRITE)) {
      const message = describeWrite(write);

      expect(message).toContain(write.path);
      expect(message).not.toContain("unrecognised");
    }
  });

  it("carries both numbers when an artefact overran the bound", () => {
    const message = describeWrite(EVERY_WRITE.too_large);

    expect(message).toContain(String(TOO_LARGE_BYTES));
    expect(message).toContain(String(TOO_LARGE_MAX_BYTES));
  });

  it("counts only a completed write as a success", () => {
    expect(isWriteFailure(EVERY_WRITE.written)).toBe(false);
    expect(isWriteFailure(EVERY_WRITE.too_large)).toBe(true);
    expect(isWriteFailure(EVERY_WRITE.write_failed)).toBe(true);
    expect(isWriteFailure(EVERY_WRITE.not_written)).toBe(true);
  });
});

describe("usage", () => {
  it("gives every flag in the grammar a line of its own", () => {
    for (const flag of FLAG_NAMES) {
      expect(USAGE_LINES.some((line) => line.trimStart().startsWith(flag))).toBe(true);
    }
  });

  it("lists the values the closed-set flags accept", () => {
    const usage = USAGE_LINES.join("\n");

    for (const value of [...BOT_KINDS, ...DIFFICULTIES, ...OUTPUT_FORMATS]) {
      expect(usage).toContain(value);
    }
  });
});

/**
 * The `never` defaults are for the variant someone adds without a message. The type system stops
 * that at compile time, so reaching it at all takes a cast - the `world.test.ts` precedent for
 * forcing data the types forbid.
 */
describe("unhandled kinds", () => {
  it("says a refusal was unrecognised rather than printing an empty line", () => {
    const message = describeCliFailure({ kind: "sunspots" } as unknown as CliFailure);

    expect(message).toContain("unrecognised");
  });

  it("says a write was unrecognised rather than printing an empty line", () => {
    const message = describeWrite({ kind: "sunspots" } as unknown as WriteReport);

    expect(message).toContain("unrecognised");
  });
});

describe("report file name", () => {
  it("names the bot and the first seed, and cannot hold a path separator", () => {
    const name = makeBatchReportFileName("greedy_roadblock", 42);

    expect(name).toBe("batch-greedy_roadblock-42.json");
    expect(name).not.toContain("/");
  });
});
