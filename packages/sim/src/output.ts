/**
 * Everything `bun run sim` prints (PLAN M4.2c), and the shapes it prints.
 *
 * Presentation, so it lives in `sim` rather than `core` for the reason `svg.ts` does: `core` holds
 * no user-facing strings (architecture rule 1). Bare functions over data with no collaborators, so
 * no factory - the `batch.ts` precedent. Nothing here writes a line; it returns them, and `main.ts`
 * is the one place that owns a `console`.
 *
 * Two formats, because a batch report has two audiences. `text` is for the person reading a hunt
 * they just ran; `json` is `BatchReport` verbatim, so anything that parses gets the fold's own
 * shape back rather than a second one invented for the wire.
 */

import { encodeReplay, type Replay } from "@manhunter/core";
import type { BatchReport, HuntHighlight } from "./batch";
import { BOT_KINDS } from "./bots/bots";
import {
  type CliFailure,
  type CliOptions,
  DIFFICULTIES,
  FLAG_NAMES,
  FLAGS,
  OUTPUT_FORMATS,
  type OutputFormat,
} from "./cli";
import type { BatchResult } from "./runner";

const INDENT = "  ";

/** Rates read as percentages to a tenth; averages keep two decimals, as a mean of turns needs. */
const PERCENT = 100;
const RATE_DECIMALS = 1;
const AVERAGE_DECIMALS = 2;

/** `JSON.stringify` indentation. Two spaces, the same as everything else this repo formats. */
const JSON_INDENT = 2;

const listed = (values: readonly string[]): string => values.join(", ");

/** Where a usage description starts, so every flag's explanation lines up in one column. */
const USAGE_COLUMN = 20;

const usageLine = (flag: string, argument: string, description: string): string =>
  `${INDENT}${`${flag} ${argument}`.padEnd(USAGE_COLUMN)}${description}`;

export const USAGE_LINES: readonly string[] = [
  `usage: bun run sim -- [${FLAG_NAMES.join("] [")}]`,
  usageLine(FLAGS.games, "N", "hunts to play, counting up from the first seed"),
  usageLine(FLAGS.bot, "NAME", `one of ${listed(BOT_KINDS)}`),
  usageLine(FLAGS.difficulty, "NAME", `one of ${listed(DIFFICULTIES)}`),
  usageLine(FLAGS.seed, "N", "first seed of the run"),
  usageLine(FLAGS.format, "NAME", `one of ${listed(OUTPUT_FORMATS)}`),
  usageLine(FLAGS.out, "DIR", "directory to write the batch report and the map SVG into"),
];

/**
 * One line for one refusal. An exhaustive `switch` with a `never` default (AGENTS.md "Code style"),
 * so a new `CliParse` variant is a compile error here rather than a refusal that prints nothing.
 */
export const describeCliFailure = (failure: CliFailure): string => {
  switch (failure.kind) {
    case "too_many_arguments":
      return `too many arguments: ${failure.count}, and at most ${failure.maxArguments} are read`;
    case "argument_too_long":
      return `argument too long: ${failure.length} characters, and at most ${failure.maxLength} are read`;
    case "unknown_flag":
      return `unknown flag ${failure.flag}: expected one of ${listed(FLAG_NAMES)}`;
    case "missing_value":
      return `${failure.flag} needs a value`;
    case "empty_value":
      return `${failure.flag} was given an empty value`;
    case "invalid_number":
      return `${failure.flag} needs a whole number of at least ${failure.minimum}, not "${failure.value}"`;
    case "unknown_bot":
      return `unknown bot "${failure.value}": expected one of ${listed(failure.allowed)}`;
    case "unknown_difficulty":
      return `unknown difficulty "${failure.value}": expected one of ${listed(failure.allowed)}`;
    case "unknown_format":
      return `unknown format "${failure.value}": expected one of ${listed(failure.allowed)}`;
    default: {
      const unhandled: never = failure;
      return `unrecognised refusal: ${JSON.stringify(unhandled)}`;
    }
  }
};

/**
 * The runner's own refusal, surfaced rather than restated. PLAN M4.2b already checks `--games`
 * against `LIMITS.maxGamesPerRun` before it creates a hunt and returns both numbers, so the CLI
 * has nothing to decide here - only a sentence to put around it.
 */
export const describeBatchRefusal = (
  refusal: Exclude<BatchResult, { readonly kind: "report" }>,
): string =>
  `${FLAGS.games} ${refusal.requestedGames} is over the limit: at most ${refusal.maxGames} hunts in one run`;

