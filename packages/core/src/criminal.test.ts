import { describe, expect, it } from "vitest";
import type { CriminalState } from "./criminal";
import { EMPTY_CRIMINAL_KNOWLEDGE, heatFactorOf, makeCriminalState } from "./criminal";
import { makeNodeId } from "./ids";

const START_STAMINA = 100;
const START_CASH = 250;

const input: Omit<CriminalState, "knowledge"> = {
  nodeId: makeNodeId("downtown"),
  travelMode: "foot",
  profile: "amateur",
  stamina: START_STAMINA,
  heat: 0,
  cash: START_CASH,
  desperation: 0,
};

describe("makeCriminalState", () => {
  it("starts the criminal knowing nothing about the hunt", () => {
    expect(makeCriminalState(input).knowledge).toEqual(EMPTY_CRIMINAL_KNOWLEDGE);
  });

  it("keeps every measured value it was given", () => {
    const criminal = makeCriminalState(input);
    expect(criminal.nodeId).toBe(input.nodeId);
    expect(criminal.stamina).toBe(START_STAMINA);
    expect(criminal.cash).toBe(START_CASH);
    expect(criminal.profile).toBe("amateur");
  });

  it("round-trips through JSON (architecture rule 3)", () => {
    const criminal = makeCriminalState(input);
    expect(JSON.parse(JSON.stringify(criminal))).toEqual(criminal);
  });
});

describe("heatFactorOf", () => {
  const bounds = { heatMax: 100 };

  it("reads how recognisable the criminal is as a fraction of the meter", () => {
    expect(heatFactorOf(bounds, 0)).toBe(0);
    expect(heatFactorOf(bounds, bounds.heatMax)).toBe(1);
    expect(heatFactorOf(bounds, bounds.heatMax / 4)).toBeCloseTo(0.25);
  });

  it("never reads outside the meter, whatever it is handed", () => {
    expect(heatFactorOf(bounds, bounds.heatMax * 3)).toBe(1);
    expect(heatFactorOf(bounds, -bounds.heatMax)).toBe(0);
  });
});
