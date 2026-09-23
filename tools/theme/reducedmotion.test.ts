/**
 * PLAN M6.10's acceptance criterion, "every animation is disabled under `prefers-reduced-motion`",
 * as a scan rather than a promise. `index.css` opts motion in: every `animation`, `transition`
 * and `@keyframes` goes inside an `@media (prefers-reduced-motion: no-preference)` block, so a
 * player who asked for less motion gets none by construction (the reasoning is `index.css`'s own,
 * above that block). This test is what keeps that true as rules are added.
 *
 * Two halves. The stylesheet: remove every guarded block and assert nothing that moves is left.
 * The components: assert no `.ts`/`.tsx` under `apps/web/src` moves anything around the stylesheet
 * - an inline `transition` style, an SVG `<animate>`, the Web Animations API or an animation
 * frame loop - because none of those would see the media query at all.
 *
 * It lives in `tools/` for `colorliterals.test.ts`'s reason: reading the tree needs `node:fs`,
 * which `apps/web` forbids itself. A real browser's view of the same guarantee - no running
 * animation under emulated reduced motion - was checked once by hand with Playwright (PLAN M6.10's
 * note) rather than added to the e2e suite, which AGENTS.md keeps to the critical flows.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_SRC_DIR = fileURLToPath(new URL("../../apps/web/src/", import.meta.url));
const STYLESHEET = "index.css";
const COMPONENT_EXTENSIONS = [".ts", ".tsx"];
const TEST_FILE_SUFFIXES = [".test.ts", ".test.tsx"];

const MOTION_GUARD = /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*\{/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_MOTION = /(?:^|[\s;{])(?:animation|transition)(?:-[a-z-]+)?\s*:|@keyframes\b/g;
const SCRIPT_MOTION = [
  /\b(?:animation|transition)[A-Za-z]*\s*:/,
  /<animate/,
  /\.animate\(/,
  /requestAnimationFrame/,
];

const OPEN_BRACE = "{";
const CLOSE_BRACE = "}";

/** The index just past the brace that closes the block whose body starts at `from`. */
const blockEndOf = (css: string, from: number): number => {
  let depth = 1;
  let at = from;
  while (depth > 0 && at < css.length) {
    if (css[at] === OPEN_BRACE) depth += 1;
    if (css[at] === CLOSE_BRACE) depth -= 1;
    at += 1;
  }
  if (depth > 0) throw new Error("unbalanced braces in a motion guard");

  return at;
};

type SplitStylesheet = {
  readonly guarded: readonly string[];
  readonly unguarded: string;
};

/** Every guarded block's body, and the stylesheet with all of them cut out. */
const splitByMotionGuard = (stylesheet: string): SplitStylesheet => {
  const css = stylesheet.replace(CSS_COMMENT, "");
  const guarded: string[] = [];
  let unguarded = "";
  let cursor = 0;
  for (const match of css.matchAll(MOTION_GUARD)) {
    if (match.index < cursor) continue;
    const bodyStart = match.index + match[0].length;
    const end = blockEndOf(css, bodyStart);
    unguarded += css.slice(cursor, match.index);
    guarded.push(css.slice(bodyStart, end - 1));
    cursor = end;
  }

  return { guarded, unguarded: unguarded + css.slice(cursor) };
};

const motionIn = (css: string): readonly string[] =>
  [...css.matchAll(CSS_MOTION)].map((match) => match[0].trim());

const readWebSource = (relativePath: string): string =>
  readFileSync(`${WEB_SRC_DIR}${relativePath}`, "utf8");

const componentFiles = (): readonly string[] =>
  readdirSync(WEB_SRC_DIR).filter(
    (name) =>
      COMPONENT_EXTENSIONS.some((extension) => name.endsWith(extension)) &&
      !TEST_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix)),
  );

type ScriptHit = { readonly file: string; readonly line: number; readonly text: string };

