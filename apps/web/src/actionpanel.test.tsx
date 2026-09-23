import { BALANCE, type HunterActionKind, makeEdgeId, targetKindOf } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { type ActionTarget, GLOBAL_TARGET } from "./actiondraft";
import { ACTION_ICON_TEST_ID } from "./actionicon";
import {
  ACTION_COST_CHIP_TEST_ID,
  ACTION_COST_TEST_ID,
  ACTION_DRAFT_TEST_ID,
  ACTION_KEYCAP_TEST_ID,
  ACTION_KINDS,
  ACTION_OPTION_TEST_ID,
  ACTION_PANEL_TEST_ID,
  ACTION_TARGET_PROMPTS,
  ACTION_UNAFFORDABLE_TEST_ID,
  ActionPanel,
  type ActionPanelProps,
  actionKeyOf,
  actionKindOfKey,
  actionOptionsOf,
  COST_CHIP_KINDS,
  costChipsOf,
  costLabel,
} from "./actionpanel";
import type { PlaceNames } from "./placenames";
import { planCostOf } from "./plancost";

/**
 * The presentational half of PLAN M5.5a. Nothing here touches a store: the board is a pure
 * function of the options it is given, and every price on it comes from `core`.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const RICH = { actionPoints: 3, budget: 1000 };
const BROKE = { actionPoints: 0, budget: 0 };

const EDGE_TARGET: ActionTarget = { kind: "edge", edgeId: makeEdgeId("e-1-2-h") };

const NAMES: PlaceNames = {
  nodes: {},
  edges: { "e-1-2-h": "Harbor St" },
  avenues: [],
  streets: [],
};

let root: Root | null = null;
let container: HTMLElement | null = null;

const armedKinds: HunterActionKind[] = [];

const defaultProps: ActionPanelProps = {
  options: actionOptionsOf(BALANCE, RICH),
  armed: null,
  onArm: (kind) => armedKinds.push(kind),
  target: null,
  draft: null,
  placeNames: NAMES,
};

const render = async (props: Partial<ActionPanelProps> = {}): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(<ActionPanel {...defaultProps} {...props} />);
  });
};

const optionFor = (kind: HunterActionKind): HTMLElement | null =>
  container?.querySelector(`[data-testid="${ACTION_OPTION_TEST_ID}"][data-action="${kind}"]`) ??
  null;

const draftLine = (): HTMLElement | null =>
  container?.querySelector(`[data-testid="${ACTION_DRAFT_TEST_ID}"]`) ?? null;

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
  armedKinds.length = 0;
});

describe("the action options", () => {
  it("prices every MVP action from core, never from a literal here", () => {
    for (const option of actionOptionsOf(BALANCE, RICH)) {
      expect(option.cost).toEqual(planCostOf(option.kind, BALANCE));
      expect(option.targetKind).toBe(targetKindOf(option.kind));
    }
  });

  it("offers DESIGN.md's MVP subset and nothing else", () => {
    expect(actionOptionsOf(BALANCE, RICH).map((option) => option.kind)).toEqual(ACTION_KINDS);
    expect(ACTION_KINDS).toHaveLength(4);
  });

  it("calls an action affordable only when both meters cover it", () => {
    const rich = actionOptionsOf(BALANCE, RICH);
    const broke = actionOptionsOf(BALANCE, BROKE);

    expect(rich.every((option) => option.affordable)).toBe(true);
    expect(broke.some((option) => option.affordable)).toBe(false);
  });

  it("refuses an action the budget alone cannot cover", () => {
    const cost = planCostOf("roadblock", BALANCE);
    const options = actionOptionsOf(BALANCE, {
      actionPoints: cost.actionPoints,
      budget: cost.budget - 1,
    });

    expect(options.find((option) => option.kind === "roadblock")?.affordable).toBe(false);
  });
});

describe("the action panel", () => {
  it("draws one button per MVP action, priced", async () => {
    await render();

    expect(container?.querySelectorAll(`[data-testid="${ACTION_PANEL_TEST_ID}"]`)).toHaveLength(1);
    expect(container?.querySelectorAll(`[data-testid="${ACTION_OPTION_TEST_ID}"]`)).toHaveLength(
      ACTION_KINDS.length,
    );
    expect(
      optionFor("roadblock")?.querySelector(`[data-testid="${ACTION_COST_TEST_ID}"]`)?.textContent,
    ).toBe(costLabel(planCostOf("roadblock", BALANCE)));
  });

  it("reports the target kind core names, so the map can be narrowed by it", async () => {
    await render();

    for (const kind of ACTION_KINDS) {
      expect(optionFor(kind)?.getAttribute("data-target")).toBe(targetKindOf(kind));
    }
  });

  it("arms the action that was clicked", async () => {
    await render();

    await act(async () => {
      optionFor("canvass")?.click();
    });

    expect(armedKinds).toEqual(["canvass"]);
  });

  it("marks the armed action and no other", async () => {
    await render({ armed: "pull_cctv" });

    expect(optionFor("pull_cctv")?.getAttribute("aria-pressed")).toBe("true");
    expect(optionFor("canvass")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("disables an action the hunter cannot afford rather than hiding it", async () => {
    await render({ options: actionOptionsOf(BALANCE, BROKE) });

    expect(optionFor("roadblock")).not.toBeNull();
    expect((optionFor("roadblock") as HTMLButtonElement).disabled).toBe(true);
    expect(optionFor("roadblock")?.getAttribute("data-affordable")).toBe("false");
  });

  it("asks for nothing while no action is armed", async () => {
    await render();

    expect(draftLine()?.getAttribute("data-ready")).toBe("false");
  });

  it("asks for the target the armed action takes", async () => {
    await render({ armed: "roadblock" });

    expect(draftLine()?.textContent).toBe(ACTION_TARGET_PROMPTS.edge);
    expect(draftLine()?.getAttribute("data-ready")).toBe("false");
  });

  it("reads as ready once the armed action has a target it accepts", async () => {
    await render({
      armed: "roadblock",
      target: EDGE_TARGET,
      draft: { kind: "roadblock", edgeId: makeEdgeId("e-1-2-h") },
    });

    expect(draftLine()?.getAttribute("data-ready")).toBe("true");
    expect(draftLine()?.textContent).toContain("Harbor St");
    expect(draftLine()?.textContent).not.toContain("e-1-2-h");
  });

  it("reads as ready the moment a global action is armed", async () => {
    await render({
      armed: "true_briefing",
      target: GLOBAL_TARGET,
      draft: { kind: "true_briefing" },
    });

    expect(draftLine()?.getAttribute("data-ready")).toBe("true");
  });
});

describe("the action tiles (PLAN M6.8)", () => {
  const chipOf = (kind: HunterActionKind, chip: string): Element | null =>
    optionFor(kind)?.querySelector(
      `[data-testid="${ACTION_COST_CHIP_TEST_ID}"][data-chip="${chip}"]`,
    ) ?? null;

  it("splits the price into one chip per resource that still reads as the cost label", () => {
    const cost = planCostOf("roadblock", BALANCE);

    expect(costChipsOf(cost).map((chip) => chip.kind)).toEqual(COST_CHIP_KINDS);
    expect(
      costChipsOf(cost)
        .map((chip) => chip.text)
        .join(", "),
    ).toBe(costLabel(cost));
  });

  it("draws a stencil icon on every tile, for its own action", async () => {
    await render();

    for (const kind of ACTION_KINDS) {
      const icon = optionFor(kind)?.querySelector(`[data-testid="${ACTION_ICON_TEST_ID}"]`);
      expect(icon?.getAttribute("data-icon")).toBe(kind);
    }
  });

  it("marks only the resource that falls short", async () => {
    const cost = planCostOf("roadblock", BALANCE);
    await render({
      options: actionOptionsOf(BALANCE, {
        actionPoints: cost.actionPoints,
        budget: cost.budget - 1,
      }),
    });

    expect(chipOf("roadblock", "budget")?.getAttribute("data-short")).toBe("true");
    expect(chipOf("roadblock", "action_points")?.getAttribute("data-short")).toBe("false");
  });

  it("says in words that an unaffordable action cannot be afforded, and says nothing otherwise", async () => {
    await render({ options: actionOptionsOf(BALANCE, BROKE) });

    for (const kind of ACTION_KINDS) {
      expect(
        optionFor(kind)?.querySelector(`[data-testid="${ACTION_UNAFFORDABLE_TEST_ID}"]`),
      ).not.toBeNull();
    }
  });

  it("puts no unaffordable line on a tile the hunter can pay for", async () => {
    await render();

    expect(container?.querySelector(`[data-testid="${ACTION_UNAFFORDABLE_TEST_ID}"]`)).toBeNull();
  });
});

describe("the trust chip (PLAN M7.3)", () => {
  const trustChipOf = (kind: HunterActionKind): Element | null =>
    optionFor(kind)?.querySelector(
      `[data-testid="${ACTION_COST_CHIP_TEST_ID}"][data-chip="trust"]`,
    ) ?? null;

  it("signs trust the way core moves it: spent is negative, gained is positive", () => {
    const trustText = (kind: HunterActionKind): string | undefined =>
      costChipsOf(planCostOf(kind, BALANCE)).find((chip) => chip.kind === "trust")?.text;

    expect(trustText("roadblock")).toBe(`-${BALANCE.actions.roadblock.trustCost} trust`);
    expect(trustText("true_briefing")).toBe(`+${BALANCE.actions.trueBriefing.trustGain} trust`);
    expect(trustText("pull_cctv")).toBe("0 trust");
  });

  it("never marks trust short, because core clamps it rather than refusing", async () => {
    await render({ options: actionOptionsOf(BALANCE, BROKE) });

    for (const kind of ACTION_KINDS) {
      expect(trustChipOf(kind)?.getAttribute("data-short")).toBe("false");
    }
  });
});

describe("the tile keys (PLAN M7.3)", () => {
  it("numbers the tiles 1 to 4 in board order, and reads the keys back", () => {
    ACTION_KINDS.forEach((kind, index) => {
      expect(actionKindOfKey(actionKeyOf(index))).toBe(kind);
    });
    expect(actionKeyOf(0)).toBe("1");
    expect(actionKindOfKey("5")).toBeNull();
    expect(actionKindOfKey("a")).toBeNull();
  });

  it("shows each tile's key as a keycap, and declares it as the tile's shortcut", async () => {
    await render();

    ACTION_KINDS.forEach((kind, index) => {
      const tile = optionFor(kind);
      const keycap = tile?.querySelector(`[data-testid="${ACTION_KEYCAP_TEST_ID}"]`);
      expect(keycap?.textContent).toBe(actionKeyOf(index));
      expect(keycap?.getAttribute("aria-hidden")).toBe("true");
      expect(tile?.getAttribute("aria-keyshortcuts")).toBe(actionKeyOf(index));
    });
  });
});
