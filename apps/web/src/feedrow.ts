/**
 * What the report feed shows about a report beyond the report itself (PLAN M6.8): how stale it
 * is, how far its source is trusted, and whose face stands for the source. Pure data in, data out,
 * so the treatments are tested apart from the markup `reportfeed.tsx` draws.
 *
 * **Every input is something the player already has.** Staleness reads `observedAtTurn` against
 * the clock; reliability reads `balance.belief.sourceWeight`, which is public balance data keyed
 * by the visible `source`; the face is seeded from the report's public id with the source as the
 * avatar kind. Nothing reads what a report *is* - there is nothing on a `HunterReport` that says -
 * and nothing reads the hunt's seed, so no row can carry a face correlated with the criminal's
 * profile (PLAN M6.7's note).
 */

import type { HunterReport, ReportSource, Turn } from "@manhunter/core";
import { type Avatar, avatarOf, textSeedOf } from "./avatar";

export type Staleness = "fresh" | "aging" | "stale";

export type Reliability = "high" | "fair" | "low";

export type SourceWeights = Readonly<Record<ReportSource, number>>;

export type FeedRowTheme = {
  /** A report this many turns old or older reads as aging. */
  readonly agingFromAge: number;
  /** A report this many turns old or older reads as stale. */
  readonly staleFromAge: number;
  /** A source weighted at least this reads as high reliability. */
  readonly highFromWeight: number;
  /** A source weighted at least this, and below high, reads as fair. */
  readonly fairFromWeight: number;
};

export type FeedRow = {
  /** Turns since the report was observed, never negative. */
  readonly age: number;
  readonly staleness: Staleness;
  readonly weight: number;
  readonly reliability: Reliability;
  readonly avatar: Avatar;
};

const NONE = 0;

export const ageOf = (report: HunterReport, currentTurn: Turn): number =>
  Math.max(currentTurn - report.observedAtTurn, NONE);

export const stalenessOf = (age: number, theme: FeedRowTheme): Staleness => {
  if (age >= theme.staleFromAge) return "stale";
  if (age >= theme.agingFromAge) return "aging";

  return "fresh";
};

export const reliabilityOf = (weight: number, theme: FeedRowTheme): Reliability => {
  if (weight >= theme.highFromWeight) return "high";
  if (weight >= theme.fairFromWeight) return "fair";

  return "low";
};

/** The source's face for this report: seeded by the report id, drawn as the source's kind. */
export const sourceAvatarOf = (report: HunterReport): Avatar =>
  avatarOf(textSeedOf(report.id), report.source);

export const feedRowOf = (
  report: HunterReport,
  currentTurn: Turn,
  weights: SourceWeights,
  theme: FeedRowTheme,
): FeedRow => {
  const age = ageOf(report, currentTurn);
  const weight = weights[report.source];

  return {
    age,
    staleness: stalenessOf(age, theme),
    weight,
    reliability: reliabilityOf(weight, theme),
    avatar: sourceAvatarOf(report),
  };
};
