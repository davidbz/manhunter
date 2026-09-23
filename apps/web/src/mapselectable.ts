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
 */

import {
  type Balance,
  type EdgeKind,
  type HunterActionKind,
  type MapEdge,
  targetKindOf,
} from "@manhunter/core";

export type MapSelectable =
  | { readonly kind: "node" }
  | { readonly kind: "edge"; readonly edgeKinds: readonly EdgeKind[] }
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

export const selectableOf = (kind: HunterActionKind, edges: EdgeTable): MapSelectable => {
  const target = targetKindOf(kind);
  if (target === "global") return { kind: "none" };
  if (target === "node") return { kind: "node" };

  return { kind: "edge", edgeKinds: blockableKindsOf(edges) };
};

/** `null` is nothing armed, so every target on the map is live. */
export const nodeSelectable = (selectable: MapSelectable | null): boolean =>
  selectable === null || selectable.kind === "node";

export const edgeSelectable = (selectable: MapSelectable | null, edge: MapEdge): boolean => {
  if (selectable === null) return true;
  if (selectable.kind !== "edge") return false;

  return selectable.edgeKinds.includes(edge.kind);
};
