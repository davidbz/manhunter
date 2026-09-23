/**
 * The city, drawn (PLAN M5.3a). Nodes, typed edges, exits, standing roadblocks, the river, and
 * whatever the player has selected - everything the map is made of, and nothing else.
 *
 * This is the `MapRenderer` seam AGENTS.md names ("SVG via React for now; PixiJS may replace it
 * later behind `MapRenderer`). `MapRendererProps` is therefore the contract, not the SVG: a
 * different renderer satisfies the same props, because everything in them is data the view
 * already carries plus the two seams a renderer cannot avoid - a selection callback and a layer
 * to draw an overlay into.
 *
 * It is presentational and controlled: it holds no state. Selection is UI state that PLAN M5.5's
 * action panel has to read as well, so it is owned above both of them and arrives as a prop;
 * `mappanel.tsx` is the thin wrapper that reads the view off the store.
 *
 * The overlay layer is drawn over the river and under the edges and nodes, which is where PLAN
 * M5.3b's belief heatmap belongs, and it does not take pointer events, so a node click cannot be
 * swallowed by the heat drawn beneath it.
 *
 * Nodes and edges are ARIA options inside one listbox rather than buttons: SVG has no native
 * button, `role="button"` on a `<g>` is what Biome's `useSemanticElements` refuses, and an option
 * is the role that can carry `aria-selected`, which is the state this map actually has.
 *
 * Colours and measurements are one table, `MapTheme`, passed in rather than captured (the
 * `SvgTheme` precedent in `packages/sim/src/svg.ts`). The values are `theme.ts`'s `MAP_THEME`
 * (PLAN M5.7); this file keeps only the type, which is the renderer's own contract.
 *
 * **The glow filter is PLAN M5.7's "thin glowing roads".** `<defs>` declares one
 * `feGaussianBlur` + `feMerge` filter and every edge line references it: blurring the line's own
 * `SourceGraphic` and merging the crisp original back on top glows each edge kind in its own
 * stroke colour, with no second colour token to name for the glow itself.
 *
 * **The map surface is PLAN M6.4's Door Kickers pass**, and it is drawn in this document order,
 * which is a contract: ground plate, district blocks, day/night wash, river channel (with its
 * bridge decks), overlay, edges, nodes, exit gates. The river -> overlay -> edges -> nodes order
 * is pinned by `maprenderer.test.tsx`, so every new layer goes before the river or after the
 * nodes. The wash sits under the river rather than over the nodes so that night dims the city and
 * never the player's own instruments. Each road is three strokes: the glow `<line>` (still the one
 * line per edge carrying the filter), a dark casing, and the kind's fill on top.
 *
 * **The actors are PLAN M6.5's and live in `mapactors.tsx`**: unit pips, the selection reticle,
 * the checkpoint barrier, the hidden focus outline, and the located `civilian_hurt` markers in
 * their own layer after the exit gates. `selectableKind` dims what an armed action cannot target;
 * it changes how a target looks, never what clicking it reports.
 *
 * **Recent reports are pinned (PLAN M6.6)** in `map-report-pins`, between the exit gates and the
 * incidents, so after the nodes and clear of the pinned order. Like both of those layers it takes
 * no pointer events. The belief field itself is still whatever the caller puts in the overlay.
 *
 * The plate is `mapgeometry.ts`'s `plateBoundsOf` over every drawn point, and it is both the
 * `viewBox` and the rectangle the district cells tile, so the two cannot disagree by a padding.
 * The belief contour clips its cells from the same helper.
 */

import {
  BALANCE,
  blockedEdgeIdsAt,
  type DaylightHours,
  type DistrictType,
  type EdgeId,
  type EdgeKind,
  type Exit,
  type ExitKind,
  type HunterView,
  type MapEdge,
  type MapNode,
  type NodeId,
  type Position,
  type River,
  type TimeOfDay,
  timeOfDayAt,
} from "@manhunter/core";
import type { ReactNode } from "react";
import { type DistrictBlock, districtBlocksOf } from "./districtblocks";
import type { CellBounds } from "./districtcells";
import { LIMITS } from "./limits";
import {
  type MapCheckpointStyle,
  MapEdgeLine,
  type MapFocusStyle,
  type MapHarmStyle,
  type MapIncidentRingStyle,
  MapIncidents,
  MapNodeMarker,
  type MapPipStyle,
  type MapReticleStyle,
  ROAD_GLOW_FILTER_ID,
} from "./mapactors";
import { coordinate, MIDPOINT_FRACTION, plateBoundsOf, pointsOf } from "./mapgeometry";
import { locatedIncidentsOf } from "./mapincidents";
import { positionIndexOf } from "./mapnodes";
import { type MapReportPinStyle, MapReportPins } from "./mapreportpins";
import { edgeSelectable, type MapSelectable, nodeSelectable } from "./mapselectable";
import { lastHeardByNodeOf, reportPinsOf } from "./reportpins";
import { type BridgeSpan, bridgeDecksOf, riverChannelOf } from "./riverchannel";
import { MAP_THEME } from "./theme";

