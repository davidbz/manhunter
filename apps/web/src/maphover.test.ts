import { makeEdgeId, makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { mergedHandlersOf, optionalHoverHandlersOf } from "./maphover";
import type { MapSelection } from "./maprenderer";
import { NO_NODE_FOCUS_HANDLERS } from "./nodefocus";

const ON_ROAD: MapSelection = { kind: "edge", edgeId: makeEdgeId("e-1") };
const AT_NODE: MapSelection = { kind: "node", nodeId: makeNodeId("n-1") };

describe("optionalHoverHandlersOf", () => {
  it("adds no handlers when nothing listens", () => {
    expect(optionalHoverHandlersOf(ON_ROAD, undefined)).toBe(NO_NODE_FOCUS_HANDLERS);
  });

  it("points at the target on enter and focus, and clears on leave and blur", () => {
    const heard: (MapSelection | null)[] = [];
    const handlers = optionalHoverHandlersOf(ON_ROAD, (target) => heard.push(target));

    handlers.onPointerEnter?.();
    handlers.onPointerLeave?.();
    handlers.onFocus?.();
    handlers.onBlur?.();

    expect(heard).toEqual([ON_ROAD, null, ON_ROAD, null]);
  });
});

describe("mergedHandlersOf", () => {
  it("runs the first set's handler, then the second's, on the same event", () => {
    const heard: string[] = [];
    const merged = mergedHandlersOf(
      { onPointerEnter: () => heard.push("focus") },
      optionalHoverHandlersOf(AT_NODE, () => heard.push("hover")),
    );

    merged.onPointerEnter?.();
    merged.onBlur?.();

    expect(heard).toEqual(["focus", "hover", "hover"]);
  });

  it("leaves an event unhandled when neither set handles it", () => {
    expect(mergedHandlersOf({}, {}).onFocus).toBeUndefined();
  });
});