/** What one artefact write came to. Data, so `app.ts` produces it and this module reads it. */
export type WriteReport =
  | { readonly kind: "written"; readonly path: string; readonly bytes: number }
  | {
      readonly kind: "too_large";
      readonly path: string;
      readonly bytes: number;
      readonly maxBytes: number;
    }
  | { readonly kind: "write_failed"; readonly path: string; readonly reason: string }
  | { readonly kind: "not_written"; readonly path: string; readonly reason: string };

export const describeWrite = (report: WriteReport): string => {
  switch (report.kind) {
    case "written":
      return `wrote ${report.path} (${report.bytes} bytes)`;
    case "too_large":
      return `did not write ${report.path}: ${report.bytes} bytes, and at most ${report.maxBytes} are allowed`;
    case "write_failed":
    case "not_written":
      return `did not write ${report.path}: ${report.reason}`;
    default: {
      const unhandled: never = report;
      return `unrecognised write: ${JSON.stringify(unhandled)}`;
    }
  }
};

export const isWriteFailure = (report: WriteReport): boolean => report.kind !== "written";

const percentage = (rate: number): string => `${(rate * PERCENT).toFixed(RATE_DECIMALS)}%`;

const countLines = (counts: Readonly<Record<string, number>>): readonly string[] =>
  Object.entries(counts).map(([key, count]) => `${INDENT}${key}: ${count}`);

/**
 * A shareable link for the hunt, or the reason there is none. `encodeReplay` is bounded and can
 * refuse (PLAN M3.9), and a report that dropped the refusal would show an empty line instead.
 */
const replayLinkOf = (replay: Replay): string => {
  const encoded = encodeReplay(replay);
  if (encoded.kind !== "replay_string") {
    return `unavailable (${encoded.kind})`;
  }
  return encoded.value;
};

const LAST_SEED_OFFSET = 1;

const highlightLines = (label: string, highlight: HuntHighlight | null): readonly string[] => {
  if (highlight === null) {
    return [`${label}: none`];
  }
  return [
    `${label}: seed ${highlight.seed}, score ${highlight.score}, ` +
      `${highlight.outcome.kind} after ${highlight.turns} turns`,
    `${INDENT}replay: ${replayLinkOf(highlight.replay)}`,
  ];
};

/**
 * The report a person reads. The run's own parameters lead it because `BatchReport` does not carry
 * them - it is the fold of the hunts, not the request - and a report with no bot name on it cannot
 * be compared with the one beside it.
 */
export const formatBatchReport = (report: BatchReport, options: CliOptions): readonly string[] => [
  `bot: ${options.bot}`,
  `difficulty: ${options.difficulty}`,
  `seeds: ${options.seed}-${options.seed + report.games - LAST_SEED_OFFSET}`,
  `games: ${report.games}`,
  `played: ${report.played}`,
  "not started:",
  ...countLines(report.notStarted),
  "outcomes:",
  ...countLines(report.outcomes),
  `capture rate: ${percentage(report.captureRate)}`,
  `escape rate: ${percentage(report.escapeRate)}`,
  `average turns: ${report.averageTurns.toFixed(AVERAGE_DECIMALS)}`,
  `average score: ${report.averageScore.toFixed(AVERAGE_DECIMALS)}`,
  ...highlightLines("best", report.best),
  ...highlightLines("worst", report.worst),
];

/** `BatchReport` verbatim, so the JSON a run prints parses back into the type the fold produced. */
export const toBatchJson = (report: BatchReport): string =>
  JSON.stringify(report, null, JSON_INDENT);

export const formatBatchJson = (report: BatchReport): readonly string[] =>
  toBatchJson(report).split("\n");

/**
 * Keyed by format rather than branched, so a third `OutputFormat` is a compile error here until it
 * has a formatter (the `BOT_TABLE` precedent in `bots.ts`).
 */
const FORMAT_TABLE: Readonly<
  Record<OutputFormat, (report: BatchReport, options: CliOptions) => readonly string[]>
> = {
  text: formatBatchReport,
  json: (report) => formatBatchJson(report),
};

export const formatBatch = (report: BatchReport, options: CliOptions): readonly string[] =>
  FORMAT_TABLE[options.format](report, options);

/**
 * The file a run writes its report to. The bot is a closed set and the seed is a number, so no
 * path separator can reach the name - the same argument `makeMapSvgFileName` makes in `svg.ts`.
 */
export const makeBatchReportFileName = (bot: string, seed: number): string =>
  `batch-${bot}-${seed}.json`;