export {
  EDGE_LAYERS,
  MAP_CHECKPOINT_TEST_ID,
  MAP_CLASSES,
  MAP_EDGE_TEST_ID,
  MAP_FOCUS_TEST_ID,
  MAP_INCIDENT_RING_TEST_ID,
  MAP_INCIDENT_TEST_ID,
  MAP_INCIDENTS_TEST_ID,
  MAP_NODE_TEST_ID,
  MAP_PIP_TEST_ID,
  MAP_SELECTION_TEST_ID,
  ROAD_GLOW_FILTER_ID,
} from "./mapactors";
export { MAP_REPORT_PIN_TEST_ID, MAP_REPORT_PINS_TEST_ID } from "./mapreportpins";

/** What the player has picked on the map. PLAN M5.5 turns one of these into an action target. */
export type MapSelection =
  | { readonly kind: "node"; readonly nodeId: NodeId }
  | { readonly kind: "edge"; readonly edgeId: EdgeId };

/**
 * How one edge kind is drawn: a `casingWidth` casing under a `width` fill, each dashed or solid.
 * A dash is `null` for a solid stroke rather than an empty string.
 */
export type MapEdgeStyle = {
  readonly stroke: string;
  readonly width: number;
  readonly dash: string | null;
  readonly casingWidth: number;
  readonly casingDash: string | null;
};

/** One district type's block: a tone, and a hatch at its own angle (degrees) and spacing. */
export type MapBlockStyle = {
  readonly tone: string;
  readonly hatchAngle: number;
  readonly hatchSpacing: number;
};

/** The wash laid over the plate at one time of day. */
export type MapWashStyle = {
  readonly fill: string;
  readonly opacity: number;
};

/** The river channel, its centreline current and the decks its bridges carry. */
export type MapRiverStyle = {
  readonly water: string;
  /** Full width of the channel, bank to bank, in map units. */
  readonly width: number;
  readonly bank: string;
  readonly bankWidth: number;
  readonly current: string;
  readonly currentWidth: number;
  readonly currentDash: string;
  readonly deckFill: string;
  readonly deckStroke: string;
  readonly deckStrokeWidth: number;
  readonly deckWidth: number;
  /** How far a deck runs onto each bank past the water. */
  readonly deckOverhang: number;
};

/**
 * The gate plate beside an exit node and the glyph inside it. `glyphs` are path data on a
 * `glyphBox`-unit square, scaled into the plate less `inset` on every side.
 */
export type MapExitGateStyle = {
  readonly size: number;
  readonly offset: number;
  readonly inset: number;
  readonly plate: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly glyph: string;
  readonly glyphWidth: number;
  readonly glyphBox: number;
  readonly glyphs: Readonly<Record<ExitKind, string>>;
};

/**
 * Keyed by `EdgeKind` and `DistrictType` rather than switched on, so a new variant is a compile
 * error here instead of a missing branch at render time (architecture rule 6, and the same shape
 * `balance.ts` and the debug export already use).
 */
export type MapTheme = {
  readonly padding: number;
  readonly ground: string;
  /** Ground left between two different districts' blocks, in map units. */
  readonly streetGap: number;
  /** A same-tone stroke round every block, so two cells of one district fuse without a seam. */
  readonly blockSeam: number;
  readonly hatch: string;
  readonly hatchWidth: number;
  readonly hatchOpacity: number;
  readonly blocks: Readonly<Record<DistrictType, MapBlockStyle>>;
  readonly wash: Readonly<Record<TimeOfDay, MapWashStyle>>;
  readonly river: MapRiverStyle;
  readonly exitGate: MapExitGateStyle;
  readonly edgeCasing: string;
  readonly pip: MapPipStyle;
  readonly incidentRing: MapIncidentRingStyle;
  readonly focus: MapFocusStyle;
  readonly reticle: MapReticleStyle;
  /** The fill a selected edge is redrawn in; the reticle carries its own stroke. */
  readonly selectionStroke: string;
  readonly checkpoint: MapCheckpointStyle;
  readonly harm: MapHarmStyle;
  /** Recent reports pinned where they were observed (PLAN M6.6). */
  readonly reportPin: MapReportPinStyle;
  /** Gaussian blur, in SVG user units, on the road-edge glow filter (PLAN M5.7). */
  readonly glowBlur: number;
  readonly edges: Readonly<Record<EdgeKind, MapEdgeStyle>>;
  readonly districts: Readonly<Record<DistrictType, string>>;
};

