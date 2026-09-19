/**
 * The visibility split (architecture rule 4). Three types, designed together:
 *
 * - `WorldState` (in `world.ts`) is everything, and stays inside `core`.
 * - `HunterView` is what the player may see during a hunt. It has no `criminal` member and no
 *   `config` member, so neither the criminal's position nor its profile can reach the UI.
 * - `RevealFrame` is what the after-action replay may see, once the game is over: a hunter view
 *   plus the criminal's true position for that turn, and nothing else (PLAN M3.9, M5.6).
 *
 * `toHunterView` is the one projection that produces the middle type, and it is a bare function
 * rather than a `create*` factory because it takes no deps and reads no balance. It takes a
 * `SealedWorld` like every other exported game function, and unseals it here.
 *
 * Three things leave the world on the way through, and each is hidden for its own reason: the
 * criminal and the config are absent from the type; reports that have not landed yet are filtered
 * out by the clock; and the two fields and two event variants that would name a report's nature
 * are redacted from the data lists that declare them.
 */

import { type GameEvent, HIDDEN_EVENT_KINDS, type HiddenEvent } from "./events";
import type { HunterState } from "./hunter";
import type { NodeId, ReportId } from "./ids";
import type { MapGraph } from "./map";
import type { HiddenReportField, Report } from "./report";
import { type SealedWorld, unseal } from "./sealed";
import type { Clock, Turn } from "./time";
import type { GameOutcome } from "./world";

/** A report with its hidden fields removed. Derived from `Report` so the two cannot drift. */
export type HunterReport = Omit<Report, HiddenReportField>;

/**
 * What a hidden event becomes. The feed still learns that a report landed, which is what the
 * report list needs to highlight it, and stops learning whether it was a sighting or a prank.
 * Telling those apart is the player's job (DESIGN.md "Reports").
 */
export type ReportArrivedEvent = {
  readonly kind: "report_arrived";
  readonly turn: Turn;
  readonly reportId: ReportId;
};

/** Derived from `HIDDEN_EVENT_KINDS`, so a variant cannot be redacted in one place only. */
export type HunterEvent = Exclude<GameEvent, HiddenEvent> | ReportArrivedEvent;

export type HunterView = {
  readonly clock: Clock;
  readonly map: MapGraph;
  readonly hunter: HunterState;
  /** Only reports that have landed by `clock.turn`. */
  readonly reports: readonly HunterReport[];
  readonly events: readonly HunterEvent[];
  readonly casualties: number;
  /** Derived from the config, which the hunter may not see, because it names the profile. */
  readonly turnsRemaining: Turn;
  readonly outcome: GameOutcome;
};

export type RevealFrame = {
  readonly turn: Turn;
  readonly view: HunterView;
  readonly criminalNodeId: NodeId;
};

const NO_TURNS_REMAINING: Turn = 0;

/**
 * Listing the visible fields rather than deleting the hidden ones keeps the redaction typed: a
 * new field on `Report` is a compile error here until `HIDDEN_REPORT_FIELDS` says which side of
 * the line it falls on.
 */
const redactReport = (report: Report): HunterReport => ({
  id: report.id,
  source: report.source,
  observedAtTurn: report.observedAtTurn,
  receivedAtTurn: report.receivedAtTurn,
  content: report.content,
});

const isHidden = (event: GameEvent): event is HiddenEvent =>
  HIDDEN_EVENT_KINDS.some((kind) => kind === event.kind);

const redactEvent = (event: GameEvent): HunterEvent =>
  isHidden(event) ? { kind: "report_arrived", turn: event.turn, reportId: event.reportId } : event;

export const toHunterView = (world: SealedWorld): HunterView => {
  const state = unseal(world);
  const now = state.clock.turn;

  return {
    clock: state.clock,
    map: state.map,
    hunter: state.hunter,
    reports: state.reports
      .filter((report) => report.receivedAtTurn <= now)
      .map((report) => redactReport(report)),
    events: state.events.map((event) => redactEvent(event)),
    casualties: state.casualties,
    turnsRemaining: Math.max(state.config.maxTurns - now, NO_TURNS_REMAINING),
    outcome: state.outcome,
  };
};
