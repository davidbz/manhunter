/**
 * Which map target the pointer or the keyboard is on (PLAN M7.3), so an armed tool can preview
 * its order there before it is placed.
 *
 * A sibling of `nodefocus.ts` rather than a use of it: the focused node is the feed's link and
 * never narrows anything, while the hovered target is what the armed tool would be pointed at, and
 * it covers edges as well as nodes. A node reports both, so `mergedHandlersOf` runs the two sets
 * of handlers side by side on the one element.
 */

import type { MapSelection } from "./maprenderer";
import { NO_NODE_FOCUS_HANDLERS, type NodeFocusHandlers } from "./nodefocus";

/** Point the preview at a target, or clear it with `null`. */
export type MapHoverHandler = (target: MapSelection | null) => void;

/** Handlers that may be absent, spread onto one element. */
export type MapPointerHandlers = {
  readonly [Key in keyof NodeFocusHandlers]?: NodeFocusHandlers[Key] | undefined;
};

/** Pointer and keyboard both preview; leaving by either clears, unconditionally. */
export const optionalHoverHandlersOf = (
  target: MapSelection,
  onHover: MapHoverHandler | undefined,
): MapPointerHandlers => {
  if (onHover === undefined) return NO_NODE_FOCUS_HANDLERS;

  const point = (): void => onHover(target);
  const clear = (): void => onHover(null);

  return { onPointerEnter: point, onPointerLeave: clear, onFocus: point, onBlur: clear };
};

const bothOf = (
  first: (() => void) | undefined,
  second: (() => void) | undefined,
): (() => void) | undefined => {
  if (first === undefined) return second;
  if (second === undefined) return first;

  return () => {
    first();
    second();
  };
};

/** Both sets on one element: each event runs the first set's handler, then the second's. */
export const mergedHandlersOf = (
  first: MapPointerHandlers,
  second: MapPointerHandlers,
): MapPointerHandlers => ({
  onPointerEnter: bothOf(first.onPointerEnter, second.onPointerEnter),
  onPointerLeave: bothOf(first.onPointerLeave, second.onPointerLeave),
  onFocus: bothOf(first.onFocus, second.onFocus),
  onBlur: bothOf(first.onBlur, second.onBlur),
});