/** The dispatch palette of DESIGN.md "Visual direction", read from `theme.ts` (PLAN M5.7). */
export const DEFAULT_MAP_THEME: MapTheme = MAP_THEME;

export type MapRendererProps = {
  readonly view: HunterView;
  readonly selection: MapSelection | null;
  readonly onSelect: (selection: MapSelection) => void;
  /** Drawn over the river and under the edges and nodes. PLAN M5.3b's heatmap goes here. */
  readonly overlay?: ReactNode;
  /**
   * Which hours are night (`balance.time`), read with `view.clock.hour` through `timeOfDayAt`
   * to pick the wash (PLAN M6.4). `MapPanel` passes the running hunt's own balance; the default
   * is the shipped one, for a renderer drawn outside a hunt.
   */
  readonly daylight?: DaylightHours;
  /**
   * What the armed action can target (PLAN M6.5); everything else is dimmed. `null` or absent is
   * nothing armed. Dimming is presentation only: a dimmed target reports its click as before.
   */
  readonly selectableKind?: MapSelectable | null;
  readonly theme?: MapTheme;
};

export const MAP_TEST_ID = "map";
export const MAP_RIVER_TEST_ID = "map-river";
export const MAP_OVERLAY_TEST_ID = "map-overlay";
export const MAP_PLATE_TEST_ID = "map-plate";
export const MAP_BLOCKS_TEST_ID = "map-blocks";
export const MAP_BLOCK_TEST_ID = "map-block";
export const MAP_BLOCK_CELL_TEST_ID = "map-block-cell";
export const MAP_WASH_TEST_ID = "map-wash";
export const MAP_RIVER_CHANNEL_TEST_ID = "map-river-channel";
export const MAP_RIVER_CURRENT_TEST_ID = "map-river-current";
export const MAP_BRIDGE_DECK_TEST_ID = "map-bridge-deck";
export const MAP_EXIT_GATES_TEST_ID = "map-exit-gates";
export const MAP_EXIT_GATE_TEST_ID = "map-exit-gate";

const MAP_LABEL = "City map";
const TARGETS_LABEL = "Selectable map targets";
const NO_FILL = "none";
const NO_POINTER_EVENTS = "none";
const ROUND_CAP = "round";
const MITER_JOIN = "miter";
const ROAD_GLOW_REGION = "-75%";
const ROAD_GLOW_REGION_SPAN = "250%";
const SOURCE_GRAPHIC = "SourceGraphic";
const ROAD_GLOW_BLUR_RESULT = "blurred";

/** A polyline needs two points; a river of fewer is a city with none. */
const RIVER_MIN_POINTS = 2;

/** A polygon needs three vertices to have an inside; a block inset to less is not drawn. */
const POLYGON_MIN_POINTS = 3;

/** Each district's hatch pattern is `<prefix><districtType>`, which is a valid XML id. */
const BLOCK_PATTERN_PREFIX = "map-block-";

const widthOf = (bounds: CellBounds): number => bounds.maxX - bounds.minX;

const heightOf = (bounds: CellBounds): number => bounds.maxY - bounds.minY;

const viewBoxOf = (bounds: CellBounds): string =>
  [bounds.minX, bounds.minY, widthOf(bounds), heightOf(bounds)].map(coordinate).join(" ");

const exitIndex = (exits: readonly Exit[]): ReadonlyMap<NodeId, ExitKind> =>
  new Map(exits.map((exit) => [exit.nodeId, exit.kind]));

/** An edge naming a node the map does not contain is skipped rather than drawn to nowhere. */
export type PlacedEdge = {
  readonly edge: MapEdge;
  readonly from: Position;
  readonly to: Position;
};

const placedEdges = (
  edges: readonly MapEdge[],
  positions: ReadonlyMap<NodeId, Position>,
): readonly PlacedEdge[] =>
  edges.flatMap((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (from === undefined || to === undefined) return [];

    return [{ edge, from, to }];
  });

