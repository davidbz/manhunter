import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { makeNodeId, makeReportId } from "./ids";
import type { Report, ReportInput } from "./report";
import { HIDDEN_REPORT_FIELDS, makeReport, UNKNOWN_TRAVEL_MODE } from "./report";

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
