/**
 * What a batch of hunts adds up to (PLAN M4.2b): the data a run produces, and the fold that builds
 * it one hunt at a time.
 *
 * It is a fold rather than a pass over a list of results because a run may be `maxGamesPerRun`
 * hunts long and a finished hunt is not small - it carries its own replay. Folding as each hunt
 * ends keeps the memory a run needs flat in the number of games: the accumulator holds counts, two
 * running sums, and the two hunts it has singled out.
 *
 * Everything here is plain serializable data and bare functions over it (AGENTS.md engineering
 * principle 1). No collaborators, so no factory - the `outcomeAfter` and `makeReplay` precedent in
 * `core`.
 */

import type { GameOutcome, GameResult, Replay } from "@manhunter/core";

/**
 * Why a hunt never started, derived from `GameResult` so a new refusal in `core` is a compile
 * error here rather than a hunt that quietly leaves the denominator.
 */
export type NotStartedReason = Exclude<GameResult["kind"], "game">;

export type OutcomeKind = GameOutcome["kind"];

/**
 * One hunt, as the runner leaves it. A hunt that never started carries its reason instead of an
 * outcome: it played no turns, so it has no turns, no score and no replay, and counting it as one
 * of the endings would say the hunt ran and ended that way.
 */
export type HuntRecord =
  | {
      readonly kind: "played";
      readonly seed: number;
      readonly outcome: GameOutcome;
      /** Turns the hunt lasted, which is `outcome.turn` for a settled one (PLAN M3.8c). */
      readonly turns: number;
      readonly score: number;
      readonly replay: Replay;
    }
  | {
      readonly kind: "not_started";
      readonly seed: number;
      readonly reason: NotStartedReason;
    };

/**
 * A hunt the report singles out, with the replay that reproduces it. The seed and the bot would
 * reproduce it too, so the replay is not what makes the hunt findable - it is what lets PLAN
 * M4.2c hand one over as a link, and what proves the run recorded the queues it actually played.
 */
export type HuntHighlight = {
  readonly seed: number;
  readonly score: number;
  readonly outcome: GameOutcome;
  readonly turns: number;
  readonly replay: Replay;
};

/**
 * One run, folded. `games` is every seed the run attempted and `played` is the hunts that started,
 * so `played` plus every `notStarted` count is `games` and nothing the run did can go missing.
 *
 * Rates and averages are over `played`, not over `games`: a config whose maps cannot be generated
 * says so in `notStarted`, and dividing by seeds that never became hunts would quietly dilute
 * every rate beside it.
 */
export type BatchReport = {
  readonly games: number;
  readonly played: number;
  readonly notStarted: Readonly<Record<NotStartedReason, number>>;
  /** Every ending, counted. The loss reasons are the losing rows; they need no separate field. */
  readonly outcomes: Readonly<Record<OutcomeKind, number>>;
  readonly escapeRate: number;
  readonly captureRate: number;
  readonly averageTurns: number;
  readonly averageScore: number;
  readonly best: HuntHighlight | null;
  readonly worst: HuntHighlight | null;
};

/** The running total a run folds into. Sums rather than averages, so the division happens once. */
export type BatchAccumulator = {
  readonly games: number;
  readonly played: number;
  readonly notStarted: Readonly<Record<NotStartedReason, number>>;
  readonly outcomes: Readonly<Record<OutcomeKind, number>>;
  readonly turns: number;
  readonly score: number;
  readonly best: HuntHighlight | null;
  readonly worst: HuntHighlight | null;
};

/**
 * Both count tables are written out in full rather than derived from their key type, because a
 * total record literal is what makes a new `GameOutcome` variant or a new `GameResult` refusal a
 * compile error here. `Object.fromEntries` would build the same table and lose that.
 */
const NO_STARTS: Readonly<Record<NotStartedReason, number>> = {
  deadline_too_long: 0,
  generation_failed: 0,
};

const NO_OUTCOMES: Readonly<Record<OutcomeKind, number>> = {
  in_progress: 0,
  captured: 0,
  escaped: 0,
  trust_collapsed: 0,
  casualties_exceeded: 0,
  timed_out: 0,
};

export const EMPTY_BATCH: BatchAccumulator = {
  games: 0,
  played: 0,
  notStarted: NO_STARTS,
  outcomes: NO_OUTCOMES,
  turns: 0,
  score: 0,
  best: null,
  worst: null,
};

const counted = <Key extends string>(
  counts: Readonly<Record<Key, number>>,
  key: Key,
): Readonly<Record<Key, number>> => ({ ...counts, [key]: counts[key] + 1 });

const highlightOf = (record: Extract<HuntRecord, { kind: "played" }>): HuntHighlight => ({
  seed: record.seed,
  score: record.score,
  outcome: record.outcome,
  turns: record.turns,
  replay: record.replay,
});

/**
 * Strictly better and strictly worse, so a tie keeps the hunt that was already there and the
 * lowest seed of an equal-scoring pair is the one named. Without that the report would depend on
 * which hunt the fold happened to reach first, which is the seed order - the same order every
 * time, but for no stated reason.
 */
const isBetter = (candidate: HuntHighlight, incumbent: HuntHighlight | null): boolean =>
  incumbent === null || candidate.score > incumbent.score;

const isWorse = (candidate: HuntHighlight, incumbent: HuntHighlight | null): boolean =>
  incumbent === null || candidate.score < incumbent.score;

export const withHunt = (accumulator: BatchAccumulator, record: HuntRecord): BatchAccumulator => {
  const games = accumulator.games + 1;
  if (record.kind === "not_started") {
    return { ...accumulator, games, notStarted: counted(accumulator.notStarted, record.reason) };
  }
  const highlight = highlightOf(record);
  return {
    ...accumulator,
    games,
    played: accumulator.played + 1,
    outcomes: counted(accumulator.outcomes, record.outcome.kind),
    turns: accumulator.turns + record.turns,
    score: accumulator.score + record.score,
    best: isBetter(highlight, accumulator.best) ? highlight : accumulator.best,
    worst: isWorse(highlight, accumulator.worst) ? highlight : accumulator.worst,
  };
};

/** A run that played nothing has no rates rather than `NaN` ones: `0 / 0` is not a rate. */
const perHunt = (total: number, played: number): number => (played === 0 ? 0 : total / played);

export const toBatchReport = (accumulator: BatchAccumulator): BatchReport => ({
  games: accumulator.games,
  played: accumulator.played,
  notStarted: accumulator.notStarted,
  outcomes: accumulator.outcomes,
  escapeRate: perHunt(accumulator.outcomes.escaped, accumulator.played),
  captureRate: perHunt(accumulator.outcomes.captured, accumulator.played),
  averageTurns: perHunt(accumulator.turns, accumulator.played),
  averageScore: perHunt(accumulator.score, accumulator.played),
  best: accumulator.best,
  worst: accumulator.worst,
});
