/**
 * The plan, drawn on the city (PLAN M7.3): a numbered cyan marker on every order the queue holds,
 * and a dashed ghost of the order the armed tool is pointed at, with a tag giving its price and
 * its place.
 *
 * **Its layer sits above the nodes, not in the overlay.** `maprenderer.tsx` draws the `plan` slot
 * last, after the incidents, because a marker has to be clicked to remove its order, and in the
 * overlay it would be under the edges and nodes whose clicks are the tool's. The slot's group
 * takes no pointer events, like the overlay's, and only a marker opts back in with
 * `visiblePainted` when there is a handler (M7.2's report-pin precedent), so the ghost, the tag
 * and the dashed shapes never swallow the click that places the order they preview.
 *
 * A marker stands off its target, below and to the right, and a second order on the same target
 * stands beside the first, so a node carrying a canvass can still be clicked for a second order.
 * Markers are pointer-only, like M7.2's pins: the layer is `aria-hidden`, a marker answers a
 * pointer release rather than a click event, and the queue row's Remove button is the keyboard
 * and screen-reader path to the same removal, so there is one accessible control per order.
 *
 * Cyan throughout, because the plan is the player's own instrument (DESIGN.md hue discipline).
 */

import type { HunterAction, MapEdge, NodeId, Position } from "@manhunter/core";
import type { ActionQueue } from "./actionqueue";
import type { CellBounds } from "./districtcells";
import { barrierTransformOf } from "./mapactors";
import { coordinate, MIDPOINT_FRACTION, midpointOf } from "./mapgeometry";
import type { PlanCost } from "./plancost";

export type MapPlanStyle = {
  readonly stroke: string;
  readonly width: number;
  readonly dash: string;
  /** How much of the ghost shows, so a preview never reads as an order already placed. */
  readonly ghostOpacity: number;
  readonly ringRadius: number;
  readonly barrierLength: number;
  readonly barrierThickness: number;
  readonly badgeRadius: number;
  readonly badgeFill: string;
  readonly badgeOffsetX: number;
  readonly badgeOffsetY: number;
  /** How far a second marker on the same target stands from the first. */
  readonly badgeSpread: number;
  readonly fontFamily: string;
  readonly badgeFontSize: number;
  readonly tagFontSize: number;
  readonly tagOffset: number;
  readonly tagHalo: string;
  readonly tagHaloWidth: number;
};

/** Where an order sits on the map: on a node, or across the edge between two points. */
export type PlanPlace =
  | { readonly kind: "node"; readonly key: string; readonly at: Position }
  | {
      readonly kind: "edge";
      readonly key: string;
      readonly at: Position;
      readonly from: Position;
      readonly to: Position;
    };

export type PlannedMark = {
  readonly index: number;
  readonly action: HunterAction;
  readonly place: PlanPlace;
  /** How many earlier orders stand on the same target; the marker steps aside by this many. */
  readonly stack: number;
};

export const TAG_SIDES = { start: "start", end: "end" } as const;

export type TagSide = (typeof TAG_SIDES)[keyof typeof TAG_SIDES];

export type PlanGhost = {
  readonly action: HunterAction;
  readonly place: PlanPlace;
  readonly tag: string;
  readonly side: TagSide;
};

export const MAP_PLANNED_ORDERS_TEST_ID = "map-planned-orders";
export const MAP_PLANNED_ORDER_TEST_ID = "map-planned-order";
export const MAP_PLAN_GHOST_TEST_ID = "map-plan-ghost";
export const MAP_PLAN_COST_TAG_TEST_ID = "map-plan-cost-tag";

/** The class `index.css` gives a removable marker its pointer; exported for the stylesheet test. */
export const MAP_PLANNED_ORDER_CLASS = "mh-map-plan__order";

