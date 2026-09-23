/**
 * Recent reports, pinned where they say something happened (PLAN M6.6). Every `HunterReport`'s
 * `content` names a node, a `sighting` and a `no_sighting` alike, so the feed's intel can be put
 * on the map with nothing more than the view already carries.
 *
 * **Only the hunter's own reports, and only the fields the hunter can see.** Everything here reads
 * `source`, `observedAtTurn` and `content` off `HunterReport`, which has no `truth` or `accuracy`
 * to read (architecture rule 4): a pin says "someone reported this here", never "this is where the
 * criminal is". A prank is pinned exactly like a true sighting, because telling them apart is the
 * player's job (DESIGN.md "Reports").
 *
 * Age is the feed's own (`feedrow.ts`'s `ageOf` and `stalenessOf`, keyed to the same thresholds),
 * so a row and its pin always agree on how stale a report is. A node with several recent reports
 * gets one pin standing for the freshest, with the count; at equal age a sighting stands for the
 * node over a clearance, because the claim is what the player has to weigh.
 *
 * The pins drawn are capped (`maxPins`), freshest first, and the number held back is returned
 * rather than hidden - the feed's truncate-and-declare precedent (PLAN M5.4's note): the reports
 * are in-memory data `core` produced, not input crossing a trust boundary.
 */

import type { HunterReport, NodeId, ReportContent, ReportSource, Turn } from "@manhunter/core";
import { ageOf, type FeedRowTheme, type Staleness, stalenessOf } from "./feedrow";

export type ReportPinKind = ReportContent["kind"];

/** Every kind a pin can take, in legend order; `ReportPinKind` is checked against it in tests. */
export const REPORT_PIN_KINDS: readonly ReportPinKind[] = ["sighting", "no_sighting"];

export type ReportPin = {
  readonly nodeId: NodeId;
  readonly kind: ReportPinKind;
  readonly source: ReportSource;
  /** Turns since the freshest report at this node was observed. */
  readonly age: number;
  readonly staleness: Staleness;
  /** Recent reports at this node, the one the pin stands for included. */
  readonly count: number;
};

export type ReportPinWindow = {
  /** A report observed more than this many turns ago is no longer pinned. */
  readonly maxAge: number;
  /** Pins drawn at most; the rest are counted in `withheld`. */
  readonly maxPins: number;
};

export type ReportPinSet = {
  readonly pins: readonly ReportPin[];
  readonly withheld: number;
};

type AgedReport = {
  readonly report: HunterReport;
  readonly age: number;
};

const KIND_PRECEDENCE: Readonly<Record<ReportPinKind, number>> = {
  sighting: 0,
  no_sighting: 1,
};

const freshestFirst = (first: AgedReport, second: AgedReport): number =>
  first.age - second.age ||
  KIND_PRECEDENCE[first.report.content.kind] - KIND_PRECEDENCE[second.report.content.kind];

const pinOf = (aged: AgedReport, staleness: FeedRowTheme): ReportPin => ({
  nodeId: aged.report.content.nodeId,
  kind: aged.report.content.kind,
  source: aged.report.source,
  age: aged.age,
  staleness: stalenessOf(aged.age, staleness),
  count: 1,
});

/** One pin per node that has a report inside the window, freshest node first. */
export const reportPinsOf = (
  reports: readonly HunterReport[],
  currentTurn: Turn,
  window: ReportPinWindow,
  staleness: FeedRowTheme,
): ReportPinSet => {
  const recent = reports
    .map((report) => ({ report, age: ageOf(report, currentTurn) }))
    .filter((aged) => aged.age <= window.maxAge)
    .sort(freshestFirst);
  const byNode = new Map<NodeId, ReportPin>();
  for (const aged of recent) {
    const earlier = byNode.get(aged.report.content.nodeId);
    byNode.set(
      aged.report.content.nodeId,
      earlier === undefined ? pinOf(aged, staleness) : { ...earlier, count: earlier.count + 1 },
    );
  }
  const pins = [...byNode.values()];

  return {
    pins: pins.slice(0, window.maxPins),
    withheld: Math.max(pins.length - window.maxPins, 0),
  };
};

/**
 * The turn each node last had a report land (PLAN M6.10), read off `receivedAtTurn` - when the
 * hunter heard it, which is also what the feed's "new" row is keyed to. The map uses it to tell a
 * pin that just arrived from one that only aged, so the report-arrival motion plays once, on
 * arrival, and a pin and its feed row arrive together.
 */
export const lastHeardByNodeOf = (reports: readonly HunterReport[]): ReadonlyMap<NodeId, Turn> =>
  reports.reduce((heard, report) => {
    const nodeId = report.content.nodeId;
    const earlier = heard.get(nodeId);
    if (earlier === undefined || report.receivedAtTurn > earlier) {
      heard.set(nodeId, report.receivedAtTurn);
    }

    return heard;
  }, new Map<NodeId, Turn>());
