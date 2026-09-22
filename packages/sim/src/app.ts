/**
 * What `bun run sim` does, minus the platform (PLAN M4.2c): argv in, lines and a status out.
 *
 * Everything with a side effect is injected - the runner that plays the hunts, the writer that
 * bounds an artefact, the renderer that draws a map - so this unit is testable without a disk and
 * `main.ts` stays the one composition root (AGENTS.md "Inversion of control"). It returns the lines
 * it wants printed rather than printing them, which is what keeps `console` and the exit code in
 * `main.ts` alone and lets a test read the whole output as data.
 *
 * It never throws. A bad flag is a `CliParse` refusal, an oversized batch is the runner's own
 * refusal (PLAN M4.2b), an oversized artefact is the writer's, and a filesystem that rejects the
 * write is caught at this boundary and turned into the same kind of result - exceptions are for
 * bugs, and a mistyped `--out` is not one.
 */

import { join } from "node:path";
import { type Balance, type GameLogic, type GameSetup, toHunterView } from "@manhunter/core";
import type { ArtifactResult, ArtifactWriter } from "./artifact";
import type { BatchReport } from "./batch";
import { type CliOptions, parseCliArguments } from "./cli";
import {
  describeBatchRefusal,
  describeCliFailure,
  describeWrite,
  formatBatch,
  isWriteFailure,
  makeBatchReportFileName,
  toBatchJson,
  USAGE_LINES,
  type WriteReport,
} from "./output";
import type { RunnerLogic } from "./runner";
import { type MapSvgLogic, makeMapSvgFileName } from "./svg";

export type SimAppDeps = {
  readonly runner: RunnerLogic;
  /** Only `--out` needs these two: the map SVG is drawn from the first seed's own city. */
  readonly game: GameLogic;
  readonly svg: MapSvgLogic;
  readonly writer: ArtifactWriter;
};

export type SimRequest = {
  readonly argv: readonly string[];
  readonly balance: Balance;
};

/** `failed` is what `main.ts` turns into a non-zero exit code; nothing else reads it. */
export type SimStatus = "ok" | "failed";

export type SimOutcome = {
  readonly status: SimStatus;
  readonly lines: readonly string[];
};

export type SimAppLogic = {
  readonly run: (request: SimRequest) => Promise<SimOutcome>;
};

/**
 * The grid and the deadline are balance rather than flags. DESIGN.md's setup is the difficulty and
 * nothing else the player names, and `balance.map.defaults` and `balance.time.maxTurns` are where
 * PLAN M1.3 put the defaults; a `--columns` flag would be a second place to state them.
 */
const setupFrom = (options: CliOptions, balance: Balance): GameSetup => ({
  map: balance.map.defaults,
  maxTurns: balance.time.maxTurns,
  difficulty: options.difficulty,
});

const NEWLINE = "\n";

/** Why a map SVG is missing: the seed's hunt could not be created, so there is no city to draw. */
const NO_MAP_REASON = "no hunt could be created for that seed";

type PlannedArtifact = {
  readonly fileName: string;
  /** `null` when there is nothing to write, which is a reported outcome and not a silent skip. */
  readonly contents: string | null;
};

const mapSvgOf = (deps: SimAppDeps, options: CliOptions, balance: Balance): string | null => {
  const created = deps.game.create({
    setup: setupFrom(options, balance),
    seed: options.seed,
    balance,
  });
  if (created.kind !== "game") {
    return null;
  }
  return deps.svg.render({ graph: toHunterView(created.world).map });
};

/**
 * Both artefacts PLAN M2.4 left for this task to wire: the run's report, and the city the run's
 * first seed generated. The map costs one extra generation of a map the runner already built and
 * dropped - noise beside a batch of them, and cheaper than threading a graph out of the fold.
 *
 * The report is written as JSON whatever `--format` prints, because a file is read by a program.
 */
const plannedArtifacts = (
  deps: SimAppDeps,
  options: CliOptions,
  balance: Balance,
  report: BatchReport,
): readonly PlannedArtifact[] => [
  {
    fileName: makeBatchReportFileName(options.bot, options.seed),
    contents: toBatchJson(report) + NEWLINE,
  },
  {
    fileName: makeMapSvgFileName(options.seed),
    contents: mapSvgOf(deps, options, balance),
  },
];

const toWriteReport = (path: string, result: ArtifactResult): WriteReport => {
  switch (result.kind) {
    case "written":
      return { kind: "written", path, bytes: result.bytes };
    case "too_large":
      return { kind: "too_large", path, bytes: result.bytes, maxBytes: result.maxBytes };
    default: {
      const unhandled: never = result;
      return { kind: "write_failed", path, reason: JSON.stringify(unhandled) };
    }
  }
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const writeArtifact = async (
  deps: SimAppDeps,
  path: string,
  contents: string | null,
): Promise<WriteReport> => {
  if (contents === null) {
    return { kind: "not_written", path, reason: NO_MAP_REASON };
  }
  try {
    return toWriteReport(path, await deps.writer.write({ path, contents }));
  } catch (error) {
    return { kind: "write_failed", path, reason: reasonOf(error) };
  }
};

const writeAll = (
  deps: SimAppDeps,
  directory: string,
  artifacts: readonly PlannedArtifact[],
): Promise<readonly WriteReport[]> =>
  Promise.all(
    artifacts.map((artifact) =>
      writeArtifact(deps, join(directory, artifact.fileName), artifact.contents),
    ),
  );

export const createSimAppLogic = (deps: SimAppDeps): SimAppLogic => ({
  run: async ({ argv, balance }) => {
    const parsed = parseCliArguments(argv);
    if (parsed.kind !== "options") {
      return { status: "failed", lines: [describeCliFailure(parsed), ...USAGE_LINES] };
    }
    const { options } = parsed;
    const result = deps.runner.run({
      bot: options.bot,
      setup: setupFrom(options, balance),
      seed: options.seed,
      games: options.games,
      balance,
    });
    if (result.kind !== "report") {
      return { status: "failed", lines: [describeBatchRefusal(result)] };
    }
    const printed = formatBatch(result.report, options);
    if (options.outputDirectory === null) {
      return { status: "ok", lines: printed };
    }
    const artifacts = plannedArtifacts(deps, options, balance, result.report);
    const written = await writeAll(deps, options.outputDirectory, artifacts);
    return {
      status: written.some(isWriteFailure) ? "failed" : "ok",
      lines: [...printed, ...written.map(describeWrite)],
    };
  },
});
