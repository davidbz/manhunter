/**
 * What the hunter hears (DESIGN.md "Reports"). A report is late by construction: it records when
 * it was observed and when it lands, and it carries two fields the hunter never sees.
 *
 * Content is structured, never prose. Wording is the UI's job; `core` has no user-facing strings.
 */

import { makeReportId, type NodeId, type ReportId } from "./ids";
import type { TravelMode } from "./map";
import type { Turn } from "./time";

export type ReportSource = "witness" | "cctv" | "tip" | "patrol";

/** Hidden: what the report actually is. Drives scoring of the belief map, never shown. */
export type ReportTruth = "true" | "false" | "prank" | "planted";

/**
 * A sighting whose mode of travel was not made out. Distinct from absence of the field, which
 * `exactOptionalPropertyTypes` would make every consumer handle twice.
 */
export const UNKNOWN_TRAVEL_MODE = "unknown";

export type ReportContent =
  | {
      readonly kind: "sighting";
      readonly nodeId: NodeId;
      readonly travelMode: TravelMode | typeof UNKNOWN_TRAVEL_MODE;
    }
  /** Negative evidence: somewhere looked at, nothing found. The heatmap (PLAN M3.6b) needs it. */
  | { readonly kind: "no_sighting"; readonly nodeId: NodeId };

/**
 * Fields the hunter must never see. Declared as data so that the redaction in `view.ts`
 * (PLAN M3.2) and the type it produces cannot drift apart.
 */
export const HIDDEN_REPORT_FIELDS = ["truth", "accuracy"] as const;

export type HiddenReportField = (typeof HIDDEN_REPORT_FIELDS)[number];

export type Report = {
  readonly id: ReportId;
  readonly source: ReportSource;
  readonly observedAtTurn: Turn;
  readonly receivedAtTurn: Turn;
  readonly content: ReportContent;
  readonly truth: ReportTruth;
  /** Hidden. How close to the truth this report is, in [0, 1]. */
  readonly accuracy: number;
};

const ACCURACY_MINIMUM = 0;
const ACCURACY_MAXIMUM = 1;

export type ReportInput = {
  readonly id: ReportId;
  readonly source: ReportSource;
  readonly observedAtTurn: Turn;
  /** Turns between observation and delivery. Zero means it arrives the turn it happened. */
  readonly deliveryDelayTurns: Turn;
  readonly content: ReportContent;
  readonly truth: ReportTruth;
  readonly accuracy: number;
};

/**
 * Builds a report from when it was observed and how late it is, which is how every producer
 * thinks about it, and clamps accuracy so no caller can put the meter out of range.
 */
export const makeReport = (input: ReportInput): Report => ({
  id: input.id,
  source: input.source,
  observedAtTurn: input.observedAtTurn,
  receivedAtTurn: input.observedAtTurn + input.deliveryDelayTurns,
  content: input.content,
  truth: input.truth,
  accuracy: Math.min(Math.max(input.accuracy, ACCURACY_MINIMUM), ACCURACY_MAXIMUM),
});

/** The part of `balance.reports` a witness sighting's reliability is built from. */
export type AccuracySettings = {
  readonly baseSightingAccuracy: number;
  readonly trustAccuracyWeight: number;
  readonly minAccuracy: number;
  readonly maxAccuracy: number;
};

/**
 * How far a witness sighting can be trusted. DESIGN.md "Hunter resources": low trust means fewer
 * *and worse* witness reports - this is the worse half, and `actions.ts` is what makes them fewer.
 *
 * `trustFactor` is the hunter's trust as a fraction of its range rather than the meter itself,
 * because the bounds belong to `balance.hunter` and this module reads `balance.reports`.
 * PLAN M3.6 reuses this for the sightings the world produces without being asked.
 */
export const sightingAccuracy = (settings: AccuracySettings, trustFactor: number): number =>
  Math.min(
    Math.max(
      settings.baseSightingAccuracy + settings.trustAccuracyWeight * trustFactor,
      settings.minAccuracy,
    ),
    settings.maxAccuracy,
  );

/** The part of `balance.actions.trueBriefing` that report volume turns on. */
export type VolumeSettings = {
  readonly reportVolumeMultiplier: number;
};

const NO_BRIEFINGS = 0;
const UNBRIEFED_VOLUME = 1;

/**
 * How much more the public comes forward once the hunt has been on the news. DESIGN.md "Media":
 * a briefing buys tips, and pranks are the other half of the same bargain (PLAN M3.6).
 *
 * Flat rather than compounding per briefing: attention the city is already paying cannot be
 * bought twice, and a multiplier raised to the number of briefings would make repeating the one
 * free action the whole game. PLAN M3.6 is where the world's own sightings scale by this too.
 */
export const reportVolumeFactor = (settings: VolumeSettings, briefings: number): number =>
  briefings === NO_BRIEFINGS ? UNBRIEFED_VOLUME : settings.reportVolumeMultiplier;

/** The part of `balance.reports` a prank call's rate is built from. */
export type PrankSettings = {
  readonly basePrankRate: number;
  readonly prankRatePerBriefing: number;
  readonly maxPrankRate: number;
};

/**
 * How often somebody rings in something they invented. DESIGN.md "Reports": the prank rate scales
 * with reward and media attention, and in the MVP the only attention on sale is a briefing.
 *
 * Additive per briefing, unlike `reportVolumeFactor`, and deliberately so: the two are the halves
 * of the same bargain and they are meant to diverge. Going to the press again buys no new public,
 * but it does reach a new crank, so the cost of repeating the free action compounds while its
 * benefit does not. `maxPrankRate` is what stops that running to a phone line of nothing but
 * noise, and it is why this one is safe to let grow.
 */
export const prankRate = (settings: PrankSettings, briefings: number): number =>
  Math.min(
    settings.basePrankRate + settings.prankRatePerBriefing * briefings,
    settings.maxPrankRate,
  );

const REPORT_ID_PREFIX = "report-";

/**
 * The id the next report in a world takes. Reports are only ever appended - `view.ts` filters the
 * list, it never removes from it - so their count is already a deterministic counter and
 * `WorldState` needs no field for one.
 */
export const nextReportId = (reports: readonly Report[]): ReportId =>
  makeReportId(`${REPORT_ID_PREFIX}${reports.length}`);
