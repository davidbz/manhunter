/**
 * The after-action replay (DESIGN.md "After-action replay"): a hunt written down as the three
 * things that reproduce it, and the compact URL-safe string that carries it (PLAN M3.9).
 *
 * `setup`, never `config`. The criminal's profile and the hour the hunt began are drawn from the
 * seed inside `createGameLogic.create` (PLAN M3.1a), so neither is stored and a shared link cannot
 * spoil the hunt it replays. What is stored is the seed, the player-visible setup, and the queue
 * the hunter submitted on each turn, in order.
 *
 * `version` is what makes an unreproducible replay detectable rather than silently wrong. The RNG
 * stream is shared by everything that draws, so the order of `EVENT_TABLE`, of the turn phases or
 * of the fork labels decides what a seed plays (PLAN M3.7b's note, which named this task as the
 * first whose artefacts outlive such a change). A replay from another version is refused, never
 * migrated: there is nothing to migrate, because the same actions against a moved stream are a
 * different hunt. Bump `REPLAY_VERSION` whenever anything that moves the stream or the grammar
 * below changes - and, as version 2 records, whenever a rule changes what the same seed and the
 * same queues produce, which is the third way a recording stops reproducing.
 *
 * The string is URL-safe by construction rather than by escaping. Every character it can contain
 * is unreserved in RFC 3986 (`A-Za-z0-9`, `-`, `.`, `_`, `~`), so `encodeURIComponent` leaves it
 * untouched and PLAN M5.6b's share link needs no second layer that a copy-paste could half-undo.
 * `core` has neither `btoa` nor `TextEncoder` (it is built with no DOM and no Node types), which
 * rules out base64; the grammar below is both shorter than base64 over JSON and readable in a
 * bug report.
 *
 *     version . seed . columns . rows . exitCount . maxTurns . difficulty ~turn ~turn ...
 *
 * A turn is its actions joined by `_`, so an empty queue is an empty section. An action is a
 * one-character kind code followed by its target id, which needs no separator because the code is
 * exactly one character wide.
 *
 * Both directions refuse the same things, which is what makes the round trip total: `decode` of
 * anything `encode` produced is the replay that went in, and a replay `encode` refuses is one
 * `decode` would have refused too.
 */

import { type ActionTargetKind, targetKindOf } from "./actions";
import type { Difficulty, GameSetup, MapConfig } from "./config";
import type { HunterAction, HunterActionKind } from "./hunter";
import { makeEdgeId, makeNodeId } from "./ids";
import { LIMITS } from "./limits";
import type { Turn } from "./time";

/**
 * The grammar and the stream below it. See the version note above before changing either.
 *
 * 2 (PLAN M4.2a): neither the grammar nor the stream moved, but `END_CONDITIONS` gained the
 * deadline, so a version 1 recording of a hunt that reached its own `setup.maxTurns` ends
 * `timed_out` where it used to end `in_progress`. Same seed, same queues, different final world -
 * which is exactly what this field exists to make loud.
 *
 * 3 (PLAN M3.11): the stream moved, which is the first trigger above. A criminal that walks into a
 * checkpoint it did not know about is now a draw - taken, or through - so every hunt in which a
 * roadblock was ever hit consumes one number more than it used to, and everything drawn after that
 * collision comes out different. Version 2 recordings of hunts nobody ever blocked would still
 * play, but nothing can tell those apart from the rest without playing them both ways.
 *
 * 4 (PLAN M4.3): the third trigger again, and the first time a balance value rather than a rule
 * pulled it. `actions.roadblock.slipPastChance` moved from 0.6 to 0.7, so a criminal that walked
 * into a checkpoint at the version this recording was written is now taken where it used to get
 * through, or the reverse. The stream does not move - the draw is taken either way (PLAN M3.11) -
 * but the same seed and the same queues produce a different hunt from that collision on, and a
 * replay does not carry the balance it was played under, so the version is the only thing that can
 * say so. Every balance change that a rule reads pulls this trigger.
 */
export const REPLAY_VERSION = 4;

