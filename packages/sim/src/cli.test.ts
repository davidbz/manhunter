/**
 * The argv boundary (PLAN M4.2c). Two things are pinned here: that the grammar reads what it
 * claims to, and that every way of getting it wrong is a named result rather than a throw.
 *
 * The bounds get the over-the-limit tests AGENTS.md section 5 asks for, and they are written so
 * that a refusal for the wrong reason fails: the oversized argv also carries an unknown flag and a
 * trailing one, so a parser that checked the bound after reading would name the wrong mistake.
 */

import { describe, expect, it } from "vitest";
import { BOT_KINDS } from "./bots/bots";
import {
  type CliOptions,
  DEFAULT_OPTIONS,
  DIFFICULTIES,
  FLAG_NAMES,
  FLAGS,
  OUTPUT_FORMATS,
  parseCliArguments,
} from "./cli";
import { LIMITS } from "./limits";

const optionsOf = (argv: readonly string[]): CliOptions => {
  const parsed = parseCliArguments(argv);
  if (parsed.kind !== "options") {
    throw new Error(`expected options, got ${parsed.kind}`);
  }
  return parsed.options;
};

/** `--seed 1` repeated, so an argv of any length is built out of legal pairs. */
const repeatedPairs = (count: number): readonly string[] =>
  Array.from({ length: count }, (_unused, index) => (index % 2 === 0 ? FLAGS.seed : "1"));

describe("CLI arguments", () => {
  it("runs on defaults when nothing is passed", () => {
    expect(parseCliArguments([])).toEqual({ kind: "options", options: DEFAULT_OPTIONS });
  });

  it("reads every flag in the grammar", () => {
    const options = optionsOf([
      FLAGS.games,
      "7",
      FLAGS.bot,
      "random",
      FLAGS.difficulty,
      "hard",
      FLAGS.seed,
      "42",
      FLAGS.format,
      "json",
      FLAGS.out,
      "/tmp/manhunter",
    ]);

    expect(options).toEqual({
      games: 7,
      bot: "random",
      difficulty: "hard",
      seed: 42,
      format: "json",
      outputDirectory: "/tmp/manhunter",
    });
  });

  it("leaves every flag it was not given at its default", () => {
    expect(optionsOf([FLAGS.games, "3"])).toEqual({ ...DEFAULT_OPTIONS, games: 3 });
  });

  it("lets a later flag win over an earlier one", () => {
    expect(optionsOf([FLAGS.bot, "random", FLAGS.bot, "heatmap_chaser"]).bot).toBe(
      "heatmap_chaser",
    );
  });

  it("accepts every bot there is", () => {
    for (const bot of BOT_KINDS) {
      expect(optionsOf([FLAGS.bot, bot]).bot).toBe(bot);
    }
  });

  it("accepts every difficulty there is", () => {
    for (const difficulty of DIFFICULTIES) {
      expect(optionsOf([FLAGS.difficulty, difficulty]).difficulty).toBe(difficulty);
    }
  });

  it("accepts every output format there is", () => {
    for (const format of OUTPUT_FORMATS) {
      expect(optionsOf([FLAGS.format, format]).format).toBe(format);
    }
  });

  it("accepts a seed of zero", () => {
    expect(optionsOf([FLAGS.seed, "0"]).seed).toBe(0);
  });

  it("does not bound --games, which is the runner's own refusal to make", () => {
    expect(optionsOf([FLAGS.games, String(LIMITS.maxGamesPerRun + 1)]).games).toBe(
      LIMITS.maxGamesPerRun + 1,
    );
  });
});

describe("CLI argument bounds", () => {
  it("accepts an argv exactly at the count bound", () => {
    const argv = repeatedPairs(LIMITS.maxCliArguments);

    expect(parseCliArguments(argv).kind).toBe("options");
  });

  it("refuses an argv one over the count bound before it parses anything", () => {
    const argv = [...repeatedPairs(LIMITS.maxCliArguments), "--not-a-flag"];

    expect(parseCliArguments(argv)).toEqual({
      kind: "too_many_arguments",
      count: LIMITS.maxCliArguments + 1,
      maxArguments: LIMITS.maxCliArguments,
    });
  });

  it("accepts an argument exactly at the length bound", () => {
    const directory = "d".repeat(LIMITS.maxCliArgumentLength);

    expect(optionsOf([FLAGS.out, directory]).outputDirectory).toBe(directory);
  });

  it("refuses an argument one over the length bound before it parses anything", () => {
    const directory = "d".repeat(LIMITS.maxCliArgumentLength + 1);

    expect(parseCliArguments(["--not-a-flag", directory])).toEqual({
      kind: "argument_too_long",
      length: LIMITS.maxCliArgumentLength + 1,
      maxLength: LIMITS.maxCliArgumentLength,
    });
  });
});

describe("CLI refusals", () => {
  it("names an unknown flag rather than throwing", () => {
    expect(parseCliArguments(["--profile", "amateur"])).toEqual({
      kind: "unknown_flag",
      flag: "--profile",
    });
  });

  it("names a flag left without a value", () => {
    expect(parseCliArguments([FLAGS.games, "5", FLAGS.bot])).toEqual({
      kind: "missing_value",
      flag: FLAGS.bot,
    });
  });

  it("names a flag given an empty value", () => {
    expect(parseCliArguments([FLAGS.out, "   "])).toEqual({
      kind: "empty_value",
      flag: FLAGS.out,
    });
  });

  it("names an unknown bot, and lists the ones there are", () => {
    expect(parseCliArguments([FLAGS.bot, "sniffer_dog"])).toEqual({
      kind: "unknown_bot",
      value: "sniffer_dog",
      allowed: BOT_KINDS,
    });
  });

  it("names an unknown difficulty", () => {
    expect(parseCliArguments([FLAGS.difficulty, "impossible"])).toEqual({
      kind: "unknown_difficulty",
      value: "impossible",
      allowed: DIFFICULTIES,
    });
  });

  it("names an unknown format", () => {
    expect(parseCliArguments([FLAGS.format, "yaml"])).toEqual({
      kind: "unknown_format",
      value: "yaml",
      allowed: OUTPUT_FORMATS,
    });
  });

  it("refuses a --games that is not a number", () => {
    expect(parseCliArguments([FLAGS.games, "lots"])).toEqual({
      kind: "invalid_number",
      flag: FLAGS.games,
      value: "lots",
      minimum: 1,
    });
  });

  it("refuses a fractional --games", () => {
    expect(parseCliArguments([FLAGS.games, "2.5"]).kind).toBe("invalid_number");
  });

  it("refuses a --games below one", () => {
    expect(parseCliArguments([FLAGS.games, "0"]).kind).toBe("invalid_number");
  });

  it("refuses a negative --seed", () => {
    expect(parseCliArguments([FLAGS.seed, "-1"])).toEqual({
      kind: "invalid_number",
      flag: FLAGS.seed,
      value: "-1",
      minimum: 0,
    });
  });

  it("refuses the flag it could not read and nothing after it", () => {
    expect(parseCliArguments([FLAGS.bot, "nobody", FLAGS.difficulty, "nowhere"])).toMatchObject({
      kind: "unknown_bot",
    });
  });
});

describe("CLI grammar", () => {
  it("has a handler for every flag it names", () => {
    for (const flag of FLAG_NAMES) {
      expect(parseCliArguments([flag, "1"]).kind).not.toBe("unknown_flag");
    }
  });
});
