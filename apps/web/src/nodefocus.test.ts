import type { NodeId } from "@manhunter/core";
import { makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import {
  NO_NODE_FOCUS_HANDLERS,
  nodeFocusHandlersOf,
  optionalNodeFocusHandlersOf,
} from "./nodefocus";

const PARK = makeNodeId("n-park");

describe("the hover link's handlers (PLAN M7.2)", () => {
  it("links the node on pointer enter and on focus, and clears on leave and on blur", () => {
    const calls: (NodeId | null)[] = [];
    const handlers = nodeFocusHandlersOf(PARK, (nodeId) => calls.push(nodeId));

    handlers.onPointerEnter();
    handlers.onPointerLeave();
    handlers.onFocus();
    handlers.onBlur();

    expect(calls).toEqual([PARK, null, PARK, null]);
  });

  it("gives no handlers at all to a surface with no focus to move", () => {
    expect(optionalNodeFocusHandlersOf(PARK, undefined)).toBe(NO_NODE_FOCUS_HANDLERS);
    expect(Object.keys(NO_NODE_FOCUS_HANDLERS)).toEqual([]);
  });
});
