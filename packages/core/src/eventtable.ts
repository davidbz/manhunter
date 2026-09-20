/**
 * What happens to the world on its own (DESIGN.md "Events"): the table of things that can happen
 * in a turn, and the one function that fires it.
 *
 * Events are data - trigger condition, weight function, effect handler - so a new event is a new
 * entry here plus a new variant in `events.ts`, and never a branch in `fire` (architecture rule
 * 6). `fire` knows nothing about any particular event.
 *
 * **Weight is how likely a triggered entry is, in [0, 1], not a share of one draw.** Several of
 * DESIGN.md's events can be true of the same turn - nightfall is a fact about the clock, not a
 * lottery against somebody being hurt - so every triggered entry is drawn independently and one
 * that always happens weighs `CERTAIN`. That is also why `rng.weightedPick` is not used: there is
 * no pool to pick a single winner out of, so PLAN M1.1's warning about its uniform fallback does
 * not arise. An entry that no world makes eligible is filtered by its trigger, not by a zero.
 *
 * **Every triggered entry costs exactly one `rng.float`, in table order, whether or not it
 * fires**, the way `intel.ts`'s sources do. An entry whose trigger is false costs nothing. Both
 * are pure functions of the world, so a turn replays identically (architecture rule 2).
 */

import type { Balance } from "./balance";
import type { GameEvent, GameEventKind } from "./events";
import { districtPropertiesAt, witnessDensityAt } from "./exposure";
import type { ReportId } from "./ids";
import type { Report, ReportTruth } from "./report";
import type { Rng, RngDraw } from "./rng";
import type { Hour } from "./time";
import { HOURS_PER_DAY, timeOfDayAt } from "./time";
import type { WorldState } from "./world";

export type EventRequest = {
  readonly world: WorldState;
  readonly balance: Balance;
};

/**
 * The world after the turn's events, and the events themselves. They are also appended to
 * `world.events`, so nothing has to diff the feed to know what fired; the list is here because
 * M3.8a's consequences phase reacts to what happened (pressure jumps on `civilian_hurt`).
 */
export type EventResult = {
  readonly world: WorldState;
  readonly events: readonly GameEvent[];
};

export type EventLogic = {
  readonly fire: (request: EventRequest) => EventResult;
};

type EventDeps = {
  readonly rng: Rng;
};

/**
 * The world as it stood when the phase began. Every trigger, weight and announcement reads this
 * and never the world an earlier entry has already changed: the entries of one turn happen at
 * once, so the table's order decides the stream and nothing else.
 */
type Scene = EventRequest;

/** An entry that always happens when its trigger holds. */
const CERTAIN = 1;
/** A criminal whose profile has no behaviour hurts nobody. */
const NO_CHANCE = 0;
const NOBODY_ABOUT = 0;
const NO_ARRIVALS = 0;
const ONE_CASUALTY = 1;
const ONE_HOUR = 1;
/** The one thing an announcement must never let the hunter tell apart (DESIGN.md "Reports"). */
const INVENTED: ReportTruth = "prank";

/**
 * One thing the world can do in a turn, as data. `announce` may name more than one event, which
 * is what lets an entry that reacts to a list - a report per caller, PLAN M3.7b - stay one entry;
 * `apply` runs once per event it named, so an entry that fires twice costs twice.
 */
type EventDefinition = {
  readonly kind: GameEventKind;
  readonly trigger: (scene: Scene) => boolean;
  readonly weight: (scene: Scene) => number;
  readonly announce: (scene: Scene) => readonly GameEvent[];
  readonly apply: (world: WorldState) => WorldState;
};

/** The variants that announce a report, and therefore the only two that carry a `reportId`. */
type ReportEventKind = Extract<GameEvent, { readonly reportId: ReportId }>["kind"];

/**
 * The reports the intel phase just landed - the filter `toBeliefEvidence` uses, for the same
 * reason. Its position in the turn is what decides the set: events is phase 2 and planning is
 * phase 3, so what this sees is what the city volunteered, never what the hunter asked for on the
 * turn they asked for it (PLAN M3.8a's finding, decided at M3.7b; see the note there).
 */
const arrivals = (scene: Scene): readonly Report[] =>
  scene.world.reports.filter((report) => report.receivedAtTurn === scene.world.clock.turn);

const announced = (scene: Scene, names: (report: Report) => boolean): readonly Report[] =>
  arrivals(scene).filter(names);

/**
 * One entry over the reports of a turn rather than one entry per report: `announce` may name more
 * than one event, so a phone ringing twice is two events out of a single table row, and no loop
 * over reports lives inside `fire` (architecture rule 6, PLAN M3.7a's note).
 *
 * Both are certain, because a report that landed is a fact and not a lottery; the draw they spend
 * is the table's own discipline, not a chance they might not fire.
 */
const announcement = (
  kind: ReportEventKind,
  names: (report: Report) => boolean,
): EventDefinition => ({
  kind,
  trigger: (scene) => announced(scene, names).length > NO_ARRIVALS,
  weight: () => CERTAIN,
  announce: (scene) =>
    announced(scene, names).map((report) => ({
      kind,
      turn: scene.world.clock.turn,
      reportId: report.id,
    })),
  /** Nothing: the report is already in the world, and the event is the city saying so. */
  apply: (world) => world,
});

const isInvented = (report: Report): boolean => report.truth === INVENTED;