/**
 * Blurs the edge line's own rendering and merges the crisp original back on top, so a road glows
 * in its own stroke colour rather than a second, separately-tuned glow colour (PLAN M5.7).
 */
const RoadGlowFilter = ({ blur }: { readonly blur: number }) => (
  <defs>
    <filter
      id={ROAD_GLOW_FILTER_ID}
      x={ROAD_GLOW_REGION}
      y={ROAD_GLOW_REGION}
      width={ROAD_GLOW_REGION_SPAN}
      height={ROAD_GLOW_REGION_SPAN}
    >
      <feGaussianBlur in={SOURCE_GRAPHIC} stdDeviation={blur} result={ROAD_GLOW_BLUR_RESULT} />
      <feMerge>
        <feMergeNode in={ROAD_GLOW_BLUR_RESULT} />
        <feMergeNode in={SOURCE_GRAPHIC} />
      </feMerge>
    </filter>
  </defs>
);

/** The ground every block sits on; what shows through a street gap. */
const MapPlate = ({ bounds, theme }: { readonly bounds: CellBounds; readonly theme: MapTheme }) => (
  <rect
    data-testid={MAP_PLATE_TEST_ID}
    x={coordinate(bounds.minX)}
    y={coordinate(bounds.minY)}
    width={coordinate(widthOf(bounds))}
    height={coordinate(heightOf(bounds))}
    fill={theme.ground}
  />
);

type DistrictGroup = {
  readonly districtType: DistrictType;
  readonly blocks: readonly DistrictBlock[];
};

/** Blocks grouped by district type, in the order each type first appears in the node list. */
const districtGroupsOf = (blocks: readonly DistrictBlock[]): readonly DistrictGroup[] => {
  const types = [...new Set(blocks.map((block) => block.districtType))];

  return types.map((districtType) => ({
    districtType,
    blocks: blocks.filter(
      (block) => block.districtType === districtType && block.polygon.length >= POLYGON_MIN_POINTS,
    ),
  }));
};

const blockPatternIdOf = (districtType: DistrictType): string =>
  `${BLOCK_PATTERN_PREFIX}${districtType}`;

/**
 * A district's tone with its hatch over it, as one pattern in map space, so the hatch runs on
 * unbroken across every cell of the district rather than restarting at each one.
 */
const MapBlockPattern = ({
  districtType,
  theme,
}: {
  readonly districtType: DistrictType;
  readonly theme: MapTheme;
}) => {
  const style = theme.blocks[districtType];
  const spacing = style.hatchSpacing;
  const middle = coordinate(spacing * MIDPOINT_FRACTION);

  return (
    <pattern
      id={blockPatternIdOf(districtType)}
      patternUnits="userSpaceOnUse"
      width={spacing}
      height={spacing}
      patternTransform={`rotate(${style.hatchAngle})`}
    >
      <rect width={spacing} height={spacing} fill={style.tone} />
      <path
        d={`M${middle} 0 V${spacing}`}
        stroke={theme.hatch}
        strokeWidth={theme.hatchWidth}
        strokeOpacity={theme.hatchOpacity}
      />
    </pattern>
  );
};

/**
 * One district type's blocks. The same-tone seam stroke closes the hairline a renderer leaves
 * between two abutting polygons, so a district reads as one blob rather than a patchwork.
 */
const MapDistrictBlock = ({
  group,
  theme,
}: {
  readonly group: DistrictGroup;
  readonly theme: MapTheme;
}) => (
  <g
    data-testid={MAP_BLOCK_TEST_ID}
    data-district={group.districtType}
    fill={`url(#${blockPatternIdOf(group.districtType)})`}
    stroke={theme.blocks[group.districtType].tone}
    strokeWidth={theme.blockSeam}
    strokeLinejoin={ROUND_CAP}
  >
    {group.blocks.map((block) => (
      <polygon
        key={block.nodeId}
        data-testid={MAP_BLOCK_CELL_TEST_ID}
        data-nodeid={block.nodeId}
        points={pointsOf(block.polygon)}
      />
    ))}
  </g>
);

type MapBlocksProps = {
  readonly nodes: readonly MapNode[];
  readonly bounds: CellBounds;
  readonly theme: MapTheme;
};

