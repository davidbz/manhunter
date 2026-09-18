/**
 * What the hunter hears (DESIGN.md "Reports"). A report is late by construction: it records when
 * it was observed and when it lands, and it carries two fields the hunter never sees.
 *
 * Content is structured, never prose. Wording is the UI's job; `core` has no user-facing strings.
 */

import type { NodeId, ReportId } from "./ids";
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
