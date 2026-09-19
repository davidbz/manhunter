/**
 * Things that happen to the world (DESIGN.md "Events"). Each variant is the payload of one entry
 * in the event table (`eventtable.ts`), which holds the trigger, weight and effect beside it:
 * adding an event is a new entry plus a new variant here, never a new branch in the turn loop.
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

/** Which side of architecture rule 4 a variant falls on. */
export type EventVisibility = "hunter_visible" | "hidden";

/**
 * Which variants the hunter may see in their own shape, declared as data the way
 * `HIDDEN_REPORT_FIELDS` is. `eyewitness` and `prank_call` are hidden because their kind says
 * what a report is, which is the one thing the hidden report fields exist to hide: an unredacted
 * feed would undo them.
 *
 * Keyed by every kind rather than listing the hidden ones, so a new variant is a compile error
 * here until it says which side it falls on - which is what stops one defaulting *into* the view
 * (PLAN M3.2's note). `HiddenEventKind` and `view.ts`'s redaction are both read off this table,
 * so the projection and its type cannot drift.
 */
export const EVENT_VISIBILITY = {
  eyewitness: "hidden",
  prank_call: "hidden",
  civilian_hurt: "hunter_visible",
  nightfall: "hunter_visible",
  rush_hour: "hunter_visible",
} as const satisfies Readonly<Record<GameEventKind, EventVisibility>>;

export type HiddenEventKind = {
  [Kind in GameEventKind]: (typeof EVENT_VISIBILITY)[Kind] extends "hidden" ? Kind : never;
}[GameEventKind];

export type HiddenEvent = Extract<GameEvent, { readonly kind: HiddenEventKind }>;

export const isHiddenEventKind = (kind: GameEventKind): kind is HiddenEventKind =>
  EVENT_VISIBILITY[kind] === "hidden";
