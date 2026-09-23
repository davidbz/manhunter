import { actionCostOf, BALANCE } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { ACTION_KINDS } from "./actionpanel";
import { planCostOf } from "./plancost";

describe("planCostOf", () => {
  it("prices action points and budget from core, exactly", () => {
    for (const kind of ACTION_KINDS) {
      const { actionPoints, budget } = planCostOf(kind, BALANCE);
      expect({ actionPoints, budget }).toEqual(actionCostOf(kind, BALANCE));
    }
  });

  it("signs trust the way core moves it: spent negative, gained positive, CCTV neither", () => {
    expect(planCostOf("roadblock", BALANCE).trust).toBe(-BALANCE.actions.roadblock.trustCost);
    expect(planCostOf("canvass", BALANCE).trust).toBe(-BALANCE.actions.canvass.trustCost);
    expect(planCostOf("pull_cctv", BALANCE).trust).toBe(0);
    expect(planCostOf("true_briefing", BALANCE).trust).toBe(BALANCE.actions.trueBriefing.trustGain);
  });
});
