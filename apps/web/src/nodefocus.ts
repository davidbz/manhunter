/**
 * The hover link between the feed and the map (PLAN M7.2). One node at a time can be in focus:
 * pointing at a feed row, a node or a report pin puts its node there, and leaving it clears it.
 * `DispatchScreen` holds the value; every surface that sets it takes the same four handlers from
 * here, so a row, a node and a pin cannot disagree about when the link starts and stops.
 *
 * Presentation only. Nothing here selects, so the focused node never narrows a click.
 */

import type { NodeId } from "@manhunter/core";

/** Put a node in focus, or clear the focus with `null`. */
export type NodeFocusHandler = (nodeId: NodeId | null) => void;

/** The screen's focused node and the handler that moves it, passed to the feed as one value. */
export type NodeFocus = {
  readonly nodeId: NodeId | null;
  readonly onFocus: NodeFocusHandler;
};

export type NodeFocusHandlers = {
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
};

/** Pointer and keyboard both link; leaving by either clears. */
export const nodeFocusHandlersOf = (
  nodeId: NodeId,
  onFocus: NodeFocusHandler,
): NodeFocusHandlers => {
  const link = (): void => onFocus(nodeId);
  const unlink = (): void => onFocus(null);

  return { onPointerEnter: link, onPointerLeave: unlink, onFocus: link, onBlur: unlink };
};

/** No link at all: a surface drawn outside the dispatch screen spreads these and stays inert. */
export const NO_NODE_FOCUS_HANDLERS: Partial<NodeFocusHandlers> = {};

/** The handlers for `nodeId`, or none when the surface was given no focus to move. */
export const optionalNodeFocusHandlersOf = (
  nodeId: NodeId,
  onFocus: NodeFocusHandler | undefined,
): Partial<NodeFocusHandlers> =>
  onFocus === undefined ? NO_NODE_FOCUS_HANDLERS : nodeFocusHandlersOf(nodeId, onFocus);
