/**
 * The things on the map the player acts on or reacts to (PLAN M6.5): unit pips on their blocks,
 * edges as targets, the checkpoint barrier on a closed road, the selection reticle, and the
 * located incidents `HunterView.events` carries.
 *
 * `maprenderer.tsx` still owns the layer order and the `MapTheme` contract; this file draws what
 * goes inside the listbox (edges, then nodes) and the incident layer after the exit gates, so
 * nothing new lands between the river and the nodes.
 *
 * **Interaction states are split between SVG and the stylesheet on purpose.** Selection, blocked
 * and the incident ring are data and are drawn as attributes. Hover, keyboard focus and dimming
 * are states the browser or the armed action decide, so each target carries the hook -
 * `mh-map-target`, a `mh-map-focus` element, `data-selectable` - and `index.css` does the rest:
 * `:focus-visible` has no attribute equivalent, which is the reason M5.3a's focus ring waited for
 * a stylesheet. Colours in the CSS are `var(--mh-*)` like everywhere else.
 *
 * No element here is a `<line>`. The glow `<line>` is the one line per edge, and
 * `maprenderer.test.tsx` counts them.
 */

import type { DistrictType, ExitKind, MapNode, Position } from "@manhunter/core";
import type { KeyboardEvent } from "react";
import { angleOf, coordinate, MIDPOINT_FRACTION, midpointOf, segmentPathOf } from "./mapgeometry";
import type { LocatedIncident } from "./mapincidents";
import type { MapSelection, MapTheme, PlacedEdge } from "./maprenderer";

/** A district chip: a plate the size of `size` carrying the type's glyph (PLAN M6.5). */
export type MapPipStyle = {
  readonly size: number;
  readonly corner: number;
  readonly inset: number;
  readonly plate: string;
  readonly strokeWidth: number;
  readonly glyphWidth: number;
  /** Glyphs are stroke paths on a `glyphBox`-unit square, scaled into the plate less `inset`. */
  readonly glyphBox: number;
  readonly glyphs: Readonly<Record<DistrictType, string>>;
};

/** The ring round the node the hunt started from (`MapGraph.incidentNodeId`). */
export type MapIncidentRingStyle = {
  readonly radius: number;
  readonly stroke: string;
  readonly width: number;
};

/** Drawn round a target only while it has keyboard focus; `gap` is the clearance from the pip. */
export type MapFocusStyle = {
  readonly gap: number;
  readonly stroke: string;
  readonly width: number;
};

/** Four corner brackets `gap` outside the pip, each arm `tick` long. */
export type MapReticleStyle = {
  readonly gap: number;
  readonly tick: number;
  readonly stroke: string;
  readonly width: number;
};

/** A striped barrier laid across a closed edge at its midpoint, `length` along the barrier. */
export type MapCheckpointStyle = {
  readonly length: number;
  readonly thickness: number;
  readonly plate: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly stripeCount: number;
  readonly stripeWidth: number;
};

/** A located `civilian_hurt`: a dashed ring round the node plus a badge below and to its left. */
export type MapHarmStyle = {
  readonly radius: number;
  readonly stroke: string;
  readonly width: number;
  readonly dash: string;
  readonly badgeSize: number;
  readonly badgeOffset: number;
  readonly badgeFill: string;
  readonly glyph: string;
  readonly glyphStroke: string;
  readonly glyphWidth: number;
  readonly glyphInset: number;
  readonly glyphBox: number;
};

export const MAP_NODE_TEST_ID = "map-node";
export const MAP_EDGE_TEST_ID = "map-edge";
export const MAP_SELECTION_TEST_ID = "map-selection";
export const MAP_PIP_TEST_ID = "map-pip";
export const MAP_INCIDENT_RING_TEST_ID = "map-incident-ring";
export const MAP_FOCUS_TEST_ID = "map-focus";
export const MAP_CHECKPOINT_TEST_ID = "map-checkpoint";
export const MAP_INCIDENTS_TEST_ID = "map-incidents";
export const MAP_INCIDENT_TEST_ID = "map-incident";