const scriptMotionIn = (file: string, text: string): readonly ScriptHit[] =>
  text.split("\n").flatMap((line, index) => {
    const code = line.trim();
    const isComment = code.startsWith("*") || code.startsWith("/*") || code.startsWith("//");
    if (isComment) return [];
    if (!SCRIPT_MOTION.some((pattern) => pattern.test(code))) return [];

    return [{ file, line: index + 1, text: code }];
  });

describe("splitting a stylesheet by the motion guard", () => {
  it("cuts a guarded block out, nested rules and keyframes included", () => {
    const css = [
      ".a { color: red; }",
      "@media (prefers-reduced-motion: no-preference) {",
      "  .b { animation: spin 1s; }",
      "  @keyframes spin { from { opacity: 0; } }",
      "}",
      ".c { margin: 0; }",
    ].join("\n");

    const split = splitByMotionGuard(css);

    expect(motionIn(split.unguarded)).toEqual([]);
    expect(split.guarded).toHaveLength(1);
    expect(motionIn(split.guarded.join(""))).toEqual(["animation:", "@keyframes"]);
  });

  it("finds an animation, a transition and a keyframes block left outside the guard", () => {
    const css = [
      ".a { transition: opacity 1s; }",
      ".b {\n  animation-name: spin;\n}",
      "@keyframes spin { from { opacity: 0; } }",
      "@media (prefers-reduced-motion: reduce) { .c { animation: none; } }",
    ].join("\n");

    expect(motionIn(splitByMotionGuard(css).unguarded)).toEqual([
      "transition:",
      "animation-name:",
      "@keyframes",
      "animation:",
    ]);
  });

  it("does not count a property that only contains the word, or a comment", () => {
    const css = "/* animation: none; */\n.a { --mh-transition-x: 1; will-change: opacity; }";

    expect(motionIn(splitByMotionGuard(css).unguarded)).toEqual([]);
  });

  it("refuses a guard whose braces never close rather than passing it", () => {
    expect(() =>
      splitByMotionGuard("@media (prefers-reduced-motion: no-preference) { .a { animation: x; }"),
    ).toThrow();
  });
});

describe("index.css under prefers-reduced-motion (PLAN M6.10)", () => {
  const split = splitByMotionGuard(readWebSource(STYLESHEET));

  it("has guarded motion to switch off, so the check below is not vacuous", () => {
    expect(split.guarded.length).toBeGreaterThan(0);
    expect(motionIn(split.guarded.join("")).length).toBeGreaterThan(0);
  });

  it("puts every animation, transition and keyframes block inside a no-preference guard", () => {
    expect(motionIn(split.unguarded)).toEqual([]);
  });

  it("gives every one of the five named motions an animation inside the guard", () => {
    const guarded = split.guarded.join("");
    for (const token of [
      "turn-advance",
      "report-arrival",
      "meter-movement",
      "checkpoint-fire",
      "outcome-sting",
    ]) {
      expect(guarded, token).toContain(`var(--mh-motion-${token})`);
    }
  });
});

describe("motion outside the stylesheet", () => {
  it("recognises the shapes it is looking for", () => {
    expect(scriptMotionIn("x.tsx", "  style={{ transition: fast }}")).toHaveLength(1);
    expect(scriptMotionIn("x.tsx", "  style={{ animationName: spin }}")).toHaveLength(1);
    expect(scriptMotionIn("x.tsx", "  <animate attributeName='r' />")).toHaveLength(1);
    expect(scriptMotionIn("x.ts", "  element.animate(frames, 1000);")).toHaveLength(1);
    expect(scriptMotionIn("x.ts", "  requestAnimationFrame(tick);")).toHaveLength(1);
    expect(scriptMotionIn("x.ts", " * a transition: explained in prose")).toHaveLength(0);
  });

  it("finds no component that animates around the reduced-motion guard", () => {
    const files = componentFiles();
    const hits = files.flatMap((file) => scriptMotionIn(file, readWebSource(file)));

    expect(files.length).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });
});