/**
 * Somebody who rang in something they saw (DESIGN.md "Events"). Every arrival that is not invented
 * falls here, a mistaken witness included: what they got wrong they got wrong by being wrong, not
 * by lying, and the hunter sees the same `report_arrived` for both anyway (PLAN M3.2).
 */
const EYEWITNESS: EventDefinition = announcement("eyewitness", (report) => !isInvented(report));

/**
 * Somebody who rang in something they made up. This is the variant that makes both of these
 * hidden: its kind names which report is a prank, which is exactly what `truth` is hidden for, so
 * it may only ever reach the hunter through M3.2's projection.
 */
const PRANK_CALL: EventDefinition = announcement("prank_call", isInvented);

const hourBefore = (hour: Hour): Hour => (hour + HOURS_PER_DAY - ONE_HOUR) % HOURS_PER_DAY;

/**
 * The lights going out, which is a transition rather than a state: it is `timeOfDayAt` at this
 * hour against `timeOfDayAt` an hour ago, so the one place that decides what counts as night is
 * still `balance.time` (PLAN M3.4a's note). A hunt that begins exactly at `nightStartHour` opens
 * with it, and one that begins later in the night does not - no turn-zero case, just the clock.
 */
const NIGHTFALL: EventDefinition = {
  kind: "nightfall",
  trigger: ({ world, balance }) =>
    timeOfDayAt(balance.time, world.clock.hour) === "night" &&
    timeOfDayAt(balance.time, hourBefore(world.clock.hour)) === "day",
  weight: () => CERTAIN,
  announce: ({ world }) => [{ kind: "nightfall", turn: world.clock.turn }],
  /** Nothing: the districts already read the hour, so dark is a state the event only announces. */
  apply: (world) => world,
};

/**
 * The city filling up (DESIGN.md "Events"), on the hours `balance.time` names. Unlike nightfall it
 * is read as a state rather than a transition: `rushHourHours` is a list of hours and not a span,
 * so the morning peak announces itself on each of its own hours, which is what the balance says it
 * is. Nothing reads the traffic in the MVP, so like nightfall the entry only announces the clock.
 */
const RUSH_HOUR: EventDefinition = {
  kind: "rush_hour",
  trigger: ({ world, balance }) =>
    balance.time.rushHourHours.some((hour) => hour === world.clock.hour),
  weight: () => CERTAIN,
  announce: ({ world }) => [{ kind: "rush_hour", turn: world.clock.turn }],
  apply: (world) => world,
};

/** How many people are around to be hurt where the criminal is standing, right now. */
const crowdAround = (scene: Scene): number =>
  witnessDensityAt(
    scene.balance.time,
    districtPropertiesAt(scene.balance.districts, scene.world.map, scene.world.criminal.nodeId),
    scene.world.clock.hour,
  );

/**
 * Somebody hurt in the criminal's way out (DESIGN.md "Events"). The trigger is the district, not
 * the criminal: an empty park after dark has nobody in it to hurt, which is the same table that
 * decides who could have seen them pass. The weight is who the criminal is - the profile's
 * `civilianHarmChance`, which is what DESIGN.md means by an amateur being likely to hurt someone.
 *
 * The event names the node on purpose: harm confirms a location, and the hunter is meant to have
 * it (`events.ts`). Casualties are what it costs; the pressure it raises is the consequences
 * phase's (PLAN M3.8a), so it is not applied twice here.
 */
const CIVILIAN_HURT: EventDefinition = {
  kind: "civilian_hurt",
  trigger: (scene) => crowdAround(scene) > NOBODY_ABOUT,
  weight: ({ world, balance }) =>
    balance.criminal.profiles[world.criminal.profile]?.civilianHarmChance ?? NO_CHANCE,
  announce: ({ world }) => [
    { kind: "civilian_hurt", turn: world.clock.turn, nodeId: world.criminal.nodeId },
  ],
  apply: (world) => ({ ...world, casualties: world.casualties + ONE_CASUALTY }),
};

/** In `GameEvent`'s own order, which is the order the stream is drawn in. */
const EVENT_TABLE: readonly EventDefinition[] = [
  EYEWITNESS,
  PRANK_CALL,
  CIVILIAN_HURT,
  NIGHTFALL,
  RUSH_HOUR,
];

type EventDraw = RngDraw<EventResult>;

const fireOne = (
  deps: EventDeps,
  scene: Scene,
  drawn: EventDraw,
  definition: EventDefinition,
): EventDraw => {
  if (!definition.trigger(scene)) {
    return drawn;
  }
  const rolled = deps.rng.float(drawn.state);
  if (rolled.value >= definition.weight(scene)) {
    return { state: rolled.state, value: drawn.value };
  }
  const fired = definition.announce(scene);
  return {
    state: rolled.state,
    value: {
      world: fired.reduce((world) => definition.apply(world), drawn.value.world),
      events: [...drawn.value.events, ...fired],
    },
  };
};

export const createEventLogic = (deps: EventDeps): EventLogic => ({
  fire: ({ world, balance }) => {
    const scene: Scene = { world, balance };
    const nothingYet: EventDraw = { state: world.rng, value: { world, events: [] } };
    const drawn = EVENT_TABLE.reduce(
      (sofar, definition) => fireOne(deps, scene, sofar, definition),
      nothingYet,
    );
    return {
      world: {
        ...drawn.value.world,
        rng: drawn.state,
        events: [...world.events, ...drawn.value.events],
      },
      events: drawn.value.events,
    };
  },
});
