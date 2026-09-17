/**
 * Things that happen to the world (DESIGN.md "Events"). Each variant is the payload of one entry
 * in the event table (PLAN M3.7), which holds the trigger, weight and effect beside it: adding an
 * event is a new entry plus a new variant here, never a new branch in the turn loop.
 *
 * Events are part of what the hunter sees. `civilian_hurt` carries a node id on purpose - harm
 * confirms a location, which is the price DESIGN.md attaches to it - so hidden-information tests
 * must look at the shape of `HunterView`, not for node ids anywhere in it.
 */

import type { NodeId, ReportId } from "./ids";
import type { Turn } from "./time";

export type GameEvent =
  | { readonly kind: "eyewitness"; readonly turn: Turn; readonly reportId: ReportId }
  | { readonly kind: "prank_call"; readonly turn: Turn; readonly reportId: ReportId }
  | { readonly kind: "civilian_hurt"; readonly turn: Turn; readonly nodeId: NodeId }
  | { readonly kind: "nightfall"; readonly turn: Turn }
  | { readonly kind: "rush_hour"; readonly turn: Turn };

export type GameEventKind = GameEvent["kind"];