/**
 * Class names `index.css` keys the interaction states on. Exported so the stylesheet test can check
 * the rules it depends on name the same classes the markup carries.
 */
export const MAP_CLASSES = {
  target: "mh-map-target",
  node: "mh-map-node",
  edge: "mh-map-edge",
  focus: "mh-map-focus",
  plate: "mh-map-pip__plate",
  reticle: "mh-map-reticle",
  /** The barrier inside a checkpoint's placed group, which carries the transform attribute. */
  checkpoint: "mh-map-checkpoint",
} as const;

/** Which way each `data-layer` of an edge is drawn; exported so tests name the same strings. */
export const EDGE_LAYERS = {
  focus: "focus",
  glow: "glow",
  casing: "casing",
  fill: "fill",
} as const;

/** id of the `<filter>` every road edge's glow references (PLAN M5.7). Exported for tests. */
export const ROAD_GLOW_FILTER_ID = "road-glow";
const ROAD_GLOW_URL = `url(#${ROAD_GLOW_FILTER_ID})`;

const NO_FILL = "none";
const NO_POINTER_EVENTS = "none";
const ROUND_JOIN = "round";
const BUTT_CAP = "butt";
const SQUARE_CAP = "square";
const LABEL_SEPARATOR = " - ";
const INCIDENT_LABEL = "incident";
const HARM_LABEL = "civilian hurt";
const EXIT_LABEL = "exit";

/** Keys that pick the focused node or edge, so the map is reachable without a pointer. */
const SELECT_KEYS: readonly string[] = ["Enter", " "];

/** A barrier lies across the road, a quarter turn from the edge's own direction. */
const QUARTER_TURN_DEGREES = 90;

/** The reticle's four corners, as signs on x and y. */
const RETICLE_CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const onSelectKey = (event: KeyboardEvent<SVGGElement>, select: () => void): void => {
  if (!SELECT_KEYS.includes(event.key)) return;

  event.preventDefault();
  select();
};

/** `translate` then `scale` that fits a `box`-unit glyph into a `size` square at `corner`, less `inset`. */
export const glyphTransformOf = (
  corner: Position,
  size: number,
  inset: number,
  box: number,
): string => {
  const scale = (size - inset - inset) / box;

  return `translate(${coordinate(corner.x + inset)} ${coordinate(corner.y + inset)}) scale(${coordinate(scale)})`;
};

/** The top-left corner of a `size` square centred on `center`. */
const cornerOf = (center: Position, size: number): Position => ({
  x: center.x - size * MIDPOINT_FRACTION,
  y: center.y - size * MIDPOINT_FRACTION,
});

const reticlePathOf = (center: Position, half: number, tick: number): string =>
  RETICLE_CORNERS.map(([signX, signY]) => {
    const x = coordinate(center.x + signX * half);
    const y = coordinate(center.y + signY * half);

    return `M${x} ${coordinate(y - signY * tick)} V${y} H${coordinate(x - signX * tick)}`;
  }).join(" ");

/** Diagonal stripes across a barrier `length` long and `thickness` deep, centred on the origin. */
const barrierStripesOf = (length: number, thickness: number, count: number): string => {
  const spacing = length / count;
  const half = thickness * MIDPOINT_FRACTION;

  return Array.from({ length: count }, (_, index) => {
    const x = -length * MIDPOINT_FRACTION + (index + MIDPOINT_FRACTION) * spacing;

    return `M${coordinate(x - half)} ${coordinate(half)} L${coordinate(x + half)} ${coordinate(-half)}`;
  }).join(" ");
};

type MapReticleProps = {
  readonly center: Position;
  readonly theme: MapTheme;
};

/**
 * The selection, as four corner brackets locked on round the target. It locks on with a short
 * scale-in under `prefers-reduced-motion: no-preference` (`index.css`), and is static otherwise.
 */