export type Replay = {
  readonly version: number;
  readonly seed: number;
  readonly setup: GameSetup;
  /** One entry per turn played, in order; each is that turn's queue as `step` received it. */
  readonly actions: readonly (readonly HunterAction[])[];
};

/** The only sanctioned way to stamp a replay, so a caller cannot invent a version. */
export const makeReplay = (recorded: Omit<Replay, "version">): Replay => ({
  version: REPLAY_VERSION,
  ...recorded,
});

/** Which part of the string, or of the replay, was wrong. Named for the bug report. */
export type ReplayField =
  | "structure"
  | "version"
  | "seed"
  | "columns"
  | "rows"
  | "exitCount"
  | "maxTurns"
  | "difficulty"
  | "action";

/**
 * What both directions refuse alike: a replay this build cannot reproduce, and the three counts
 * that would otherwise let a hostile string name an unbounded amount of work. They are checked
 * against the replay rather than against the text so that `encode` and `decode` cannot drift into
 * accepting different sets - a string `encode` produced that `decode` then refused would be a
 * share link that dies on arrival.
 *
 * `too_long` is not one of them: it is a fact about a string, so it belongs to each direction's
 * own result and not to the shared set.
 */
export type ReplayRefusal =
  | { readonly kind: "unsupported_version"; readonly version: number; readonly supported: number }
  | { readonly kind: "deadline_too_long"; readonly requestedTurns: Turn; readonly maxTurns: Turn }
  | { readonly kind: "too_many_turns"; readonly recordedTurns: number; readonly maxTurns: number }
  | {
      readonly kind: "too_many_actions";
      readonly turn: Turn;
      readonly requestedActions: number;
      readonly maxActions: number;
    };

export type ReplayEncoding =
  | { readonly kind: "replay_string"; readonly value: string }
  /** A replay whose own data cannot be written in the grammar: see `isWholeCount` and ids. */
  | { readonly kind: "not_encodable"; readonly field: ReplayField }
  | { readonly kind: "too_long"; readonly length: number; readonly maxLength: number }
  | ReplayRefusal;

export type ReplayDecoding =
  | { readonly kind: "replay"; readonly replay: Replay }
  | { readonly kind: "malformed"; readonly field: ReplayField }
  | { readonly kind: "too_long"; readonly length: number; readonly maxLength: number }
  | ReplayRefusal;

const FIELD_SEPARATOR = ".";
const TURN_SEPARATOR = "~";
const ACTION_SEPARATOR = "_";

const HEADER_FIELD_COUNT = 7;

const VERSION_FIELD = 0;
const SEED_FIELD = 1;
const COLUMNS_FIELD = 2;
const ROWS_FIELD = 3;
const EXIT_COUNT_FIELD = 4;
const MAX_TURNS_FIELD = 5;
const DIFFICULTY_FIELD = 6;

/** The header is everything before the first turn separator; every section after it is one turn. */
const FIRST_TURN_SECTION = 1;

const CODE_LENGTH = 1;

const NO_TARGET = "";

const GLOBAL_TARGET: ActionTargetKind = "global";

/** The id alphabet: unreserved characters minus the three the grammar spends on structure. */
const ID_PATTERN = /^[A-Za-z0-9-]+$/;

/** Decimal, unsigned and without a sign or a point, so `Number` cannot widen it into a float. */
const COUNT_PATTERN = /^\d+$/;

const DIFFICULTY_CODES: Readonly<Record<Difficulty, string>> = {
  easy: "e",
  standard: "s",
  hard: "h",
};

/**
 * The inverse of the table above. `Object.entries` widens the key back to `string`, so the pair is
 * re-narrowed here; what makes that sound is that the table it walks is keyed by `Difficulty`,
 * and `replay.test.ts` puts every difficulty through both directions to say so.
 */
const difficultyOf = (code: string | undefined): Difficulty | null => {
  const found = Object.entries(DIFFICULTY_CODES).find(([, letter]) => letter === code);
  return found === undefined ? null : (found[0] as Difficulty);
};

