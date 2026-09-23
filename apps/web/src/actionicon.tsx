/**
 * A stencil icon per hunter action (PLAN M6.8), shared by the action board and the dispatch
 * order so a roadblock looks like the same thing in both. The paths are `theme.ts`'s data; this
 * only draws one in `currentColor`, so whatever state colours a tile colours its icon too.
 *
 * Decorative: the tile or the line it sits in already says the action's name, so the icon is
 * hidden from assistive technology rather than read out twice.
 */

import type { HunterActionKind } from "@manhunter/core";
import { ACTION_ICON_THEME } from "./theme";

export type ActionIconTheme = {
  /** Side of the square every glyph is authored in. */
  readonly box: number;
  readonly strokeWidth: number;
  readonly glyphs: Readonly<Record<HunterActionKind, string>>;
};

export type ActionIconProps = {
  readonly kind: HunterActionKind;
  readonly theme?: ActionIconTheme;
};

export const ACTION_ICON_TEST_ID = "action-icon";

const ORIGIN = 0;

export const ActionIcon = ({ kind, theme = ACTION_ICON_THEME }: ActionIconProps) => (
  <svg
    aria-hidden="true"
    focusable="false"
    className="mh-icon"
    viewBox={`${ORIGIN} ${ORIGIN} ${theme.box} ${theme.box}`}
    data-testid={ACTION_ICON_TEST_ID}
    data-icon={kind}
  >
    <path
      d={theme.glyphs[kind]}
      fill="none"
      stroke="currentColor"
      strokeWidth={theme.strokeWidth}
      strokeLinejoin="miter"
    />
  </svg>
);
