/**
 * The city: a graph of districts joined by typed edges (DESIGN.md "The map").
 *
 * Nodes and edges are held as arrays rather than keyed records because architecture rule 3 bans
 * `Map`/`Set` from state and array order is the stable iteration order determinism needs. Index
 * structures for neighbour lookup are built by the path logic (PLAN M1.4a), not stored here.
 */

import type { EdgeId, NodeId } from "./ids";
import type { Turn } from "./time";

export type DistrictType =
  | "downtown"
  | "residential"
  | "suburb"
  | "industrial"
  | "park"
  | "transit_hub"
  | "exit";

export type TravelMode = "foot" | "car" | "transit";

export type EdgeKind = "road" | "footpath" | "rail" | "tunnel" | "bridge";

/** Layout coordinates, used by the SVG debug export (PLAN M2.4) and the renderer (PLAN M5.3). */
export type Position = {
  readonly x: number;
  readonly y: number;
};

export type MapNode = {
  readonly id: NodeId;
  readonly districtType: DistrictType;
  readonly position: Position;
};

type EdgeOf<Kind extends EdgeKind> = {
  readonly kind: Kind;
  readonly id: EdgeId;
  readonly from: NodeId;
  readonly to: NodeId;
};

export type RoadEdge = EdgeOf<"road">;
export type FootpathEdge = EdgeOf<"footpath">;
export type RailEdge = EdgeOf<"rail">;
export type TunnelEdge = EdgeOf<"tunnel">;
export type BridgeEdge = EdgeOf<"bridge">;

/**
 * Edges carry the same payload today and are still declared as a union: every consumer switches
 * exhaustively on `kind`, so a variant that later needs an extra field costs nothing to add.
 */
export type MapEdge = RoadEdge | FootpathEdge | RailEdge | TunnelEdge | BridgeEdge;

/** Cost of traversing an edge in one travel mode, or `null` when that mode cannot use it. */
export type TravelCost = number | null;

/**
 * What an edge kind means in the rules. The table filling this in is balance data and lives in
 * `balance.ts` (PLAN M1.3); only its shape belongs to the type layer.
 */
export type EdgeProperties = {
  readonly costByMode: Readonly<Record<TravelMode, TravelCost>>;
  readonly blockable: boolean;
};

export type ExitKind = "airport" | "port" | "border" | "highway";

/**
 * When an exit can be used. Timed exits (the ferry, the night-only smuggler) are post-MVP
 * content, but the variant is declared now so adding one is an entry, not a type change.
 */
export type ExitSchedule =
  | { readonly kind: "always" }
  | { readonly kind: "timed"; readonly openTurns: readonly Turn[] };

export type Exit = {
  readonly nodeId: NodeId;
  readonly kind: ExitKind;
  readonly schedule: ExitSchedule;
};

export type MapGraph = {
  readonly nodes: readonly MapNode[];
  readonly edges: readonly MapEdge[];
  readonly exits: readonly Exit[];
  /**
   * Where the hunt begins: the crime scene, which is also the criminal's start node. Known to
   * both sides, which is why a `MapGraph` may be handed to the hunter whole. Anything the hunter
   * must not know lives in `CriminalState` (architecture rule 4).
   */
  readonly incidentNodeId: NodeId;
};

const ALWAYS_OPEN: ExitSchedule = { kind: "always" };

export const makeNode = (id: NodeId, districtType: DistrictType, position: Position): MapNode => ({
  id,
  districtType,
  position,
});

export const makeEdge = <Kind extends EdgeKind>(
  kind: Kind,
  id: EdgeId,
  from: NodeId,
  to: NodeId,
): EdgeOf<Kind> => ({ kind, id, from, to });

export const makeExit = (
  nodeId: NodeId,
  kind: ExitKind,
  schedule: ExitSchedule = ALWAYS_OPEN,
): Exit => ({ nodeId, kind, schedule });
