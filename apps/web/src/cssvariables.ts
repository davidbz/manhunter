/**
 * Turns `theme.ts`'s design tokens into the CSS custom properties `index.css` reads (PLAN M6.1).
 *
 * **Why the stylesheet cannot hold these values itself.** M5.7 declined a CSS file on the grounds
 * that one would be a second copy of the palette that `tools/theme/colorliterals.test.ts` could
 * not see. That reasoning still holds and is exactly what this module exists to satisfy: the
 * stylesheet is written entirely in `var(--mh-*)` references, the values arrive from TypeScript,
 * and the colour test now scans `.css` with no exemption at all. Adding a stylesheet therefore
 * tightens the guard rather than opening a hole in it.
 *
 * **Why a derivation rather than a hand-written table.** A literal `Record<string, string>` beside
 * the tokens would drift the moment a token is added, and the drift would be silent - the missing
 * property resolves to nothing and the rule using it falls back. Deriving the names means a new
 * token is a new custom property by construction.
 *
 * Logic, not data (AGENTS.md "Data-oriented programming"): it takes tokens in and returns a record
 * out, captures nothing, and is applied by the composition root.
 */

import type { DesignTokens } from "./theme";

const PREFIX = "--mh";
const SEPARATOR = "-";
const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g;
const CAMEL_REPLACEMENT = `$1${SEPARATOR}$2`;

/** `fontSizeBase` in the `font` group becomes `--mh-font-size-base`. */
const kebabOf = (name: string): string =>
  name.replace(CAMEL_BOUNDARY, CAMEL_REPLACEMENT).toLowerCase();

export const cssVariableNameOf = (group: string, token: string): string =>
  `${PREFIX}${SEPARATOR}${kebabOf(group)}${SEPARATOR}${kebabOf(token)}`;

/**
 * Every token in every group, flattened to the custom properties the stylesheet reads. Group
 * prefixes keep `color.background` and a future `space.background` apart, so no two tokens can
 * collide on a name.
 */
export const cssVariablesOf = (tokens: DesignTokens): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(tokens).flatMap(([group, entries]) =>
      Object.entries(entries).map(([token, value]) => [cssVariableNameOf(group, token), value]),
    ),
  );
