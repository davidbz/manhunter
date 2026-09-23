/**
 * The heatmap and its report pins, as text (PLAN M6.10, closing M5.3b's Inbox entry). The blobs,
 * the contour and the pins are unlabelled SVG - `aria-hidden` on them is refused by Biome's
 * `noAriaHiddenOnFocusable` - so this is the reading a screen reader gets instead: the most
 * suspected districts, strongest first, and the reports pinned on the map, freshest first.
 *
 * **It says only what the heatmap already shows.** Everything is read from the hunter's own
 * `Belief` and `HunterReport`s (architecture rule 4), through the same `beliefHeatOf`, `topTierOf`
 * and `reportPinsOf` the map draws with, so the list and the picture cannot disagree: a district
 * listed is a blob drawn, a district marked top tier is inside the contour, and a report listed
 * is a pin on the plate.
 *
 * **Bounded, and declares what it held back** - the feed's truncate-and-declare rule (PLAN M5.4),
 * because the input is in-memory data `core` produced rather than input crossing a boundary. Each
 * list keeps at most `maxEntries` rows and counts the rest in `withheld`.
 */

import type { Belief, MapNode, NodeId } from "@manhunter/core";
import { beliefHeatOf, type HeatRamp, topTierOf } from "./beliefoverlay";
import type { FeedRowTheme } from "./feedrow";
import { type ReportPin, type ReportPinWindow, reportPinsOf } from "./reportpins";

export type SuspectedDistrict = {
  readonly nodeId: NodeId;
  readonly district: MapNode["districtType"];
  /** The hunter's belief the criminal is here, as a whole percentage. */
  readonly percent: number;
  /** Inside the map's top-tier contour. */
  readonly topTier: boolean;
};

export type SummaryList<Entry> = {
  readonly entries: readonly Entry[];
  /** Entries past the bound, counted rather than listed. */
  readonly withheld: number;
};

export type PinnedReport = ReportPin & {
  readonly district: MapNode["districtType"] | null;
};

export type HeatmapSummary = {
  readonly suspects: SummaryList<SuspectedDistrict>;
  readonly reports: SummaryList<PinnedReport>;
};

export type HeatmapSummaryInput = {
  readonly belief: Belief;
  readonly nodes: readonly MapNode[];
  readonly reports: Parameters<typeof reportPinsOf>[0];
  readonly currentTurn: Parameters<typeof reportPinsOf>[1];
};

export type HeatmapSummaryRules = {
  readonly ramp: HeatRamp;
  readonly contourFrom: number;
  readonly pinWindow: ReportPinWindow;
  readonly staleness: FeedRowTheme;
  /** Rows either list shows at most. */
  readonly maxEntries: number;
};

const PERCENT = 100;

const boundedListOf = <Entry>(
  all: readonly Entry[],
  maxEntries: number,
  alreadyWithheld: number,
): SummaryList<Entry> => {
  const entries = all.slice(0, Math.max(maxEntries, 0));

  return { entries, withheld: all.length - entries.length + alreadyWithheld };
};

const suspectsOf = (
  input: HeatmapSummaryInput,
  rules: HeatmapSummaryRules,
): readonly SuspectedDistrict[] => {
  const heats = beliefHeatOf(input.belief, input.nodes, rules.ramp);
  const topTier = topTierOf(heats, rules.contourFrom);
  const massOf = new Map(input.belief.map((cell) => [cell.nodeId, cell.mass]));
  const orderOf = new Map(input.nodes.map((node, index) => [node.id, index]));
  const districtOf = new Map(input.nodes.map((node) => [node.id, node.districtType]));

  return heats
    .map((heat) => ({ nodeId: heat.nodeId, mass: massOf.get(heat.nodeId) ?? 0 }))
    .sort(
      (first, second) =>
        second.mass - first.mass ||
        (orderOf.get(first.nodeId) ?? 0) - (orderOf.get(second.nodeId) ?? 0),
    )
    .flatMap(({ nodeId, mass }) => {
      const district = districtOf.get(nodeId);
      if (district === undefined) return [];

      return [
        { nodeId, district, percent: Math.round(mass * PERCENT), topTier: topTier.has(nodeId) },
      ];
    });
};

export const heatmapSummaryOf = (
  input: HeatmapSummaryInput,
  rules: HeatmapSummaryRules,
): HeatmapSummary => {
  const districtOf = new Map(input.nodes.map((node) => [node.id, node.districtType]));
  const pinSet = reportPinsOf(input.reports, input.currentTurn, rules.pinWindow, rules.staleness);
  const pinned = pinSet.pins.map((pin) => ({
    ...pin,
    district: districtOf.get(pin.nodeId) ?? null,
  }));

  return {
    suspects: boundedListOf(suspectsOf(input, rules), rules.maxEntries, 0),
    reports: boundedListOf(pinned, rules.maxEntries, pinSet.withheld),
  };
};
