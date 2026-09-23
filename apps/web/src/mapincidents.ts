/**
 * Where harm has been done, read off `HunterView.events` (PLAN M6.5, closing M5.4's Inbox item
 * that the view's events were rendered by nothing).
 *
 * `civilian_hurt` is the one event that names a node, and it names it on purpose: harm confirms a
 * location, which is the price DESIGN.md attaches to it (`core`'s `events.ts`). Every other event
 * kind is about the clock or a report and has no place on the map, so it is skipped here.
 *
 * `view.events` is the whole hunt's list, so a node hurt twice would otherwise stack two markers
 * on one spot; incidents are merged per node, keeping how many and the most recent turn.
 */

import type { HunterEvent, NodeId, Turn } from "@manhunter/core";

export type LocatedIncident = {
  readonly nodeId: NodeId;
  readonly count: number;
  readonly lastTurn: Turn;
};

type CivilianHurt = Extract<HunterEvent, { readonly kind: "civilian_hurt" }>;

const isCivilianHurt = (event: HunterEvent): event is CivilianHurt =>
  event.kind === "civilian_hurt";

const merged = (earlier: LocatedIncident | undefined, event: CivilianHurt): LocatedIncident => ({
  nodeId: event.nodeId,
  count: (earlier?.count ?? 0) + 1,
  lastTurn: Math.max(earlier?.lastTurn ?? event.turn, event.turn),
});

/** One incident per node that has seen harm, in the order each node was first hurt. */
export const locatedIncidentsOf = (events: readonly HunterEvent[]): readonly LocatedIncident[] => {
  const byNode = new Map<NodeId, LocatedIncident>();
  for (const event of events.filter(isCivilianHurt)) {
    byNode.set(event.nodeId, merged(byNode.get(event.nodeId), event));
  }

  return [...byNode.values()];
};