type ActionOf<Kind extends HunterActionKind> = Extract<HunterAction, { readonly kind: Kind }>;

/**
 * How one action is written and read back. Keyed by kind like `ACTION_TABLE`, so a new
 * `HunterAction` variant is a compile error here until it has a code and a target - and nothing
 * else: what a well-formed target looks like comes from `targetKindOf`, which is the table in
 * `actions.ts` (architecture rule 6).
 */
type ActionCodec<Action extends HunterAction> = {
  readonly code: string;
  readonly target: (action: Action) => string;
  readonly build: (target: string) => Action;
};

type ActionCodecTable = {
  readonly [Kind in HunterActionKind]: ActionCodec<ActionOf<Kind>>;
};

const ACTION_CODECS: ActionCodecTable = {
  roadblock: {
    code: "r",
    target: (action) => action.edgeId,
    build: (target) => ({ kind: "roadblock", edgeId: makeEdgeId(target) }),
  },
  canvass: {
    code: "c",
    target: (action) => action.nodeId,
    build: (target) => ({ kind: "canvass", nodeId: makeNodeId(target) }),
  },
  pull_cctv: {
    code: "v",
    target: (action) => action.nodeId,
    build: (target) => ({ kind: "pull_cctv", nodeId: makeNodeId(target) }),
  },
  true_briefing: {
    code: "b",
    target: () => NO_TARGET,
    build: () => ({ kind: "true_briefing" }),
  },
};

/**
 * The one unchecked step, and the same one `actions.ts`'s `definitionOf` takes for the same
 * reason: the table's own keying is what makes the entry found under `action.kind` the entry for
 * `action`, and the compiler cannot say so.
 */
const codecOf = (action: HunterAction): ActionCodec<HunterAction> =>
  ACTION_CODECS[action.kind] as ActionCodec<HunterAction>;

const kindOf = (code: string): HunterActionKind | null => {
  const found = Object.entries(ACTION_CODECS).find(([, codec]) => codec.code === code);
  return found === undefined ? null : (found[0] as HunterActionKind);
};

/** A global action carries no target; every other kind carries one id and nothing else. */
const isWellFormedTarget = (kind: HunterActionKind, target: string): boolean =>
  targetKindOf(kind) === GLOBAL_TARGET ? target === NO_TARGET : ID_PATTERN.test(target);

const isWholeCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

const countOf = (text: string | undefined): number | null => {
  if (text === undefined || !COUNT_PATTERN.test(text)) {
    return null;
  }
  const value = Number(text);
  return isWholeCount(value) ? value : null;
};

type CountedField = {
  readonly field: ReplayField;
  readonly read: (replay: Replay) => number;
};

/** Every number the grammar writes as digits, so one pass can say which one cannot be written. */
const COUNTED_FIELDS: readonly CountedField[] = [
  { field: "seed", read: (replay) => replay.seed },
  { field: "columns", read: (replay) => replay.setup.map.columns },
  { field: "rows", read: (replay) => replay.setup.map.rows },
  { field: "exitCount", read: (replay) => replay.setup.map.exitCount },
  { field: "maxTurns", read: (replay) => replay.setup.maxTurns },
];

/**
 * A replay whose own data does not fit the grammar. Every id a generated map carries is inside the
 * alphabet (`n-3-4`, `e-3-4-h`), so this is reachable only by an action a caller built by hand -
 * which is exactly when a loud refusal beats a mangled string.
 */
const unencodableField = (replay: Replay): ReplayField | null => {
  const uncountable = COUNTED_FIELDS.find((counted) => !isWholeCount(counted.read(replay)));
  if (uncountable !== undefined) {
    return uncountable.field;
  }
  const unwritable = replay.actions
    .flat()
    .find((action) => !isWellFormedTarget(action.kind, codecOf(action).target(action)));
  return unwritable === undefined ? null : "action";
};

