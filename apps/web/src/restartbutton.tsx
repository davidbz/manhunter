/**
 * The way back to the briefing (PLAN M6.9): one button, one `restart` dispatch. Drawn on the
 * debrief, where it starts the next case, and on the briefing itself, where it clears a refused
 * start or a share link that would not load. `screen` says which, as `data-screen`, so a test can
 * tell the two apart without depending on their words.
 *
 * `onRestarted` lets the screen that draws it reset state of its own that the store does not
 * hold, the way `TurnQueuePanel`'s `onCommitted` lets the board disarm.
 */

import { useGameStore } from "./storecontext";

export type RestartScreen = "debrief" | "briefing";

export type RestartButtonProps = {
  readonly screen: RestartScreen;
  readonly label: string;
  readonly onRestarted?: () => void;
};

export const RESTART_TEST_ID = "restart";

/** On the debrief it is the next step; on the briefing it is a reset, so it stays quiet. */
const RESTART_CLASSES: Readonly<Record<RestartScreen, string>> = {
  debrief: "mh-button",
  briefing: "mh-button mh-button--quiet",
};

export const RestartButton = ({ screen, label, onRestarted }: RestartButtonProps) => {
  const restart = useGameStore((state) => state.restart);

  const click = (): void => {
    restart();
    onRestarted?.();
  };

  return (
    <button
      type="button"
      className={RESTART_CLASSES[screen]}
      data-testid={RESTART_TEST_ID}
      data-screen={screen}
      onClick={click}
    >
      {label}
    </button>
  );
};