const NO_FILL = "none";
const NO_POINTER_EVENTS = "none";
const PAINTED_POINTER_EVENTS = "visiblePainted";
const MIDDLE = "middle";
const CENTRAL_BASELINE = "central";
const STROKE_FIRST = "stroke";
const ARIA_HIDDEN = true;
const TAG_SEPARATOR = " ";
const TAG_PLACE_SEPARATOR = " - ";
const SPEND_SIGN = "-";
const GAIN_SIGN = "+";
const ACTION_POINT_UNIT = " AP";
const TRUST_UNIT = " trust";
const NO_UNIT = "";
const NO_SIGN = "";

const placeOfNode = (nodeId: NodeId, positions: ReadonlyMap<NodeId, Position>) => {
  const at = positions.get(nodeId);

  return at === undefined ? null : ({ kind: "node", key: nodeId, at } as const);
};

/** Where `action` sits on this map, or `null` for a global order or a target the map lacks. */
export const planPlaceOf = (
  action: HunterAction,
  positions: ReadonlyMap<NodeId, Position>,
  edges: readonly MapEdge[],
): PlanPlace | null => {
  if ("nodeId" in action) return placeOfNode(action.nodeId, positions);
  if (!("edgeId" in action)) return null;

  const edge = edges.find((candidate) => candidate.id === action.edgeId);
  const from = edge === undefined ? undefined : positions.get(edge.from);
  const to = edge === undefined ? undefined : positions.get(edge.to);
  if (from === undefined || to === undefined) return null;

  return { kind: "edge", key: action.edgeId, at: midpointOf(from, to), from, to };
};

/** Every queued order that has a place on the map, numbered by its position in the queue. */
export const plannedMarksOf = (
  queue: ActionQueue,
  positions: ReadonlyMap<NodeId, Position>,
  edges: readonly MapEdge[],
): readonly PlannedMark[] => {
  const placed = queue.flatMap((action, index) => {
    const place = planPlaceOf(action, positions, edges);

    return place === null ? [] : [{ index, action, place }];
  });

  return placed.map((mark, position) => ({
    ...mark,
    stack: placed.slice(0, position).filter((earlier) => earlier.place.key === mark.place.key)
      .length,
  }));
};

const spendText = (amount: number, unit: string): string | null =>
  amount === 0 ? null : `${SPEND_SIGN}${amount}${unit}`;

const trustText = (change: number): string | null => {
  if (change === 0) return null;

  return `${change > 0 ? GAIN_SIGN : NO_SIGN}${change}${TRUST_UNIT}`;
};

/**
 * What the ghost's tag reads: the price as signed changes, then the place, for example
 * "-1 AP -50 -3 trust - Harbor St Bridge". A meter the order does not move is left out.
 */
export const costTagOf = (cost: PlanCost, place: string): string => {
  const parts = [
    spendText(cost.actionPoints, ACTION_POINT_UNIT),
    spendText(cost.budget, NO_UNIT),
    trustText(cost.trust),
  ].filter((part): part is string => part !== null);

  return `${parts.join(TAG_SEPARATOR)}${TAG_PLACE_SEPARATOR}${place}`;
};

/** A tag right of centre reads leftwards, so it stays on the plate. */
export const tagSideOf = (at: Position, bounds: CellBounds): TagSide =>
  at.x > (bounds.minX + bounds.maxX) * MIDPOINT_FRACTION ? TAG_SIDES.end : TAG_SIDES.start;

type ShapeProps = {
  readonly place: PlanPlace;
  readonly style: MapPlanStyle;
};

/** A dashed barrier across a planned roadblock's road, or a dashed ring round a planned node. */
const PlanShape = ({ place, style }: ShapeProps) => {
  if (place.kind === "node") {
    return (
      <circle
        cx={coordinate(place.at.x)}
        cy={coordinate(place.at.y)}
        r={style.ringRadius}
        fill={NO_FILL}
        stroke={style.stroke}
        strokeWidth={style.width}
        strokeDasharray={style.dash}
      />
    );
  }

  return (
    <rect
      transform={barrierTransformOf(place.from, place.to)}
      x={-style.barrierLength * MIDPOINT_FRACTION}
      y={-style.barrierThickness * MIDPOINT_FRACTION}
      width={style.barrierLength}
      height={style.barrierThickness}
      fill={NO_FILL}
      stroke={style.stroke}
      strokeWidth={style.width}
      strokeDasharray={style.dash}
    />
  );
};