const overlongQueue = (replay: Replay): ReplayRefusal | null => {
  const found = replay.actions
    .map((queue, index) => ({ turn: index, requestedActions: queue.length }))
    .find((counted) => counted.requestedActions > LIMITS.maxQueuedActions);
  if (found === undefined) {
    return null;
  }
  return { kind: "too_many_actions", ...found, maxActions: LIMITS.maxQueuedActions };
};

/**
 * What neither direction will carry, checked against the replay itself so both directions refuse
 * the same set. A replay is played back one `step` per recorded turn, and that loop is as
 * untrusted as the string it came from - which is the use `maxGameTurns`'s own note in `limits.ts`
 * names.
 *
 * The recorded turns are bounded by the replay's **own** deadline rather than by `maxGameTurns`
 * (PLAN M4.2a). Since `END_CONDITIONS` ends a hunt on `clock.turn >= config.maxTurns`, a hunt can
 * play at most `setup.maxTurns` turns, so a longer recording is of a hunt that could not have
 * happened; refusing it here is cheaper than stepping 240 turns to discover that the last 200 were
 * `hunt_over`. The deadline itself is checked first and against `maxGameTurns`, so by the time the
 * recorded turns are counted the setup's own number is the tighter of the two and `maxGameTurns`
 * is still what caps the work.
 */
export const replayRefusalIn = (replay: Replay): ReplayRefusal | null => {
  if (replay.version !== REPLAY_VERSION) {
    return { kind: "unsupported_version", version: replay.version, supported: REPLAY_VERSION };
  }
  if (replay.setup.maxTurns > LIMITS.maxGameTurns) {
    return {
      kind: "deadline_too_long",
      requestedTurns: replay.setup.maxTurns,
      maxTurns: LIMITS.maxGameTurns,
    };
  }
  if (replay.actions.length > replay.setup.maxTurns) {
    return {
      kind: "too_many_turns",
      recordedTurns: replay.actions.length,
      maxTurns: replay.setup.maxTurns,
    };
  }
  return overlongQueue(replay);
};

const headerOf = (replay: Replay): string =>
  [
    replay.version,
    replay.seed,
    replay.setup.map.columns,
    replay.setup.map.rows,
    replay.setup.map.exitCount,
    replay.setup.maxTurns,
    DIFFICULTY_CODES[replay.setup.difficulty],
  ].join(FIELD_SEPARATOR);

const actionText = (action: HunterAction): string =>
  codecOf(action).code + codecOf(action).target(action);

const turnText = (queue: readonly HunterAction[]): string =>
  TURN_SEPARATOR + queue.map((action) => actionText(action)).join(ACTION_SEPARATOR);

/**
 * The string, or why there is none. The counts are settled before anything is built, so the one
 * allocation this makes is bounded by them; the length is then checked against the same constant
 * `decode` accepts, because a string that cannot be read back is not a replay.
 */
export const encodeReplay = (replay: Replay): ReplayEncoding => {
  const refusal = replayRefusalIn(replay);
  if (refusal !== null) {
    return refusal;
  }
  const field = unencodableField(replay);
  if (field !== null) {
    return { kind: "not_encodable", field };
  }
  const value = headerOf(replay) + replay.actions.map((queue) => turnText(queue)).join("");
  if (value.length > LIMITS.maxReplayStringLength) {
    return { kind: "too_long", length: value.length, maxLength: LIMITS.maxReplayStringLength };
  }
  return { kind: "replay_string", value };
};

type SetupResult =
  | { readonly kind: "setup"; readonly setup: GameSetup }
  | { readonly kind: "malformed"; readonly field: ReplayField };

const mapConfigOf = (fields: readonly string[]): MapConfig | ReplayField => {
  const columns = countOf(fields[COLUMNS_FIELD]);
  const rows = countOf(fields[ROWS_FIELD]);
  const exitCount = countOf(fields[EXIT_COUNT_FIELD]);
  if (columns === null) {
    return "columns";
  }
  if (rows === null) {
    return "rows";
  }
  if (exitCount === null) {
    return "exitCount";
  }
  return { columns, rows, exitCount };
};

