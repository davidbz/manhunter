/**
 * A way past the map for a keyboard (PLAN M6.10's focus-order pass). Every road and district on
 * the map is its own tab stop - 110 on seed 1's city - and they sit in the tab order before the
 * controls the player actually came to use, so without this reaching End Turn is over a hundred
 * presses of Tab.
 *
 * A button rather than an `href="#..."` anchor, because the page's URL carries the share link's
 * replay string and a fragment jump would rewrite it. Hidden until it has focus (`index.css`), the
 * usual skip-link treatment: the first Tab on the board shows it, and it vanishes when passed.
 */

import type { RefObject } from "react";

export const SKIP_LINK_TEST_ID = "skip-link";

export type SkipLinkProps = {
  /** What the link is for, as `data-skip`: the region it jumps to. */
  readonly name: string;
  readonly label: string;
  readonly target: RefObject<HTMLElement | null>;
};

export const SkipLink = ({ name, label, target }: SkipLinkProps) => (
  <button
    type="button"
    className="mh-skip-link"
    data-testid={SKIP_LINK_TEST_ID}
    data-skip={name}
    onClick={() => target.current?.focus()}
  >
    {label}
  </button>
);
