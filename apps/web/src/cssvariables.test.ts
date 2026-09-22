import { describe, expect, it } from "vitest";
import { cssVariableNameOf, cssVariablesOf } from "./cssvariables";
import STYLESHEET from "./index.css?raw";
import { DESIGN_TOKENS } from "./theme";

const VARIABLES = cssVariablesOf(DESIGN_TOKENS);
const VARIABLE_REFERENCE = /var\((--mh-[a-z0-9-]+)/g;

describe("naming a custom property", () => {
  it("prefixes the group and kebab-cases the token", () => {
    expect(cssVariableNameOf("font", "sizeBase")).toBe("--mh-font-size-base");
    expect(cssVariableNameOf("color", "surfaceSunken")).toBe("--mh-color-surface-sunken");
    expect(cssVariableNameOf("shadow", "focusRing")).toBe("--mh-shadow-focus-ring");
  });

  it("leaves an already-lowercase token alone", () => {
    expect(cssVariableNameOf("space", "md")).toBe("--mh-space-md");
  });
});

describe("the published custom properties", () => {
  it("publishes every token in every group", () => {
    const tokenCount = Object.values(DESIGN_TOKENS).reduce(
      (total, group) => total + Object.keys(group).length,
      0,
    );

    expect(Object.keys(VARIABLES)).toHaveLength(tokenCount);
  });

  it("gives every group its own prefix, so no two tokens can collide on a name", () => {
    for (const group of Object.keys(DESIGN_TOKENS)) {
      expect(Object.keys(VARIABLES).some((name) => name.startsWith(`--mh-${group}-`))).toBe(true);
    }
  });

  it("carries the token value through unchanged", () => {
    expect(VARIABLES["--mh-color-accent"]).toBe(DESIGN_TOKENS.color.accent);
    expect(VARIABLES["--mh-font-family"]).toBe(DESIGN_TOKENS.font.family);
  });
});

/**
 * The failure this guards is silent: a `var()` naming a property nothing publishes resolves to
 * nothing and the declaration is simply dropped, so a typo in `index.css` costs a background or a
 * focus ring with no error anywhere. Checking the stylesheet's references against the published
 * set is the cheapest thing that turns that into a red test.
 */
describe("index.css against the published set", () => {
  it("references only custom properties the tokens publish", () => {
    const referenced = [...STYLESHEET.matchAll(VARIABLE_REFERENCE)].flatMap(([, name]) =>
      name === undefined ? [] : [name],
    );

    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((name) => !(name in VARIABLES))).toEqual([]);
  });
});
