/**
 * What the armed action can be pointed at, in the shape the map needs to dim everything else
 * (PLAN M6.5, the additive `selectableKind` prop M5.5a's note reserved).
 *
 * The renderer only reads this; it never decides it. `selectableOf` is called by the dispatch
 * screen, which owns the armed action, and it asks `core` both questions: `targetKindOf` for which
 * kind of target, and `balance.edges[kind].blockable` for which edges. Every edge-targeting action
 * `core` has is a checkpoint and is refused on an unblockable edge (`edge_not_blockable`), so a
 * footpath visibly cannot be blocked rather than failing after the turn is dispatched.
 *
 * Dimming is presentation only. A dimmed target still reports its click exactly as before; the
 * screen's own `select` is still what drops a click the armed action cannot use.
 *
 * **Closed edges (PLAN M7.3).** An edge that already carries a checkpoint is refused a second
 * (`edge_already_blocked`), so `selectableOf` also takes the ids of the edges that are closed:
 * the standing containments, and the roadblocks the plan already holds, because `core` applies a
 * turn's orders in order and the second of two blocks on one edge is refused the same way.
 * `closedEdgeIdsOf` gathers both. And `select` now asks `selectionSelectable` before taking a
 * click, so a dimmed target is a refused target, not only a quieter one.
 */

import {
  type Balance,
  blockedEdgeIdsAt,
  type Containment,
  type EdgeId,
  type EdgeKind,
  type HunterActionKind,
  type MapEdge,
  type Turn,
  targetKindOf,
} from "@manhunter/core";
import type { ActionQueue } from "./actionqueue";
import type { MapSelection } from "./maprenderer";

export type MapSelectable =
  | { readonly kind: "node" }
  | {
      readonly kind: "edge";
      readonly edgeKinds: readonly EdgeKind[];
      /** Edges already closed, by a standing checkpoint or one the plan holds. */
      readonly closedEdgeIds: readonly EdgeId[];
    }
  | { readonly kind: "none" };

type EdgeTable = Balance["edges"];

const isEdgeKindIn =
  (edges: EdgeTable) =>
  (key: string): key is EdgeKind =>
    key in edges;

const blockableKindsOf = (edges: EdgeTable): readonly EdgeKind[] =>
  Object.keys(edges)
    .filter(isEdgeKindIn(edges))
    .filter((kind) => edges[kind].blockable);

/** The edges a checkpoint already closes this turn, standing or planned, as a plain list. */
export const closedEdgeIdsOf = (
  containments: readonly Containment[],
  turn: Turn,
  queue: ActionQueue,
): readonly EdgeId[] => [
  ...blockedEdgeIdsAt(containments, turn),
  ...queue.flatMap((action) => (action.kind === "roadblock" ? [action.edgeId] : [])),
];

export const selectableOf = (
  kind: HunterActionKind,
  edges: EdgeTable,
  closedEdgeIds: readonly EdgeId[],
): MapSelectable => {
  const target = targetKindOf(kind);
  if (target === "global") return { kind: "none" };
  if (target === "node") return { kind: "node" };

  return { kind: "edge", edgeKinds: blockableKindsOf(edges), closedEdgeIds };
};

/** `null` is nothing armed, so every target on the map is live. */
export const nodeSelectable = (selectable: MapSelectable | null): boolean =>
  selectable === null || selectable.kind === "node";

export const edgeSelectable = (selectable: MapSelectable | null, edge: MapEdge): boolean => {
  if (selectable === null) return true;
  if (selectable.kind !== "edge") return false;

  return selectable.edgeKinds.includes(edge.kind) && !selectable.closedEdgeIds.includes(edge.id);
};

/**
 * The same question the map dims by, asked of a click: a node by kind alone, an edge by the edge
 * it names. An edge the map does not carry is not selectable.
 */
export const selectionSelectable = (
  selectable: MapSelectable | null,
  selection: MapSelection,
  edges: readonly MapEdge[],
): boolean => {
  if (selection.kind === "node") return nodeSelectable(selectable);

  const edge = edges.find((candidate) => candidate.id === selection.edgeId);

  return edge !== undefined && edgeSelectable(selectable, edge);
};
