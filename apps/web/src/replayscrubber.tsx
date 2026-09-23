/**
 * The scrubber control (PLAN M5.6b): a range input over the turns of a finished hunt, plus the
 * turn it is on. Presentational and controlled, the `Meters`/`MapRenderer` shape - it holds no
 * state, and the screen that owns the current turn (`replayscreen.tsx`) hands it down alongside
 * `onScrub`.
 *
 * PLAN M6.9 adds the transport row: first, previous, next and last, each a button that scrubs to
 * the turn `transportTargetOf` names and is disabled when that is the turn already shown. The
 * range input stays, so a long replay can still be dragged across in one motion.
 */

import type { Turn } from "@manhunter/core";
import type { ChangeEvent, Ref } from "react";
import { TRANSPORT_ICON_THEME } from "./theme";

export type ReplayScrubberProps = {
  readonly turn: Turn;
  readonly maxTurn: Turn;
  readonly onScrub: (turn: Turn) => void;
  /** Where the replay's skip link lands (PLAN M6.10): the controls, past the map's tab stops. */
  readonly controlsRef?: Ref<HTMLDivElement>;
};

export const TRANSPORT_STEPS = ["first", "previous", "next", "last"] as const;
export type TransportStep = (typeof TRANSPORT_STEPS)[number];

export type TransportIconTheme = {
  /** Side of the square every glyph is authored in. */
  readonly box: number;
  readonly glyphs: Readonly<Record<TransportStep, string>>;
};

export const REPLAY_SCRUBBER_TEST_ID = "replay-scrubber";
export const REPLAY_SCRUBBER_INPUT_TEST_ID = "replay-scrubber-input";
export const REPLAY_SCRUBBER_TURN_TEST_ID = "replay-scrubber-turn";
export const REPLAY_TRANSPORT_TEST_ID = "replay-transport";

const REPLAY_SCRUBBER_LABEL = "Replay turn";
const TRANSPORT_LABEL = "Replay controls";
const FIRST_TURN: Turn = 0;
const TURN_PREFIX = "Turn ";
const OF_PREFIX = "of ";
const ORIGIN = 0;

const TRANSPORT_LABELS: Readonly<Record<TransportStep, string>> = {
  first: "First turn",
  previous: "Previous turn",
  next: "Next turn",
  last: "Last turn",
};

const TRANSPORT_TARGETS: Readonly<Record<TransportStep, (turn: Turn, maxTurn: Turn) => Turn>> = {
  first: () => FIRST_TURN,
  previous: (turn) => Math.max(FIRST_TURN, turn - 1),
  next: (turn, maxTurn) => Math.min(maxTurn, turn + 1),
  last: (_turn, maxTurn) => maxTurn,
};

/** The turn a transport button scrubs to, clamped to the replay's own range. */
export const transportTargetOf = (step: TransportStep, turn: Turn, maxTurn: Turn): Turn =>
  TRANSPORT_TARGETS[step](turn, maxTurn);

const scrubbedTurn = (event: ChangeEvent<HTMLInputElement>): Turn => Number(event.target.value);

const TransportIcon = ({ step }: { readonly step: TransportStep }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    className="mh-icon"
    viewBox={`${ORIGIN} ${ORIGIN} ${TRANSPORT_ICON_THEME.box} ${TRANSPORT_ICON_THEME.box}`}
  >
    <path d={TRANSPORT_ICON_THEME.glyphs[step]} fill="currentColor" stroke="none" />
  </svg>
);

/** Focusable by the skip link, never by Tab. */
const PROGRAMMATIC_FOCUS_ONLY = -1;

export const ReplayScrubber = ({ turn, maxTurn, onScrub, controlsRef }: ReplayScrubberProps) => (
  <div
    ref={controlsRef}
    tabIndex={PROGRAMMATIC_FOCUS_ONLY}
    className="mh-scrubber"
    data-testid={REPLAY_SCRUBBER_TEST_ID}
  >
    <fieldset className="mh-scrubber__transport" aria-label={TRANSPORT_LABEL}>
      {TRANSPORT_STEPS.map((step) => {
        const target = transportTargetOf(step, turn, maxTurn);
        return (
          <button
            key={step}
            type="button"
            className="mh-button mh-button--quiet mh-scrubber__step"
            data-testid={REPLAY_TRANSPORT_TEST_ID}
            data-step={step}
            aria-label={TRANSPORT_LABELS[step]}
            disabled={target === turn}
            onClick={() => onScrub(target)}
          >
            <TransportIcon step={step} />
          </button>
        );
      })}
    </fieldset>
    <label className="mh-visually-hidden" htmlFor={REPLAY_SCRUBBER_INPUT_TEST_ID}>
      {REPLAY_SCRUBBER_LABEL}
    </label>
    <input
      id={REPLAY_SCRUBBER_INPUT_TEST_ID}
      className="mh-scrubber__track"
      data-testid={REPLAY_SCRUBBER_INPUT_TEST_ID}
      type="range"
      min={FIRST_TURN}
      max={maxTurn}
      value={turn}
      onChange={(event) => onScrub(scrubbedTurn(event))}
    />
    <p className="mh-scrubber__readout">
      <span data-testid={REPLAY_SCRUBBER_TURN_TEST_ID} data-turn={turn}>
        {TURN_PREFIX}
        {turn}
      </span>{" "}
      <span className="mh-scrubber__of">
        {OF_PREFIX}
        {maxTurn}
      </span>
    </p>
  </div>
);