const MapReticle = ({ center, theme }: MapReticleProps) => {
  const reticle = theme.reticle;
  const half = theme.pip.size * MIDPOINT_FRACTION + reticle.gap;

  return (
    <path
      data-testid={MAP_SELECTION_TEST_ID}
      className={MAP_CLASSES.reticle}
      d={reticlePathOf(center, half, reticle.tick)}
      fill={NO_FILL}
      stroke={reticle.stroke}
      strokeWidth={reticle.width}
      strokeLinecap={SQUARE_CAP}
    />
  );
};

type MapCheckpointProps = {
  readonly placed: PlacedEdge;
  readonly theme: MapTheme;
};

/**
 * A standing roadblock, drawn as a striped barrier across the road (PLAN M6.5, replacing M5.3a's
 * red dot). Cyan, because a checkpoint that stands is the player's own instrument; DESIGN.md keeps
 * red for the criminal and for a checkpoint that fired, which the hunter is never told about.
 */
const MapCheckpoint = ({ placed, theme }: MapCheckpointProps) => {
  const style = theme.checkpoint;
  const middle = midpointOf(placed.from, placed.to);
  const across = angleOf(placed.from, placed.to) + QUARTER_TURN_DEGREES;
  const half = style.length * MIDPOINT_FRACTION;
  const depth = style.thickness * MIDPOINT_FRACTION;

  return (
    <g
      data-testid={MAP_CHECKPOINT_TEST_ID}
      data-edgeid={placed.edge.id}
      transform={`translate(${coordinate(middle.x)} ${coordinate(middle.y)}) rotate(${coordinate(across)})`}
    >
      <g className={MAP_CLASSES.checkpoint}>
        <rect
          x={-half}
          y={-depth}
          width={style.length}
          height={style.thickness}
          fill={style.plate}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
        />
        <path
          d={barrierStripesOf(style.length, style.thickness, style.stripeCount)}
          stroke={style.stroke}
          strokeWidth={style.stripeWidth}
        />
      </g>
    </g>
  );
};

type MapEdgeStrokesProps = {
  readonly placed: PlacedEdge;
  readonly selected: boolean;
  readonly theme: MapTheme;
};

/**
 * Focus, glow, casing, fill, bottom to top (DESIGN.md "Roads are casing plus fill"). The glow is
 * drawn casing-wide in the kind's own colour, so the casing covers its crisp core and only the
 * blurred halo shows round the road. The focus stroke is wider than the casing and hidden until
 * the edge has keyboard focus.
 */
const MapEdgeStrokes = ({ placed, selected, theme }: MapEdgeStrokesProps) => {
  const { edge, from, to } = placed;
  const style = theme.edges[edge.kind];
  const path = segmentPathOf(from, to);

  return (
    <>
      <path
        data-layer={EDGE_LAYERS.focus}
        data-testid={MAP_FOCUS_TEST_ID}
        className={MAP_CLASSES.focus}
        d={path}
        fill={NO_FILL}
        stroke={theme.focus.stroke}
        strokeWidth={style.casingWidth + theme.focus.gap + theme.focus.gap}
        strokeLinecap={BUTT_CAP}
      />
      <line
        data-layer={EDGE_LAYERS.glow}
        x1={coordinate(from.x)}
        y1={coordinate(from.y)}
        x2={coordinate(to.x)}
        y2={coordinate(to.y)}
        stroke={style.stroke}
        strokeWidth={style.casingWidth}
        filter={ROAD_GLOW_URL}
      />
      <path
        data-layer={EDGE_LAYERS.casing}
        d={path}
        fill={NO_FILL}
        stroke={theme.edgeCasing}
        strokeWidth={style.casingWidth}
        strokeDasharray={style.casingDash ?? undefined}
        strokeLinecap={BUTT_CAP}
      />
      <path
        data-layer={EDGE_LAYERS.fill}
        d={path}
        fill={NO_FILL}
        stroke={selected ? theme.selectionStroke : style.stroke}
        strokeWidth={style.width}
        strokeDasharray={style.dash ?? undefined}
        strokeLinecap={BUTT_CAP}
      />
    </>
  );
};

export type MapEdgeLineProps = {
  readonly placed: PlacedEdge;
  readonly blocked: boolean;
  readonly selected: boolean;
  readonly selectable: boolean;
  readonly theme: MapTheme;
  readonly onSelect: (selection: MapSelection) => void;
};

