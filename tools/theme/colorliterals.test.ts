/**
 * Enforces PLAN M5.7's acceptance criterion directly: "a test asserts no colour literal appears
 * under `apps/web/src` outside the token file". `apps/web/src/theme.ts` is where every colour
 * `apps/web` draws with is named (AGENTS.md "No magic numbers or strings"); every other file is
 * expected to read a token by name (`PALETTE.incidentRed`, `theme.exitStroke`, ...) rather than
 * spell a colour out.
 *
 * **Why this lives here and not beside the files it scans.** `apps/web`'s own Biome override
 * turns `correctness/noNodejsModules` on (`biome.json`, "apps/web depends on core only" block's
 * sibling), because `apps/web/src` ships to a browser and a `node:fs` import in it would be a
 * bug even inside a test. `tools/` is the one place in the repo that already reads the tree from
 * outside a workspace - `tools/biome/architecture-rules.test.ts` does the same thing for the
 * module-boundary rules - so this test lives there instead, the way that one does.
 *
 * **A source-scanning test rather than a Biome rule** (the `architecture-rules.test.ts`
 * alternative the task named): a colour literal is a value shape, not an import or a global, and
 * Biome has no rule for "this string looks like a hex code" - writing a GritQL plugin for one
 * regular expression would be more code than the check it replaces, and `architecture-rules.test`
 * already covers the module-boundary rules Biome *can* see. This is the same trade M2.2's rejected
 * nesting-depth plugin made, applied to a narrower, cheaper case.
 *
 * The two shapes this codebase's own history has used are hex (`#0b0f14`, `#fff`) and the
 * functional notations (`rgb()`, `rgba()`, `hsl()`, `hsla()`); every literal `theme.ts` replaced
 * (`maprenderer.tsx`'s `DEFAULT_MAP_THEME`, `beliefoverlay.tsx`'s `DEFAULT_HEAT_RAMP`,
 * `criminalpath.tsx`'s `DEFAULT_CRIMINAL_PATH_THEME`) was hex. Named CSS colour keywords
 * (`"red"`, `"black"`) are deliberately not matched: nothing in this tree has ever used one, and a
 * keyword list broad enough to catch them would also catch ordinary words in prose comments,
 * trading false negatives on a pattern nobody writes for false positives on every doc comment.
 *
 * **Test files are excluded from the scan.** The AC's concern is production code scattering the
 * palette `theme.ts` exists to centralise; a fixture literal inside a test tests string-matching,
 * not the theme, the same way `newhuntform.test.tsx` hardcodes seed digits and `limits.test.ts`
 * hardcodes boundary numbers. This file's own fixtures below (`"#0b0f14"`, proving the pattern
 * matches) are exactly that case. No `*.test.ts`/`*.test.tsx` file in the tree carries a real
 * colour literal today; this scope is a forward decision, not one that hides an existing
 * violation.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_SRC_DIR = fileURLToPath(new URL("../../apps/web/src/", import.meta.url));
const TOKEN_FILE = "theme.ts";
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const TEST_FILE_SUFFIXES = [".test.ts", ".test.tsx"];

const HEX_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/;
const FUNCTIONAL_COLOR = /\b(?:rgb|rgba|hsl|hsla)\(/;

const hasColorLiteral = (line: string): boolean =>
  HEX_COLOR.test(line) || FUNCTIONAL_COLOR.test(line);

type LiteralHit = {
  readonly file: string;
  readonly line: number;
  readonly text: string;
};

/** The pure half: what counts as a hit in a body of text, with no file system involved. */
const colorLiteralHitsInText = (relativePath: string, text: string): readonly LiteralHit[] =>
  text
    .split("\n")
    .flatMap((line, index) =>
      hasColorLiteral(line) ? [{ file: relativePath, line: index + 1, text: line.trim() }] : [],
    );

type SourceFile = {
  readonly path: string;
  readonly relativePath: string;
};

const isTestFile = (relativePath: string): boolean =>
  TEST_FILE_SUFFIXES.some((suffix) => relativePath.endsWith(suffix));

const sourceFilesUnder = (dir: string, relativeTo: string): readonly SourceFile[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    const relativePath = relativeTo === "" ? entry.name : `${relativeTo}/${entry.name}`;
    if (entry.isDirectory()) return sourceFilesUnder(path, relativePath);
    if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) return [];

    return [{ path, relativePath }];
  });

const colorLiteralHitsIn = (file: SourceFile): readonly LiteralHit[] =>
  colorLiteralHitsInText(file.relativePath, readFileSync(file.path, "utf8"));

describe("what counts as a colour literal", () => {
  it("matches a hex code, short or long", () => {
    expect(colorLiteralHitsInText("x.ts", 'const x = "#0b0f14";')).toHaveLength(1);
    expect(colorLiteralHitsInText("x.ts", 'const x = "#fff";')).toHaveLength(1);
  });

  it("matches a functional colour", () => {
    expect(colorLiteralHitsInText("x.ts", 'const x = "rgba(0, 0, 0, 0.5)";')).toHaveLength(1);
    expect(colorLiteralHitsInText("x.ts", 'const x = "hsl(0deg 0% 0%)";')).toHaveLength(1);
  });

  it("does not mistake a hash-prefixed id or a test id for a colour", () => {
    expect(colorLiteralHitsInText("x.ts", 'document.getElementById("root")')).toHaveLength(0);
    expect(colorLiteralHitsInText("x.ts", 'const x = "map-node";')).toHaveLength(0);
  });

  it("reports the line a planted literal is on", () => {
    const hits = colorLiteralHitsInText("x.ts", 'const a = 1;\nconst b = "#112233";\n');

    expect(hits).toEqual([{ file: "x.ts", line: 2, text: 'const b = "#112233";' }]);
  });
});

describe("colour literals stay inside apps/web/src/theme.ts", () => {
  it("finds no colour literal in any production file under apps/web/src outside theme.ts", () => {
    const files = sourceFilesUnder(WEB_SRC_DIR, "").filter(
      (file) => file.relativePath !== TOKEN_FILE && !isTestFile(file.relativePath),
    );
    const hits = files.flatMap((file) => colorLiteralHitsIn(file));

    expect(hits).toEqual([]);
  });

  it("does scan theme.ts itself, so the token file is not just excluded from every check", () => {
    const themeFile = sourceFilesUnder(WEB_SRC_DIR, "").find(
      (file) => file.relativePath === TOKEN_FILE,
    );
    if (themeFile === undefined) throw new Error("theme.ts was not found under apps/web/src");

    expect(colorLiteralHitsIn(themeFile).length).toBeGreaterThan(0);
  });
});
