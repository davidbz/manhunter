/**
 * The operations-board frame (PLAN M6.2): a header rail across the top, the map in the dominant
 * column, the intel column to its right, and the command bar along the bottom. Layout only - it
 * takes each region's content as a slot and knows nothing of what goes in one, so `DispatchScreen`
 * stays the assembly and each panel keeps its own markup.
 *
 * The grid itself is `index.css`'s `.mh-frame`, fixed to the viewport. Only the regions scroll,
 * never the page, so End Turn is always on screen however long the feed or the queue gets.
 *
 * `ScreenFrame` is the single scrolling column the screens that are not the board sit in - the
 * new-hunt form before a hunt and the debrief after one - so they obey the same no-page-scroll
 * rule without a board they have nothing to put in.
 */

import type { ReactNode } from "react";

export const APP_FRAME_RAIL_TEST_ID = "frame-rail";
export const APP_FRAME_MAP_TEST_ID = "frame-map";
export const APP_FRAME_INTEL_TEST_ID = "frame-intel";
export const APP_FRAME_COMMAND_TEST_ID = "frame-command";
export const SCREEN_FRAME_TEST_ID = "screen-frame";

const INTEL_LABEL = "Intel";
const COMMAND_LABEL = "Command";

export type AppFrameProps = {
  readonly label: string;
  readonly testId: string;
  readonly rail: ReactNode;
  readonly map: ReactNode;
  readonly intel: ReactNode;
  readonly command: ReactNode;
};

export const AppFrame = ({ label, testId, rail, map, intel, command }: AppFrameProps) => (
  <section aria-label={label} className="mh-frame" data-testid={testId}>
    <header className="mh-frame__rail" data-testid={APP_FRAME_RAIL_TEST_ID}>
      {rail}
    </header>
    <div className="mh-frame__map" data-testid={APP_FRAME_MAP_TEST_ID}>
      {map}
    </div>
    <aside
      aria-label={INTEL_LABEL}
      className="mh-frame__intel"
      data-testid={APP_FRAME_INTEL_TEST_ID}
    >
      {intel}
    </aside>
    <section
      aria-label={COMMAND_LABEL}
      className="mh-frame__command"
      data-testid={APP_FRAME_COMMAND_TEST_ID}
    >
      {command}
    </section>
  </section>
);

export type ScreenFrameProps = {
  readonly children: ReactNode;
};

export const ScreenFrame = ({ children }: ScreenFrameProps) => (
  <div className="mh-screen" data-testid={SCREEN_FRAME_TEST_ID}>
    {children}
  </div>
);
