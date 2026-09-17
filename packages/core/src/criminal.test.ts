import { describe, expect, it } from "vitest";
import type { CriminalState } from "./criminal";
import { EMPTY_CRIMINAL_KNOWLEDGE, makeCriminalState } from "./criminal";
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
