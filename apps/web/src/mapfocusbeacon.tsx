/**
 * Where the focused node is (PLAN M7.2). When a feed row, a node or a report pin is pointed at,
 * `DispatchScreen` holds its node, and this draws a cyan ring on it plus a leader out to the
 * nearer of the two plate margins M7.1's street index is drawn in: the top margin names the
 * node's avenue and the left margin its street. Cyan because the link is the player's own
 * instrument (DESIGN.md's hue discipline).
 *
 * It is mounted in the map's overlay slot, over the river and under the edges and nodes, so it
 * adds no layer to the pinned order. The layer is always drawn, empty when nothing is in focus,
 * and takes no pointer events and says nothing to assistive technology: the hover link is a
 * pointer's and a keyboard's view of something the focused element already names.
 *
 * The ring pulses once as it lands, under `prefers-reduced-motion: no-preference` only
 * (`index.css`); it is keyed by its node, so moving the focus replays the pulse and holding it
 * does not loop.
 */

import type { MapNode, NodeId, Position } from "@manhunter/core";
import type { CellBounds } from "./districtcells";
import { coordinate, segmentPathOf } from "./mapgeometry";

export type MapFocusBeaconStyle = {
  readonly radius: number;
  readonly stroke: string;
  readonly width: number;
  readonly leaderWidth: number;
  readonly leaderDash: string;
  /** How far inside the plate's edge the leader stops, clear of the street index's labels. */
  readonly leaderStop: number;
};

export const MAP_FOCUS_BEACON_TEST_ID = "map-focus-beacon";
export const MAP_FOCUS_BEACON_RING_TEST_ID = "map-focus-beacon-ring";
export const MAP_FOCUS_BEACON_LEADER_TEST_ID = "map-focus-beacon-leader";

/** The class `index.css` pulses; exported so the stylesheet test can name the same string. */
export const MAP_FOCUS_BEACON_RING_CLASS = "mh-map-beacon__ring";

/** The two margins that carry street names; exported so tests name the same strings. */
export const BEACON_MARGINS = {
  top: "top",
  left: "left",
} as const;

export type BeaconMargin = (typeof BEACON_MARGINS)[keyof typeof BEACON_MARGINS];

export type BeaconLeader = {
  readonly margin: BeaconMargin;
  readonly from: Position;
  readonly to: Position;
};

const NO_FILL = "none";
const NO_POINTER_EVENTS = "none";
const ARIA_HIDDEN = true;

/**
 * From the ring's rim straight out to whichever named margin is nearer, a tie going to the top.
 * `null` when the node is already inside the margin's stop, so there is no leader to draw.
 */
export const beaconLeaderOf = (
  position: Position,
  bounds: CellBounds,
  style: MapFocusBeaconStyle,
): BeaconLeader | null => {
  const toTop = position.y - bounds.minY;
  const toLeft = position.x - bounds.minX;
  if (toTop <= toLeft) {
    const from = { x: position.x, y: position.y - style.radius };
    const to = { x: position.x, y: bounds.minY + style.leaderStop };

    return to.y < from.y ? { margin: BEACON_MARGINS.top, from, to } : null;
  }
  const from = { x: position.x - style.radius, y: position.y };
  const to = { x: bounds.minX + style.leaderStop, y: position.y };

  return to.x < from.x ? { margin: BEACON_MARGINS.left, from, to } : null;
};

type BeaconMarksProps = {
  readonly nodeId: NodeId;
  readonly position: Position;
  readonly bounds: CellBounds;
  readonly style: MapFocusBeaconStyle;
};

const BeaconMarks = ({ nodeId, position, bounds, style }: BeaconMarksProps) => {
  const leader = beaconLeaderOf(position, bounds, style);

  return (
    <>
      {leader === null ? null : (
        <path
          data-testid={MAP_FOCUS_BEACON_LEADER_TEST_ID}
          data-margin={leader.margin}
          d={segmentPathOf(leader.from, leader.to)}
          fill={NO_FILL}
          stroke={style.stroke}
          strokeWidth={style.leaderWidth}
          strokeDasharray={style.leaderDash}
        />
      )}
      <circle
        data-testid={MAP_FOCUS_BEACON_RING_TEST_ID}
        data-nodeid={nodeId}
        className={MAP_FOCUS_BEACON_RING_CLASS}
        cx={coordinate(position.x)}
        cy={coordinate(position.y)}
        r={style.radius}
        fill={NO_FILL}
        stroke={style.stroke}
        strokeWidth={style.width}
      />
    </>
  );
};

export type MapFocusBeaconProps = {
  readonly nodeId: NodeId | null;
  readonly nodes: readonly MapNode[];
  /** The plate, `plateBoundsOf` with the map theme's padding, so the leader meets its margin. */
  readonly bounds: CellBounds;
  readonly style: MapFocusBeaconStyle;
};

/** A node the map does not contain draws no beacon rather than one at the origin. */
export const MapFocusBeacon = ({ nodeId, nodes, bounds, style }: MapFocusBeaconProps) => {
  const node = nodeId === null ? undefined : nodes.find((each) => each.id === nodeId);

  return (
    <g
      data-testid={MAP_FOCUS_BEACON_TEST_ID}
      data-nodeid={node?.id}
      aria-hidden={ARIA_HIDDEN}
      style={{ pointerEvents: NO_POINTER_EVENTS }}
    >
      {node === undefined ? null : (
        <BeaconMarks
          key={node.id}
          nodeId={node.id}
          position={node.position}
          bounds={bounds}
          style={style}
        />
      )}
    </g>
  );
};
