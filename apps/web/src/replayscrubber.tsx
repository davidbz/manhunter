/**
 * The scrubber control (PLAN M5.6b): a range input over the turns of a finished hunt, plus the
 * turn it is on. Presentational and controlled, the `Meters`/`MapRenderer` shape - it holds no
 * state, and the screen that owns the current turn (`replayscreen.tsx`) hands it down alongside
 * `onScrub`.
 */

import type { Turn } from "@manhunter/core";
import type { ChangeEvent } from "react";

export type ReplayScrubberProps = {
  readonly turn: Turn;
  readonly maxTurn: Turn;
  readonly onScrub: (turn: Turn) => void;
};

export const REPLAY_SCRUBBER_TEST_ID = "replay-scrubber";
export const REPLAY_SCRUBBER_INPUT_TEST_ID = "replay-scrubber-input";
export const REPLAY_SCRUBBER_TURN_TEST_ID = "replay-scrubber-turn";

const REPLAY_SCRUBBER_LABEL = "Replay turn";
const FIRST_TURN: Turn = 0;
const TURN_PREFIX = "Turn ";

const scrubbedTurn = (event: ChangeEvent<HTMLInputElement>): Turn => Number(event.target.value);

export const ReplayScrubber = ({ turn, maxTurn, onScrub }: ReplayScrubberProps) => (
  <div data-testid={REPLAY_SCRUBBER_TEST_ID}>
    <label htmlFor={REPLAY_SCRUBBER_INPUT_TEST_ID}>{REPLAY_SCRUBBER_LABEL}</label>
    <input
      id={REPLAY_SCRUBBER_INPUT_TEST_ID}
      data-testid={REPLAY_SCRUBBER_INPUT_TEST_ID}
      type="range"
      min={FIRST_TURN}
      max={maxTurn}
      value={turn}
      onChange={(event) => onScrub(scrubbedTurn(event))}
    />
    <span data-testid={REPLAY_SCRUBBER_TURN_TEST_ID} data-turn={turn}>
      {TURN_PREFIX}
      {turn}
    </span>
  </div>
);
