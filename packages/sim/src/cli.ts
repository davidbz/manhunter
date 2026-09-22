/**
 * The argv boundary (PLAN M4.2c): the text a shell hands `bun run sim` becomes either a set of
 * options or a named refusal, and nothing else happens on the way.
 *
 * Parsing returns data and acts on none of it (AGENTS.md engineering principle 1), so this module
 * has no collaborators and therefore no factory - the `batch.ts` precedent. **Nothing here throws.**
 * A typo is a user's mistake rather than a bug, so every one of them is a `kind` on the result
 * union, which is what lets `main.ts` print a message and set an exit code instead of a stack.
 *
 * Both bounds AGENTS.md section 5 asks of an input are checked before a single argument is read:
 * `LIMITS.maxCliArguments` on how many arrive and `LIMITS.maxCliArgumentLength` on how large one
 * may be. The count alone would leave argv unbounded in bytes.
 *
 * `--games` is **not** bounded here. `LIMITS.maxGamesPerRun` belongs to the runner (PLAN M4.2b),
 * which refuses an oversized batch before it creates a hunt and returns both numbers; a second
 * copy of that check here would be a second number to keep in step.
 */

import type { Difficulty } from "@manhunter/core";
import { BOT_KINDS, type BotKind } from "./bots/bots";
import { LIMITS } from "./limits";

/** How a finished run is printed. `text` for a person, `json` for anything that parses. */
export const OUTPUT_FORMATS = ["text", "json"] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * Written out in full rather than derived from a list, so a fourth `Difficulty` in `core` is a
 * compile error here rather than a value the CLI silently refuses (the `NO_OUTCOMES` precedent in
 * `batch.ts`). `DIFFICULTIES` is the same table as a list, for validating and for the usage text.
 */
const DIFFICULTY_TABLE: Readonly<Record<Difficulty, Difficulty>> = {
  easy: "easy",
  standard: "standard",
  hard: "hard",
};

export const DIFFICULTIES: readonly Difficulty[] = Object.values(DIFFICULTY_TABLE);

/** Every flag there is, named once. The usage text and the handler table both read this. */
export const FLAGS = {
  games: "--games",
  bot: "--bot",
  difficulty: "--difficulty",
  seed: "--seed",
  format: "--format",
  out: "--out",
} as const;

export type FlagName = (typeof FLAGS)[keyof typeof FLAGS];

export const FLAG_NAMES: readonly FlagName[] = Object.values(FLAGS);

/** What a run was asked for. Plain data; the app turns it into a `GameSetup` and a `BatchRequest`. */
export type CliOptions = {
  readonly games: number;
  readonly bot: BotKind;
  readonly difficulty: Difficulty;
  /** The first seed of the run. Hunt `n` plays `seed + n` (PLAN M4.2b's `BatchRequest`). */
  readonly seed: number;
  readonly format: OutputFormat;
  /** Where artefacts are written, or `null` for a run that only prints. */
  readonly outputDirectory: string | null;
};

const DEFAULT_GAMES = 100;
const DEFAULT_SEED = 1;
const DEFAULT_BOT: BotKind = "greedy_roadblock";
const DEFAULT_DIFFICULTY: Difficulty = "standard";
const DEFAULT_FORMAT: OutputFormat = "text";

/**
 * Every flag has a default, so `bun run sim` with no arguments is a run rather than an error.
 * There is no required flag: a missing one would be a seventh refusal kind describing a mistake
 * that a sensible default already answers.
 */
export const DEFAULT_OPTIONS: CliOptions = {
  games: DEFAULT_GAMES,
  bot: DEFAULT_BOT,
  difficulty: DEFAULT_DIFFICULTY,
  seed: DEFAULT_SEED,
  format: DEFAULT_FORMAT,
  outputDirectory: null,
};

/** `--games` must buy at least one hunt; a seed is an index into the stream, so zero is a seed. */
const MIN_GAMES = 1;
const MIN_SEED = 0;

/**
 * Options, or the one thing that stopped them being built. Every refusal carries what the message
 * needs, so `output.ts` formats data rather than re-deriving it.
 */
export type CliParse =
  | { readonly kind: "options"; readonly options: CliOptions }
  | {
      readonly kind: "too_many_arguments";
      readonly count: number;
      readonly maxArguments: number;
    }
  | {
      readonly kind: "argument_too_long";
      readonly length: number;
      readonly maxLength: number;
    }
  | { readonly kind: "unknown_flag"; readonly flag: string }
  | { readonly kind: "missing_value"; readonly flag: string }
  | { readonly kind: "empty_value"; readonly flag: string }
  | {
      readonly kind: "invalid_number";
      readonly flag: FlagName;
      readonly value: string;
      readonly minimum: number;
    }
  | { readonly kind: "unknown_bot"; readonly value: string; readonly allowed: readonly string[] }
  | {
      readonly kind: "unknown_difficulty";
      readonly value: string;
      readonly allowed: readonly string[];
    }
  | {
      readonly kind: "unknown_format";
      readonly value: string;
      readonly allowed: readonly string[];
    };

export type CliFailure = Exclude<CliParse, { readonly kind: "options" }>;

/** A handler returns the options it produced, or the refusal that stopped it. */
type FlagHandler = (options: CliOptions, value: string) => CliParse;

const isBotKind = (value: string): value is BotKind => BOT_KINDS.some((kind) => kind === value);

const isDifficulty = (value: string): value is Difficulty =>
  DIFFICULTIES.some((difficulty) => difficulty === value);