export const MapEdgeLine = ({
  placed,
  blocked,
  selected,
  selectable,
  theme,
  onSelect,
}: MapEdgeLineProps) => {
  const { edge, from, to } = placed;
  const select = () => onSelect({ kind: "edge", edgeId: edge.id });

  return (
    <g
      role="option"
      tabIndex={0}
      className={`${MAP_CLASSES.target} ${MAP_CLASSES.edge}`}
      aria-selected={selected}
      aria-label={`${edge.id}${LABEL_SEPARATOR}${edge.kind}`}
      data-testid={MAP_EDGE_TEST_ID}
      data-edgeid={edge.id}
      data-edgekind={edge.kind}
      data-blocked={blocked}
      data-selected={selected}
      data-selectable={selectable}
      onClick={select}
      onKeyDown={(event) => onSelectKey(event, select)}
    >
      <MapEdgeStrokes placed={placed} selected={selected} theme={theme} />
      {blocked ? <MapCheckpoint placed={placed} theme={theme} /> : null}
      {selected ? <MapReticle center={midpointOf(from, to)} theme={theme} /> : null}
    </g>
  );
};

type MapPipProps = {
  readonly node: MapNode;
  readonly theme: MapTheme;
};

/** The unit pip: a dark chip edged and marked in the district's own hue, carrying its glyph. */
const MapPip = ({ node, theme }: MapPipProps) => {
  const pip = theme.pip;
  const corner = cornerOf(node.position, pip.size);
  const hue = theme.districts[node.districtType];

  return (
    <g data-testid={MAP_PIP_TEST_ID} data-district={node.districtType}>
      <rect
        className={MAP_CLASSES.plate}
        x={coordinate(corner.x)}
        y={coordinate(corner.y)}
        width={pip.size}
        height={pip.size}
        rx={pip.corner}
        fill={pip.plate}
        stroke={hue}
        strokeWidth={pip.strokeWidth}
      />
      <path
        d={pip.glyphs[node.districtType]}
        transform={glyphTransformOf(corner, pip.size, pip.inset, pip.glyphBox)}
        fill={NO_FILL}
        stroke={hue}
        strokeWidth={pip.glyphWidth}
        strokeLinecap={ROUND_JOIN}
        strokeLinejoin={ROUND_JOIN}
      />
    </g>
  );
};

/** Hidden until the node has keyboard focus (`index.css`); a square `gap` outside the pip. */
const MapNodeFocus = ({ node, theme }: MapPipProps) => {
  const size = theme.pip.size + theme.focus.gap + theme.focus.gap;
  const corner = cornerOf(node.position, size);

  return (
    <rect
      data-testid={MAP_FOCUS_TEST_ID}
      className={MAP_CLASSES.focus}
      x={coordinate(corner.x)}
      y={coordinate(corner.y)}
      width={size}
      height={size}
      fill={NO_FILL}
      stroke={theme.focus.stroke}
      strokeWidth={theme.focus.width}
    />
  );
};

const MapIncidentRing = ({ node, theme }: MapPipProps) => (
  <circle
    data-testid={MAP_INCIDENT_RING_TEST_ID}
    cx={coordinate(node.position.x)}
    cy={coordinate(node.position.y)}
    r={theme.incidentRing.radius}
    fill={NO_FILL}
    stroke={theme.incidentRing.stroke}
    strokeWidth={theme.incidentRing.width}
  />
);

export type NodeFacts = {
  readonly exitKind: ExitKind | undefined;
  readonly isIncident: boolean;
  readonly harmed: boolean;
};

const nodeLabelOf = (node: MapNode, facts: NodeFacts): string => {
  const parts = [String(node.id), node.districtType];
  if (facts.exitKind !== undefined) parts.push(`${EXIT_LABEL} ${facts.exitKind}`);
  if (facts.isIncident) parts.push(INCIDENT_LABEL);
  if (facts.harmed) parts.push(HARM_LABEL);

  return parts.join(LABEL_SEPARATOR);
};