/** District blocks (PLAN M6.4). A node list over the cell cap draws no blocks rather than throwing. */
const MapBlocks = ({ nodes, bounds, theme }: MapBlocksProps) => {
  const result = districtBlocksOf(nodes, bounds, theme.streetGap);
  if (result.kind !== "blocks") return null;
  const groups = districtGroupsOf(result.blocks);

  return (
    <g data-testid={MAP_BLOCKS_TEST_ID}>
      <defs>
        {groups.map((group) => (
          <MapBlockPattern
            key={group.districtType}
            districtType={group.districtType}
            theme={theme}
          />
        ))}
      </defs>
      {groups.map((group) => (
        <MapDistrictBlock key={group.districtType} group={group} theme={theme} />
      ))}
    </g>
  );
};

type MapDaylightWashProps = {
  readonly bounds: CellBounds;
  readonly timeOfDay: TimeOfDay;
  readonly theme: MapTheme;
};

/** The clock's wash over the ground and the blocks (DESIGN.md "Day and night are visible"). */
const MapDaylightWash = ({ bounds, timeOfDay, theme }: MapDaylightWashProps) => {
  const wash = theme.wash[timeOfDay];

  return (
    <rect
      data-testid={MAP_WASH_TEST_ID}
      data-timeofday={timeOfDay}
      x={coordinate(bounds.minX)}
      y={coordinate(bounds.minY)}
      width={coordinate(widthOf(bounds))}
      height={coordinate(heightOf(bounds))}
      fill={wash.fill}
      fillOpacity={wash.opacity}
      style={{ pointerEvents: NO_POINTER_EVENTS }}
    />
  );
};

const bridgeSpansOf = (placed: readonly PlacedEdge[]): readonly BridgeSpan[] =>
  placed
    .filter((each) => each.edge.kind === "bridge")
    .map((each) => ({ edgeId: each.edge.id, from: each.from, to: each.to }));

type MapRiverChannelProps = {
  readonly river: River | null;
  readonly placed: readonly PlacedEdge[];
  readonly theme: MapTheme;
};

/**
 * The river built as a channel rather than a thick line (PLAN M6.4): the water band with its
 * banks, the dashed current down the course `core` drew, and a deck wherever a bridge crosses.
 * Keeps `map-river` as the group's test id, which is what the pinned layer order is measured by.
 */
const MapRiverChannel = ({ river, placed, theme }: MapRiverChannelProps) => {
  if (river === null || river.points.length < RIVER_MIN_POINTS) return null;
  const style = theme.river;
  const channel = riverChannelOf(river.points, style.width);
  if (channel.kind !== "channel") return null;
  const decks = bridgeDecksOf(bridgeSpansOf(placed), channel.course, {
    channelWidth: style.width,
    deckWidth: style.deckWidth,
    overhang: style.deckOverhang,
  });

  return (
    <g data-testid={MAP_RIVER_TEST_ID}>
      <polygon
        data-testid={MAP_RIVER_CHANNEL_TEST_ID}
        points={pointsOf(channel.outline)}
        fill={style.water}
        stroke={style.bank}
        strokeWidth={style.bankWidth}
        strokeLinejoin={MITER_JOIN}
      />
      <polyline
        data-testid={MAP_RIVER_CURRENT_TEST_ID}
        points={pointsOf(river.points)}
        fill={NO_FILL}
        stroke={style.current}
        strokeWidth={style.currentWidth}
        strokeDasharray={style.currentDash}
        strokeLinejoin={MITER_JOIN}
      />
      {decks.map((deck) => (
        <polygon
          key={deck.edgeId}
          data-testid={MAP_BRIDGE_DECK_TEST_ID}
          data-edgeid={deck.edgeId}
          points={pointsOf(deck.polygon)}
          fill={style.deckFill}
          stroke={style.deckStroke}
          strokeWidth={style.deckStrokeWidth}
        />
      ))}
    </g>
  );
};

type MapExitGateProps = {
  readonly exit: Exit;
  readonly position: Position;
  readonly theme: MapTheme;
};

/**
 * A gate plate up and to the right of an exit node, carrying its `ExitKind` glyph. Takes no
 * pointer events (its layer says so), so a click on it still reaches the node beneath.
 */
const MapExitGate = ({ exit, position, theme }: MapExitGateProps) => {
  const gate = theme.exitGate;
  const left = position.x + gate.offset - gate.size * MIDPOINT_FRACTION;
  const top = position.y - gate.offset - gate.size * MIDPOINT_FRACTION;
  const scale = (gate.size - gate.inset - gate.inset) / gate.glyphBox;
  const glyphAt = `translate(${coordinate(left + gate.inset)} ${coordinate(top + gate.inset)})`;

  return (
    <g data-testid={MAP_EXIT_GATE_TEST_ID} data-exit={exit.kind} data-nodeid={exit.nodeId}>
      <rect
        x={coordinate(left)}
        y={coordinate(top)}
        width={gate.size}
        height={gate.size}
        fill={gate.plate}
        stroke={gate.stroke}
        strokeWidth={gate.strokeWidth}
      />
      <path
        d={gate.glyphs[exit.kind]}
        transform={`${glyphAt} scale(${coordinate(scale)})`}
        fill={NO_FILL}
        stroke={gate.glyph}
        strokeWidth={gate.glyphWidth}
        strokeLinecap={ROUND_CAP}
        strokeLinejoin={ROUND_CAP}
      />
    </g>
  );
};

