/**
 * The fold, over hand-built hunts. Nothing here plays a game: what these assert is that every hunt
 * handed to the fold lands somewhere and only somewhere, that the divisions are over the hunts
 * that started, and that the result survives `JSON.stringify` - PLAN M4.2b's acceptance criteria,
 * separated from the runner so that none of them depends on what a seed happens to play.
 */

import {
  type GameOutcome,
  type GameSetup,
  type HunterAction,
  makeReplay,
  type Replay,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import {
  type BatchAccumulator,
  type BatchReport,
  EMPTY_BATCH,
  type HuntRecord,
  type NotStartedReason,
  toBatchReport,
  withHunt,
} from "./batch";

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

const BRIEFING: readonly HunterAction[] = [{ kind: "true_briefing" }];

const replayOf = (seed: number, turns: number): Replay =>
  makeReplay({ seed, setup: SETUP, actions: Array.from({ length: turns }, () => BRIEFING) });

type PlayedParts = {
  readonly seed: number;
  readonly outcome: GameOutcome;
  readonly turns: number;
  readonly score: number;
};

const played = ({ seed, outcome, turns, score }: PlayedParts): HuntRecord => ({
  kind: "played",
  seed,
  outcome,
  turns,
  score,
  replay: replayOf(seed, turns),
});

const notStarted = (seed: number, reason: NotStartedReason): HuntRecord => ({
  kind: "not_started",
  seed,
  reason,
});

const foldOf = (records: readonly HuntRecord[]): BatchAccumulator =>
  records.reduce(withHunt, EMPTY_BATCH);

const reportOf = (records: readonly HuntRecord[]): BatchReport => toBatchReport(foldOf(records));

const countedOutcomes = (report: BatchReport): number =>
  Object.values(report.outcomes).reduce((sum, count) => sum + count, 0);

const countedStarts = (report: BatchReport): number =>
  Object.values(report.notStarted).reduce((sum, count) => sum + count, 0);

const ESCAPED: PlayedParts = {
  seed: 1,
  outcome: { kind: "escaped", turn: 5 },
  turns: 5,
  score: 40,
};
const CAPTURED: PlayedParts = {
  seed: 2,
  outcome: { kind: "captured", turn: 9 },
  turns: 9,
  score: 900,
};
const TIMED_OUT: PlayedParts = {
  seed: 3,
  outcome: { kind: "timed_out", turn: 24 },
  turns: 24,
  score: 150,
};

describe("a folded batch", () => {
  it("counts a played hunt in exactly one outcome bucket", () => {
    const report = reportOf([played(ESCAPED)]);

    expect(report.outcomes.escaped).toBe(1);
    expect(countedOutcomes(report)).toBe(1);
    expect(report.played).toBe(1);
  });

  it("counts a hunt that never started as attempted but not played", () => {
    const report = reportOf([notStarted(1, "generation_failed")]);

    expect(report.games).toBe(1);
    expect(report.played).toBe(0);
    expect(report.notStarted.generation_failed).toBe(1);
    expect(countedOutcomes(report)).toBe(0);
  });

  it("leaves no attempted hunt out of the denominator", () => {
    const report = reportOf([
      played(ESCAPED),
      notStarted(2, "deadline_too_long"),
      played(CAPTURED),
      notStarted(4, "generation_failed"),
    ]);

    expect(report.games).toBe(4);
    expect(report.played + countedStarts(report)).toBe(report.games);
    expect(countedOutcomes(report)).toBe(report.played);
  });

  it("rates the endings over the hunts that started", () => {
    const report = reportOf([
      played(ESCAPED),
      played({ ...ESCAPED, seed: 5 }),
      played(CAPTURED),
      played(TIMED_OUT),
      notStarted(6, "generation_failed"),
    ]);

    expect(report.escapeRate).toBe(0.5);
    expect(report.captureRate).toBe(0.25);
  });

  it("averages turns and score over the hunts that started", () => {
    const report = reportOf([
      played(ESCAPED),
      played(TIMED_OUT),
      notStarted(6, "generation_failed"),
    ]);

    expect(report.averageTurns).toBe((5 + 24) / 2);
    expect(report.averageScore).toBe((40 + 150) / 2);
  });

  it("names the best and the worst hunt by score, with the replay that reproduces each", () => {
    const report = reportOf([played(TIMED_OUT), played(CAPTURED), played(ESCAPED)]);

    expect(report.best?.seed).toBe(CAPTURED.seed);
    expect(report.best?.score).toBe(CAPTURED.score);
    expect(report.best?.replay.seed).toBe(CAPTURED.seed);
    expect(report.worst?.seed).toBe(ESCAPED.seed);
    expect(report.worst?.turns).toBe(ESCAPED.turns);
  });

  it("keeps the earlier seed when two hunts score the same", () => {
    const tied: PlayedParts = { ...ESCAPED, seed: 7 };
    const report = reportOf([played(ESCAPED), played(tied)]);

    expect(report.best?.seed).toBe(ESCAPED.seed);
    expect(report.worst?.seed).toBe(ESCAPED.seed);
  });

  it("has no rates and nothing to name before a hunt is folded", () => {
    const report = reportOf([]);

    expect(report).toMatchObject({
      games: 0,
      played: 0,
      escapeRate: 0,
      captureRate: 0,
      averageTurns: 0,
      averageScore: 0,
      best: null,
      worst: null,
    });
    expect(Number.isNaN(report.escapeRate)).toBe(false);
  });

  it("round-trips through JSON", () => {
    const report = reportOf([
      played(ESCAPED),
      played(CAPTURED),
      notStarted(8, "generation_failed"),
    ]);

    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