type MarkProps = {
  readonly mark: PlannedMark;
  readonly style: MapPlanStyle;
  readonly onRemove: ((index: number) => void) | undefined;
};

/** Only the numbered badge takes the click; the dashed shape round the target never does. */
const PlannedOrderMark = ({ mark, style, onRemove }: MarkProps) => {
  const x = mark.place.at.x + style.badgeOffsetX + mark.stack * style.badgeSpread;
  const y = mark.place.at.y + style.badgeOffsetY;

  return (
    <g
      data-testid={MAP_PLANNED_ORDER_TEST_ID}
      data-index={mark.index}
      data-action={mark.action.kind}
      data-target={mark.place.key}
    >
      <PlanShape place={mark.place} style={style} />
      <g
        className={MAP_PLANNED_ORDER_CLASS}
        style={{
          pointerEvents: onRemove === undefined ? NO_POINTER_EVENTS : PAINTED_POINTER_EVENTS,
        }}
        onPointerUp={onRemove === undefined ? undefined : () => onRemove(mark.index)}
      >
        <circle
          cx={coordinate(x)}
          cy={coordinate(y)}
          r={style.badgeRadius}
          fill={style.badgeFill}
          stroke={style.stroke}
          strokeWidth={style.width}
        />
        <text
          x={coordinate(x)}
          y={coordinate(y)}
          fill={style.stroke}
          fontFamily={style.fontFamily}
          fontSize={style.badgeFontSize}
          textAnchor={MIDDLE}
          dominantBaseline={CENTRAL_BASELINE}
        >
          {mark.index + 1}
        </text>
      </g>
    </g>
  );
};

const PlanGhostMark = ({
  ghost,
  style,
}: {
  readonly ghost: PlanGhost;
  readonly style: MapPlanStyle;
}) => {
  const offset = ghost.side === TAG_SIDES.start ? style.tagOffset : -style.tagOffset;

  return (
    <g
      data-testid={MAP_PLAN_GHOST_TEST_ID}
      data-action={ghost.action.kind}
      data-target={ghost.place.key}
      style={{ pointerEvents: NO_POINTER_EVENTS }}
    >
      <g opacity={style.ghostOpacity}>
        <PlanShape place={ghost.place} style={style} />
      </g>
      <text
        data-testid={MAP_PLAN_COST_TAG_TEST_ID}
        x={coordinate(ghost.place.at.x + offset)}
        y={coordinate(ghost.place.at.y)}
        fill={style.stroke}
        stroke={style.tagHalo}
        strokeWidth={style.tagHaloWidth}
        paintOrder={STROKE_FIRST}
        fontFamily={style.fontFamily}
        fontSize={style.tagFontSize}
        textAnchor={ghost.side}
        dominantBaseline={CENTRAL_BASELINE}
      >
        {ghost.tag}
      </text>
    </g>
  );
};

export type MapPlannedOrdersProps = {
  readonly marks: readonly PlannedMark[];
  readonly ghost: PlanGhost | null;
  readonly style: MapPlanStyle;
  /** Clicking a marker removes its order. Absent, the markers take no pointer events. */
  readonly onRemove?: ((index: number) => void) | undefined;
};

export const MapPlannedOrders = ({ marks, ghost, style, onRemove }: MapPlannedOrdersProps) => (
  <g
    data-testid={MAP_PLANNED_ORDERS_TEST_ID}
    aria-hidden={ARIA_HIDDEN}
    style={{ pointerEvents: NO_POINTER_EVENTS }}
  >
    {marks.map((mark) => (
      <PlannedOrderMark key={mark.index} mark={mark} style={style} onRemove={onRemove} />
    ))}
    {ghost === null ? null : <PlanGhostMark ghost={ghost} style={style} />}
  </g>
);