const setupOf = (fields: readonly string[]): SetupResult => {
  const map = mapConfigOf(fields);
  if (typeof map === "string") {
    return { kind: "malformed", field: map };
  }
  const maxTurns = countOf(fields[MAX_TURNS_FIELD]);
  if (maxTurns === null) {
    return { kind: "malformed", field: "maxTurns" };
  }
  const difficulty = difficultyOf(fields[DIFFICULTY_FIELD]);
  if (difficulty === null) {
    return { kind: "malformed", field: "difficulty" };
  }
  return { kind: "setup", setup: { map, maxTurns, difficulty } };
};

const actionOf = (text: string): HunterAction | null => {
  const kind = kindOf(text.slice(0, CODE_LENGTH));
  if (kind === null) {
    return null;
  }
  const target = text.slice(CODE_LENGTH);
  if (!isWellFormedTarget(kind, target)) {
    return null;
  }
  return ACTION_CODECS[kind].build(target);
};

/** One turn's queue, or `null` for a section this grammar cannot read. An empty section is a
 * turn the hunter spent nothing on, which is not the same thing and has to survive the trip. */
const queueOf = (section: string): readonly HunterAction[] | null => {
  const texts = section === NO_TARGET ? [] : section.split(ACTION_SEPARATOR);
  const actions = texts.map((text) => actionOf(text));
  return actions.includes(null) ? null : actions.filter((action) => action !== null);
};

type ActionsResult =
  | { readonly kind: "actions"; readonly actions: readonly (readonly HunterAction[])[] }
  | { readonly kind: "malformed"; readonly field: ReplayField };

const actionsOf = (sections: readonly string[]): ActionsResult => {
  const queues = sections.map((section) => queueOf(section));
  if (queues.includes(null)) {
    return { kind: "malformed", field: "action" };
  }
  return { kind: "actions", actions: queues.filter((queue) => queue !== null) };
};

const headerIn = (text: string): string => {
  const end = text.indexOf(TURN_SEPARATOR);
  return end < 0 ? text : text.slice(0, end);
};

const turnSectionsIn = (text: string): readonly string[] =>
  text.split(TURN_SEPARATOR).slice(FIRST_TURN_SECTION);

/**
 * The boundary (AGENTS.md section 5). The length is checked first and on the string itself, before
 * a split allocates anything, and an over-long string is an error result rather than a truncated
 * replay. Everything after that check is still untrusted, so every field is parsed rather than
 * trusted, and the version is read before everything else, its own field count included: a string
 * from a later grammar must come back as `unsupported_version` and not as whatever this grammar
 * makes of its bytes. That is the one promise every version of the format owes the others - the
 * first field is the version, in decimal - and it is why the version leads the header.
 *
 * The counts are applied last, through the same `replayRefusalIn` that `encode` uses. Parsing
 * first is safe because the length bound has already capped the work - an action costs at least
 * one character - and it is what keeps the two directions refusing the same set.
 */
export const decodeReplay = (text: string): ReplayDecoding => {
  if (text.length > LIMITS.maxReplayStringLength) {
    return { kind: "too_long", length: text.length, maxLength: LIMITS.maxReplayStringLength };
  }
  const fields = headerIn(text).split(FIELD_SEPARATOR);
  const version = countOf(fields[VERSION_FIELD]);
  if (version === null) {
    return { kind: "malformed", field: "version" };
  }
  if (version !== REPLAY_VERSION) {
    return { kind: "unsupported_version", version, supported: REPLAY_VERSION };
  }
  if (fields.length !== HEADER_FIELD_COUNT) {
    return { kind: "malformed", field: "structure" };
  }
  const seed = countOf(fields[SEED_FIELD]);
  if (seed === null) {
    return { kind: "malformed", field: "seed" };
  }
  const setup = setupOf(fields);
  if (setup.kind === "malformed") {
    return setup;
  }
  const actions = actionsOf(turnSectionsIn(text));
  if (actions.kind === "malformed") {
    return actions;
  }
  const replay: Replay = { version, seed, setup: setup.setup, actions: actions.actions };
  return replayRefusalIn(replay) ?? { kind: "replay", replay };
};
