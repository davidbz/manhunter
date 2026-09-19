import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { makeNodeId, makeReportId } from "./ids";
import type { Report, ReportInput } from "./report";
import {
  HIDDEN_REPORT_FIELDS,
  makeReport,
  nextReportId,
  prankRate,
  reportVolumeFactor,
  sightingAccuracy,
  UNKNOWN_TRAVEL_MODE,
} from "./report";

const OBSERVED_AT = 4;
const CCTV_DELAY = 2;
const ACCURACY = 0.8;

const sightingInput: ReportInput = {
  id: makeReportId("report-1"),
  source: "cctv",
  observedAtTurn: OBSERVED_AT,
  deliveryDelayTurns: CCTV_DELAY,
  content: { kind: "sighting", nodeId: makeNodeId("downtown"), travelMode: UNKNOWN_TRAVEL_MODE },
  truth: "true",
  accuracy: ACCURACY,
};

describe("makeReport", () => {
  it("delivers a report later than it was observed", () => {
    const report = makeReport(sightingInput);
    expect(report.observedAtTurn).toBe(OBSERVED_AT);
    expect(report.receivedAtTurn).toBe(OBSERVED_AT + CCTV_DELAY);
  });

  it("delivers immediately when there is no delay", () => {
    const report = makeReport({ ...sightingInput, deliveryDelayTurns: 0 });
    expect(report.receivedAtTurn).toBe(OBSERVED_AT);
  });

  test.prop([fc.double({ noNaN: true, noDefaultInfinity: true })])(
    "clamps accuracy into [0, 1]",
    (accuracy) => {
      const report = makeReport({ ...sightingInput, accuracy });
      expect(report.accuracy).toBeGreaterThanOrEqual(0);
      expect(report.accuracy).toBeLessThanOrEqual(1);
    },
  );

  it("round-trips through JSON (architecture rule 3)", () => {
    const report = makeReport({
      ...sightingInput,
      content: { kind: "no_sighting", nodeId: makeNodeId("park") },
    });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe("HIDDEN_REPORT_FIELDS", () => {
  it("names fields that a report actually carries", () => {
    const report: Report = makeReport(sightingInput);
    for (const field of HIDDEN_REPORT_FIELDS) {
      expect(report).toHaveProperty(field);
    }
  });

  it("leaves a usable report once removed, which is what the hunter sees", () => {
    const { truth: _truth, accuracy: _accuracy, ...redacted } = makeReport(sightingInput);
    expect(Object.keys(redacted).sort()).toEqual([
      "content",
      "id",
      "observedAtTurn",
      "receivedAtTurn",
      "source",
    ]);
  });
});

describe("sightingAccuracy", () => {
  const settings = {
    baseSightingAccuracy: 0.4,
    trustAccuracyWeight: 0.4,
    minAccuracy: 0.1,
    maxAccuracy: 0.95,
  };

  it("is the base reliability at no standing, and the base plus the weight at full", () => {
    expect(sightingAccuracy(settings, 0)).toBeCloseTo(settings.baseSightingAccuracy);
    expect(sightingAccuracy(settings, 1)).toBeCloseTo(
      settings.baseSightingAccuracy + settings.trustAccuracyWeight,
    );
  });

  it("rises with the hunter's standing", () => {
    expect(sightingAccuracy(settings, 0.25)).toBeLessThan(sightingAccuracy(settings, 0.75));
  });

  it("stays inside the range whatever the settings say", () => {
    const generous = { ...settings, baseSightingAccuracy: 2 };
    const stingy = { ...settings, baseSightingAccuracy: -2, trustAccuracyWeight: 0 };

    expect(sightingAccuracy(generous, 1)).toBe(settings.maxAccuracy);
    expect(sightingAccuracy(stingy, 1)).toBe(settings.minAccuracy);
  });
});

describe("reportVolumeFactor", () => {
  const settings = { reportVolumeMultiplier: 1.5 };

  it("leaves the volume alone until the hunt has been on the news", () => {
    expect(reportVolumeFactor(settings, 0)).toBe(1);
  });

  it("raises it by the briefing's multiplier once it has", () => {
    expect(reportVolumeFactor(settings, 1)).toBe(settings.reportVolumeMultiplier);
  });

  /** Attention the city is already paying cannot be bought twice (PLAN M3.4b). */
  it("does not compound, however many briefings are given", () => {
    expect(reportVolumeFactor(settings, 2)).toBe(settings.reportVolumeMultiplier);
    expect(reportVolumeFactor(settings, 10)).toBe(settings.reportVolumeMultiplier);
  });
});

describe("prankRate", () => {
  const settings = { basePrankRate: 0.05, prankRatePerBriefing: 0.04, maxPrankRate: 0.4 };

  it("rings a little even with the hunt off the news", () => {
    expect(prankRate(settings, 0)).toBe(settings.basePrankRate);
  });

  /** The half of the bargain `reportVolumeFactor` does not make: attention buys cranks too. */
  it("rises with every briefing given, unlike the volume it comes with", () => {
    expect(prankRate(settings, 1)).toBeCloseTo(
      settings.basePrankRate + settings.prankRatePerBriefing,
    );
    expect(prankRate(settings, 2)).toBeGreaterThan(prankRate(settings, 1));
  });

  it("never fills the feed, however many briefings are given", () => {
    expect(prankRate(settings, 100)).toBe(settings.maxPrankRate);
  });
});

describe("nextReportId", () => {
  it("counts from zero and never repeats itself as reports are appended", () => {
    const first = nextReportId([]);
    const one = makeReport({ ...sightingInput, id: first });

    expect(first).toBe("report-0");
    expect(nextReportId([one])).toBe("report-1");
    expect(nextReportId([one, one])).toBe("report-2");
  });
});
