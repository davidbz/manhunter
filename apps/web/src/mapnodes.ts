/**
 * A `MapNode` list, indexed by id. `maprenderer.tsx` and `beliefoverlay.tsx` each carried an
 * identical six-line copy of this (PLAN M5.3b's note: "worth a shared `nodes.ts` helper the
 * first time a third overlay needs it, which M5.6b's criminal path will"). This is that third
 * overlay, so the two copies now import from here instead of a third one being written.
 */

import type { MapNode, NodeId, Position } from "@manhunter/core";

export const positionIndexOf = (nodes: readonly MapNode[]): ReadonlyMap<NodeId, Position> =>
  new Map(nodes.map((node) => [node.id, node.position]));