export type MapNodeMarkerProps = {
  readonly node: MapNode;
  readonly facts: NodeFacts;
  readonly selected: boolean;
  readonly selectable: boolean;
  readonly theme: MapTheme;
  readonly onSelect: (selection: MapSelection) => void;
};

export const MapNodeMarker = ({
  node,
  facts,
  selected,
  selectable,
  theme,
  onSelect,
}: MapNodeMarkerProps) => {
  const select = () => onSelect({ kind: "node", nodeId: node.id });

  return (
    <g
      role="option"
      tabIndex={0}
      className={`${MAP_CLASSES.target} ${MAP_CLASSES.node}`}
      aria-selected={selected}
      aria-label={nodeLabelOf(node, facts)}
      data-testid={MAP_NODE_TEST_ID}
      data-nodeid={node.id}
      data-district={node.districtType}
      data-incident={facts.isIncident}
      data-selected={selected}
      data-selectable={selectable}
      data-exit={facts.exitKind}
      onClick={select}
      onKeyDown={(event) => onSelectKey(event, select)}
    >
      <MapNodeFocus node={node} theme={theme} />
      {facts.isIncident ? <MapIncidentRing node={node} theme={theme} /> : null}
      <MapPip node={node} theme={theme} />
      {selected ? <MapReticle center={node.position} theme={theme} /> : null}
    </g>
  );
};

type MapHarmMarkerProps = {
  readonly incident: LocatedIncident;
  readonly position: Position;
  readonly theme: MapTheme;
};

/** A diamond badge's four points, `half` from its centre. */
const diamondOf = (center: Position, half: number): readonly Position[] => [
  { x: center.x, y: center.y - half },
  { x: center.x + half, y: center.y },
  { x: center.x, y: center.y + half },
  { x: center.x - half, y: center.y },
];

const MapHarmMarker = ({ incident, position, theme }: MapHarmMarkerProps) => {
  const harm = theme.harm;
  const badge = { x: position.x - harm.badgeOffset, y: position.y + harm.badgeOffset };
  const half = harm.badgeSize * MIDPOINT_FRACTION;

  return (
    <g
      data-testid={MAP_INCIDENT_TEST_ID}
      data-nodeid={incident.nodeId}
      data-count={incident.count}
      data-turn={incident.lastTurn}
    >
      <circle
        cx={coordinate(position.x)}
        cy={coordinate(position.y)}
        r={harm.radius}
        fill={NO_FILL}
        stroke={harm.stroke}
        strokeWidth={harm.width}
        strokeDasharray={harm.dash}
      />
      <polygon
        points={diamondOf(badge, half)
          .map((point) => `${coordinate(point.x)},${coordinate(point.y)}`)
          .join(" ")}
        fill={harm.badgeFill}
      />
      <path
        d={harm.glyph}
        transform={glyphTransformOf(
          cornerOf(badge, harm.badgeSize),
          harm.badgeSize,
          harm.glyphInset,
          harm.glyphBox,
        )}
        fill={NO_FILL}
        stroke={harm.glyphStroke}
        strokeWidth={harm.glyphWidth}
        strokeLinecap={ROUND_JOIN}
      />
    </g>
  );
};

export type MapIncidentsProps = {
  readonly incidents: readonly LocatedIncident[];
  readonly positions: ReadonlyMap<string, Position>;
  readonly theme: MapTheme;
};

/**
 * Located incidents over everything, taking no pointer events so a click reaches the node beneath.
 * An incident naming a node the map does not have is skipped rather than drawn at the origin.
 */
export const MapIncidents = ({ incidents, positions, theme }: MapIncidentsProps) => {
  if (incidents.length === 0) return null;

  return (
    <g data-testid={MAP_INCIDENTS_TEST_ID} style={{ pointerEvents: NO_POINTER_EVENTS }}>
      {incidents.flatMap((incident) => {
        const position = positions.get(incident.nodeId);
        if (position === undefined) return [];

        return [
          <MapHarmMarker
            key={incident.nodeId}
            incident={incident}
            position={position}
            theme={theme}
          />,
        ];
      })}
    </g>
  );
};