const isOutputFormat = (value: string): value is OutputFormat =>
  OUTPUT_FORMATS.some((format) => format === value);

/** A whole number at or above `minimum`, or nothing. Decimals and words are both refusals. */
const wholeNumberIn = (value: string, minimum: number): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    return null;
  }
  return parsed;
};

const withNumber = (
  options: CliOptions,
  flag: FlagName,
  value: string,
  minimum: number,
  set: (options: CliOptions, parsed: number) => CliOptions,
): CliParse => {
  const parsed = wholeNumberIn(value, minimum);
  if (parsed === null) {
    return { kind: "invalid_number", flag, value, minimum };
  }
  return { kind: "options", options: set(options, parsed) };
};

const withGames: FlagHandler = (options, value) =>
  withNumber(options, FLAGS.games, value, MIN_GAMES, (current, games) => ({ ...current, games }));

const withSeed: FlagHandler = (options, value) =>
  withNumber(options, FLAGS.seed, value, MIN_SEED, (current, seed) => ({ ...current, seed }));

const withBot: FlagHandler = (options, value) => {
  if (!isBotKind(value)) {
    return { kind: "unknown_bot", value, allowed: BOT_KINDS };
  }
  return { kind: "options", options: { ...options, bot: value } };
};

const withDifficulty: FlagHandler = (options, value) => {
  if (!isDifficulty(value)) {
    return { kind: "unknown_difficulty", value, allowed: DIFFICULTIES };
  }
  return { kind: "options", options: { ...options, difficulty: value } };
};

const withFormat: FlagHandler = (options, value) => {
  if (!isOutputFormat(value)) {
    return { kind: "unknown_format", value, allowed: OUTPUT_FORMATS };
  }
  return { kind: "options", options: { ...options, format: value } };
};

const withOut: FlagHandler = (options, value) => ({
  kind: "options",
  options: { ...options, outputDirectory: value },
});

/**
 * Keyed by flag name rather than searched, so a new entry in `FLAGS` is a compile error here until
 * it has a handler (the `BOT_TABLE` precedent in `bots.ts`), and so the parse loop is a lookup
 * rather than a chain of comparisons.
 */
const FLAG_TABLE: Readonly<Record<FlagName, FlagHandler>> = {
  [FLAGS.games]: withGames,
  [FLAGS.bot]: withBot,
  [FLAGS.difficulty]: withDifficulty,
  [FLAGS.seed]: withSeed,
  [FLAGS.format]: withFormat,
  [FLAGS.out]: withOut,
};

/** `find` over the names rather than an index into the table, so no cast reaches the lookup. */
const flagNameIn = (flag: string): FlagName | null =>
  FLAG_NAMES.find((name) => name === flag) ?? null;

type FlagPair = { readonly flag: string; readonly value: string };

type PairResult =
  | { readonly kind: "pairs"; readonly pairs: readonly FlagPair[] }
  | Extract<CliParse, { readonly kind: "missing_value" }>;

const FLAG_PAIR_LENGTH = 2;
const VALUE_OFFSET = 1;

/**
 * Every flag in the grammar takes a value, so argv is a list of pairs and a trailing flag is the
 * one shape this split can refuse. A switch flag would need a second column in `FLAG_TABLE` and
 * buys nothing the grammar has a use for.
 */
const pairsOf = (argv: readonly string[]): PairResult => {
  const pairs: FlagPair[] = [];
  for (let index = 0; index < argv.length; index += FLAG_PAIR_LENGTH) {
    const flag = argv[index] ?? "";
    const value = argv[index + VALUE_OFFSET];
    if (value === undefined) {
      return { kind: "missing_value", flag };
    }
    pairs.push({ flag, value });
  }
  return { kind: "pairs", pairs };
};

const applyPair = (options: CliOptions, pair: FlagPair): CliParse => {
  const name = flagNameIn(pair.flag);
  if (name === null) {
    return { kind: "unknown_flag", flag: pair.flag };
  }
  if (pair.value.trim().length === 0) {
    return { kind: "empty_value", flag: name };
  }
  return FLAG_TABLE[name](options, pair.value);
};

const longestArgumentIn = (argv: readonly string[]): number =>
  argv.reduce((longest, argument) => Math.max(longest, argument.length), 0);

/**
 * The bound, taken before anything is read or allocated (AGENTS.md section 5). The count is checked
 * first because the length check is the one pass over the arguments that a count refusal avoids.
 */
const boundsRefusalIn = (argv: readonly string[]): CliFailure | null => {
  if (argv.length > LIMITS.maxCliArguments) {
    return {
      kind: "too_many_arguments",
      count: argv.length,
      maxArguments: LIMITS.maxCliArguments,
    };
  }
  const length = longestArgumentIn(argv);
  if (length > LIMITS.maxCliArgumentLength) {
    return { kind: "argument_too_long", length, maxLength: LIMITS.maxCliArgumentLength };
  }
  return null;
};

export const parseCliArguments = (argv: readonly string[]): CliParse => {
  const refusal = boundsRefusalIn(argv);
  if (refusal !== null) {
    return refusal;
  }
  const paired = pairsOf(argv);
  if (paired.kind !== "pairs") {
    return paired;
  }
  let options = DEFAULT_OPTIONS;
  for (const pair of paired.pairs) {
    const applied = applyPair(options, pair);
    if (applied.kind !== "options") {
      return applied;
    }
    options = applied.options;
  }
  return { kind: "options", options };
};
