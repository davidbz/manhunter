import {
  BALANCE,
  createDistrictLogic,
  createGenerationLogic,
  createGraphLogic,
  createMinCutLogic,
  createRiverLogic,
  createRng,
  createTopologyLogic,
  createValidatorLogic,
  type MapConfig,
  type MapGraph,
  makeEdge,
  makeEdgeId,
  makeExit,
  makeNode,
  makeNodeId,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { createMapSvgLogic, DEFAULT_SVG_THEME, makeMapSvgFileName } from "./svg";

const rng = createRng();
const graph = createGraphLogic();
const generation = createGenerationLogic({
  rng,
  topology: createTopologyLogic({ rng, graph }),
  river: createRiverLogic({ rng, graph }),
  districts: createDistrictLogic({ rng, graph }),
  validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
});

const DEFAULT_CONFIG: MapConfig = { columns: 8, rows: 6, exitCount: 3 };

const generate = (seed: number): MapGraph => {
  const result = generation.generate({
    config: DEFAULT_CONFIG,
    balance: BALANCE,
    state: rng.seed(seed),
  });
  if (result.kind !== "map") {
    throw new Error(`seed ${seed} produced no map`);
  }
  return result.graph;
};

const svg = createMapSvgLogic();

const TAGS = /<\/?([a-z]+)(?:\s[^>]*?)?(\/?)>/g;

/**
 * Whether every tag in the output opens and closes in order. An independent oracle rather than a
 * restatement of the renderer: the renderer emits strings and never builds a tree, so nothing here
 * can agree with it by construction. A real XML parser would be better, but `sim` runs under the
 * node environment and adding a DOM to it for one assertion is a dependency the plan does not have.
 */
const isWellFormed = (markup: string): boolean => {
  const open: string[] = [];
  for (const match of markup.matchAll(TAGS)) {
    const [text, tag, selfClosing] = match;
    if (tag === undefined || selfClosing === "/") {
      continue;
    }
    if (text.startsWith("</")) {
      if (open.pop() !== tag) {
        return false;
      }
      continue;
    }
    open.push(tag);
  }
  return open.length === 0;
};

const a = makeNodeId("n-0-0");
const b = makeNodeId("n-1-0");

/** Two nodes, one road, one exit, no river: the smallest thing the renderer has to be right about. */
const TINY_MAP: MapGraph = {
  nodes: [makeNode(a, "downtown", { x: 0, y: 0 }), makeNode(b, "exit", { x: 10, y: 0 })],
  edges: [makeEdge("road", makeEdgeId("e-0-0-h"), a, b)],
  exits: [makeExit(b, "airport")],
  river: null,
  incidentNodeId: a,
};

describe("map SVG export", () => {
  it("renders a parseable standalone SVG document", () => {
    const output = svg.render({ graph: TINY_MAP });
    expect(output.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(output.trimEnd().endsWith("</svg>")).toBe(true);
    expect(isWellFormed(output)).toBe(true);
  });

  /**
   * ImageMagick's built-in renderer drops any shape that has element children, so a `<title>`
   * nested inside a `<circle>` rasterizes to an empty city while browsers show it fine. Labels
   * therefore live in a wrapping `<g>` and every shape stays self-closing.
   */
  it("keeps labels in a wrapping group rather than inside the shape", () => {
    const output = svg.render({ graph: generate(1) });
    expect(output).toContain("<g><title>");
    expect(output).not.toMatch(/<(?:circle|line|polyline|rect)[^>]*[^/]>/);
  });

  it("draws one line per edge and one circle per node", () => {
    const map = generate(1);
    const output = svg.render({ graph: map });
    expect(output.match(/<line /g)).toHaveLength(map.edges.length);
    expect(output.match(/<circle /g)).toHaveLength(map.nodes.length);
  });

  it("styles each edge by its kind", () => {
    const map = generate(1);
    const output = svg.render({ graph: map });
    const bridges = map.edges.filter((edge) => edge.kind === "bridge");
    expect(bridges.length).toBeGreaterThan(0);
    for (const edge of bridges) {
      expect(output).toContain(`<title>${edge.id} bridge</title>`);
    }
    expect(output).toContain(`stroke="${DEFAULT_SVG_THEME.edges.bridge.stroke}"`);
    expect(output).toContain(`stroke-dasharray="${DEFAULT_SVG_THEME.edges.footpath.dash}"`);
  });

  it("marks the incident node and every exit apart from ordinary districts", () => {
    const map = generate(1);
    const output = svg.render({ graph: map });
    expect(output).toContain(`r="${DEFAULT_SVG_THEME.incidentRadius}"`);
    expect(output.match(new RegExp(`stroke="${DEFAULT_SVG_THEME.exitStroke}"`, "g"))).toHaveLength(
      map.exits.length,
    );
    for (const exit of map.exits) {
      expect(output).toContain(`exit ${exit.kind}`);
    }
    expect(output).toContain("incident");
  });

  it("draws the river when the map has one, and nothing when it has none", () => {
    const map = generate(1);
    expect(map.river).not.toBeNull();
    expect(svg.render({ graph: map })).toContain("<polyline ");
    expect(svg.render({ graph: TINY_MAP })).not.toContain("<polyline ");
  });

  it("fits the viewBox around every drawn point, river included", () => {
    const output = svg.render({ graph: TINY_MAP });
    const padding = DEFAULT_SVG_THEME.padding;
    expect(output).toContain(
      `viewBox="${-padding} ${-padding} ${10 + padding * 2} ${padding * 2}"`,
    );
  });

  it("is deterministic: the same map renders byte-identically", () => {
    expect(svg.render({ graph: generate(3) })).toBe(svg.render({ graph: generate(3) }));
  });

  it("escapes markup that would otherwise produce an unparseable file", () => {
    const hostile = makeNodeId('n-<&"0');
    const output = svg.render({
      graph: {
        ...TINY_MAP,
        nodes: [makeNode(hostile, "park", { x: 0, y: 0 })],
        edges: [],
        exits: [],
        incidentNodeId: hostile,
      },
    });
    expect(output).toContain("n-&lt;&amp;&quot;0");
    expect(output).not.toContain('n-<&"0');
    expect(isWellFormed(output)).toBe(true);
  });

  it("skips an edge naming a node the map does not contain", () => {
    const output = svg.render({
      graph: {
        ...TINY_MAP,
        edges: [makeEdge("road", makeEdgeId("e-ghost"), a, makeNodeId("n-9-9"))],
      },
    });
    expect(output).not.toContain("<line ");
  });

  it("renders an empty map without an infinite viewBox", () => {
    const output = svg.render({
      graph: { ...TINY_MAP, nodes: [], edges: [], exits: [] },
    });
    expect(output).not.toContain("Infinity");
    expect(output).not.toContain("NaN");
  });

  it("names the file after the seed", () => {
    expect(makeMapSvgFileName(42)).toBe("map-42.svg");
  });
});
