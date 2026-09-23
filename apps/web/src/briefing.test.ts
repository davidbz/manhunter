import { BALANCE } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { BRIEFING_ITEM_KINDS, briefingOf } from "./briefing";

describe("the case briefing", () => {
  it("states every item once, in order", () => {
    expect(briefingOf(BALANCE).map((item) => item.kind)).toEqual([...BRIEFING_ITEM_KINDS]);
  });

  it("reads its numbers from the balance rather than restating them", () => {
    const byKind = new Map(briefingOf(BALANCE).map((item) => [item.kind, item.detail]));

    expect(byKind.get("objective")).toContain(String(BALANCE.map.defaults.exitCount));
    expect(byKind.get("deadline")).toContain(String(BALANCE.time.maxTurns));
    expect(byKind.get("casualties")).toContain(String(BALANCE.endConditions.casualtiesToLose));
    expect(byKind.get("trust")).toContain(String(BALANCE.hunter.startingTrust));
    expect(byKind.get("trust")).toContain(String(BALANCE.endConditions.trustCollapseAt));
    expect(byKind.get("resources")).toContain(String(BALANCE.hunter.startingBudget));
    expect(byKind.get("resources")).toContain(String(BALANCE.hunter.actionPointsPerTurn));
  });

  it("gives every item a title and some words", () => {
    for (const item of briefingOf(BALANCE)) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
    }
  });
});
