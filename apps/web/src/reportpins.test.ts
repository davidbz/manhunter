import {
  type HunterReport,
  makeNodeId,
  makeReportId,
  type ReportSource,
  UNKNOWN_TRAVEL_MODE,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { ageOf, stalenessOf } from "./feedrow";
import { LIMITS } from "./limits";
import {
  lastHeardByNodeOf,
  REPORT_PIN_KINDS,
  type ReportPinKind,
  reportPinsOf,
} from "./reportpins";
import { FEED_ROW_THEME } from "./theme";

/**
 * PLAN M6.6's report pins, on the data. Which reports are pinned, which one a pin stands for, and
 * that the cap holds back the oldest and says how many.
 */

const NOW = 10;
const WINDOW = { maxAge: 5, maxPins: LIMITS.maxReportPins };

const report = (
  id: string,
  kind: ReportPinKind,
  node: string,
  observedAtTurn: number,
  source: ReportSource = "witness",
): HunterReport => ({
  id: makeReportId(id),
  source,
  observedAtTurn,
  receivedAtTurn: observedAtTurn,
  content:
    kind === "sighting"
      ? { kind, nodeId: makeNodeId(node), travelMode: UNKNOWN_TRAVEL_MODE }
      : { kind, nodeId: makeNodeId(node) },
});

const pinsOf = (reports: readonly HunterReport[]) =>
  reportPinsOf(reports, NOW, WINDOW, FEED_ROW_THEME);

describe("which reports are pinned", () => {
  it("pins a report up to the window's age and not past it", () => {
    const pinned = pinsOf([
      report("edge", "sighting", "n-a", NOW - WINDOW.maxAge),
      report("gone", "sighting", "n-b", NOW - WINDOW.maxAge - 1),
    ]);

    expect(pinned.pins.map((pin) => pin.nodeId)).toEqual([makeNodeId("n-a")]);
  });

  it("pins nothing when there are no reports", () => {
    expect(pinsOf([])).toEqual({ pins: [], withheld: 0 });
  });

  it("pins a no-sighting as well as a sighting", () => {
    const kinds = pinsOf([
      report("s", "sighting", "n-a", NOW),
      report("c", "no_sighting", "n-b", NOW),
    ]).pins.map((pin) => pin.kind);

    expect(kinds).toEqual(["sighting", "no_sighting"]);
  });

  it("puts the freshest node first", () => {
    const order = pinsOf([
      report("old", "sighting", "n-old", NOW - 3),
      report("new", "sighting", "n-new", NOW - 1),
    ]).pins.map((pin) => pin.nodeId);

    expect(order).toEqual([makeNodeId("n-new"), makeNodeId("n-old")]);
  });
});

describe("one pin per node", () => {
  it("counts every recent report at the node, and only recent ones", () => {
    const [pin] = pinsOf([
      report("1", "no_sighting", "n-a", NOW - 1),
      report("2", "sighting", "n-a", NOW - 2),
      report("3", "sighting", "n-a", NOW - WINDOW.maxAge - 1),
    ]).pins;

    expect(pin?.count).toBe(2);
  });

  it("stands for the freshest report at the node", () => {
    const [pin] = pinsOf([
      report("older", "sighting", "n-a", NOW - 3, "cctv"),
      report("newer", "no_sighting", "n-a", NOW - 1, "patrol"),
    ]).pins;

    expect(pin).toMatchObject({ kind: "no_sighting", source: "patrol", age: 1 });
  });

  it("lets a sighting stand for the node over a clearance of the same age", () => {
    const [pin] = pinsOf([
      report("clear", "no_sighting", "n-a", NOW - 1, "patrol"),
      report("seen", "sighting", "n-a", NOW - 1, "tip"),
    ]).pins;

    expect(pin).toMatchObject({ kind: "sighting", source: "tip" });
  });
});

describe("a pin's age", () => {
  it("agrees with the feed row on age and staleness", () => {
    const reports = [0, 1, 2, 3, 4, 5].map((age) =>
      report(`r${age}`, "sighting", `n-${age}`, NOW - age),
    );

    for (const pin of pinsOf(reports).pins) {
      const source = reports.find((each) => each.content.nodeId === pin.nodeId);
      if (source === undefined) throw new Error(`no report for ${pin.nodeId}`);
      expect(pin.age).toBe(ageOf(source, NOW));
      expect(pin.staleness).toBe(stalenessOf(ageOf(source, NOW), FEED_ROW_THEME));
    }
  });
});

describe("the pin cap", () => {
  it("keeps the freshest pins and declares the one over the limit it held back", () => {
    const reports = Array.from({ length: LIMITS.maxReportPins + 1 }, (_, index) =>
      report(`r${index}`, "sighting", `n-${index}`, NOW - (index % (WINDOW.maxAge + 1))),
    );
    const oldestAge = WINDOW.maxAge;
    const oldestReported = reports.filter((each) => ageOf(each, NOW) === oldestAge).length;

    const pinned = pinsOf(reports);

    expect(pinned.pins).toHaveLength(LIMITS.maxReportPins);
    expect(pinned.withheld).toBe(1);
    expect(pinned.pins.filter((pin) => pin.age === oldestAge)).toHaveLength(oldestReported - 1);
  });
});

describe("what a pin carries", () => {
  it("names the node, kind, source, age and count, and nothing a report hides", () => {
    const [pin] = pinsOf([report("r", "sighting", "n-a", NOW)]).pins;

    expect(Object.keys(pin ?? {}).sort()).toEqual(
      ["age", "count", "kind", "nodeId", "source", "staleness"].sort(),
    );
  });

  it("lists every kind a report's content can take", () => {
    const every: Readonly<Record<ReportPinKind, true>> = { sighting: true, no_sighting: true };

    expect([...REPORT_PIN_KINDS].sort()).toEqual(Object.keys(every).sort());
  });
});

describe("when each node last heard a report (PLAN M6.10)", () => {
  it("keeps the latest turn a report landed per node, by when it was received", () => {
    const late: HunterReport = {
      ...report("late", "sighting", "n-a", NOW - 4),
      receivedAtTurn: NOW,
    };
    const heard = lastHeardByNodeOf([
      report("early", "no_sighting", "n-a", NOW - 1),
      late,
      report("other", "sighting", "n-b", NOW - 2),
    ]);

    expect(heard.get(makeNodeId("n-a"))).toBe(NOW);
    expect(heard.get(makeNodeId("n-b"))).toBe(NOW - 2);
    expect(heard.size).toBe(2);
  });

  it("hears nothing when there are no reports", () => {
    expect(lastHeardByNodeOf([]).size).toBe(0);
  });
});