type MapExitGatesProps = {
  readonly exits: readonly Exit[];
  readonly positions: ReadonlyMap<NodeId, Position>;
  readonly theme: MapTheme;
};

const MapExitGates = ({ exits, positions, theme }: MapExitGatesProps) => (
  <g data-testid={MAP_EXIT_GATES_TEST_ID} style={{ pointerEvents: NO_POINTER_EVENTS }}>
    {exits.flatMap((exit) => {
      const position = positions.get(exit.nodeId);
      if (position === undefined) return [];

      return [<MapExitGate key={exit.nodeId} exit={exit} position={position} theme={theme} />];
    })}
  </g>
);

export const MapRenderer = ({
  view,
  selection,
  onSelect,
  overlay,
  daylight = BALANCE.time,
  selectableKind = null,
  theme = DEFAULT_MAP_THEME,
}: MapRendererProps) => {
  const { map } = view;
  const positions = positionIndexOf(map.nodes);
  const exits = exitIndex(map.exits);
  const placed = placedEdges(map.edges, positions);
  const blockedEdgeIds = blockedEdgeIdsAt(view.hunter.containments, view.clock.turn);
  const selectedNodeId = selection?.kind === "node" ? selection.nodeId : null;
  const selectedEdgeId = selection?.kind === "edge" ? selection.edgeId : null;
  const bounds = plateBoundsOf(map, theme.padding);
  const timeOfDay = timeOfDayAt(daylight, view.clock.hour);
  const incidents = locatedIncidentsOf(view.events);
  const harmedNodeIds = new Set(incidents.map((incident) => incident.nodeId));
  const nodesSelectable = nodeSelectable(selectableKind);
  const pinSet = reportPinsOf(
    view.reports,
    view.clock.turn,
    { maxAge: theme.reportPin.maxAge, maxPins: LIMITS.maxReportPins },
    theme.reportPin.staleness,
  );

  return (
    <svg
      aria-label={MAP_LABEL}
      data-testid={MAP_TEST_ID}
      data-timeofday={timeOfDay}
      viewBox={viewBoxOf(bounds)}
    >
      <RoadGlowFilter blur={theme.glowBlur} />
      <MapPlate bounds={bounds} theme={theme} />
      <MapBlocks nodes={map.nodes} bounds={bounds} theme={theme} />
      <MapDaylightWash bounds={bounds} timeOfDay={timeOfDay} theme={theme} />
      <MapRiverChannel river={map.river} placed={placed} theme={theme} />
      <g data-testid={MAP_OVERLAY_TEST_ID} style={{ pointerEvents: NO_POINTER_EVENTS }}>
        {overlay}
      </g>
      <g role="listbox" aria-label={TARGETS_LABEL}>
        {placed.map((each) => (
          <MapEdgeLine
            key={each.edge.id}
            placed={each}
            blocked={blockedEdgeIds.has(each.edge.id)}
            selected={each.edge.id === selectedEdgeId}
            selectable={edgeSelectable(selectableKind, each.edge)}
            theme={theme}
            onSelect={onSelect}
          />
        ))}
        {map.nodes.map((node) => (
          <MapNodeMarker
            key={node.id}
            node={node}
            facts={{
              exitKind: exits.get(node.id),
              isIncident: node.id === map.incidentNodeId,
              harmed: harmedNodeIds.has(node.id),
            }}
            selected={node.id === selectedNodeId}
            selectable={nodesSelectable}
            theme={theme}
            onSelect={onSelect}
          />
        ))}
      </g>
      <MapExitGates exits={map.exits} positions={positions} theme={theme} />
      <MapReportPins
        pinSet={pinSet}
        lastHeard={lastHeardByNodeOf(view.reports)}
        currentTurn={view.clock.turn}
        positions={positions}
        style={theme.reportPin}
      />
      <MapIncidents incidents={incidents} positions={positions} theme={theme} />
    </svg>
  );
};
