/**
 * A `MapNode` list, indexed by id. `maprenderer.tsx` and `beliefoverlay.tsx` each carried an
 * identical six-line copy of this (PLAN M5.3b's note: "worth a shared `nodes.ts` helper the
 * first time a third overlay needs it, which M5.6b's criminal path will"). This is that third
 * overlay, so the two copies now import from here instead of a third one being written.
 *
 * **Place names are memoised here per hunt (PLAN M7.1).** Several panels name places, each through
 * a Zustand selector, and a selector must return the same reference for the same state or the
 * panel re-renders on every store write (PLAN M5.4's note). A hunt's `MapGraph` is one object for
 * the whole hunt (`toHunterView` passes it through), so a `WeakMap` keyed on it holds one entry
 * per hunt and lets it go with the hunt. It is a cache of a pure function, not state: removing it
 * changes nothing a caller can observe except allocation.
 */

import type { MapGraph, MapNode, NodeId, Position } from "@manhunter/core";
import type { GameStoreState } from "./gamestore";
import { type PlaceNames, placeNamesOf } from "./placenames";

export const positionIndexOf = (nodes: readonly MapNode[]): ReadonlyMap<NodeId, Position> =>
  new Map(nodes.map((node) => [node.id, node.position]));

type NamedHunt = {
  readonly seed: number;
  readonly gridPitch: number;
  readonly names: PlaceNames;
};

const NAMES_BY_MAP = new WeakMap<MapGraph, NamedHunt>();

/** `placeNamesOf`, computed once per map, seed and pitch. */
export const placeNamesFor = (map: MapGraph, seed: number, gridPitch: number): PlaceNames => {
  const held = NAMES_BY_MAP.get(map);
  if (held !== undefined && held.seed === seed && held.gridPitch === gridPitch) return held.names;

  const names = placeNamesOf(map, seed, gridPitch);
  NAMES_BY_MAP.set(map, { seed, gridPitch, names });

  return names;
};

/** The running hunt's names, as a store selector; `null` before a hunt exists. */
export const huntPlaceNamesOf = (state: GameStoreState): PlaceNames | null =>
  state.hunt === null
    ? null
    : placeNamesFor(state.hunt.view.map, state.hunt.seed, state.balance.map.nodeSpacing);
