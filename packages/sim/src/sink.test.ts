import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
} from "@manhunter/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactWriter } from "./artifact";
import { LIMITS } from "./limits";
import { createFileSink } from "./sink";
import { createMapSvgLogic, makeMapSvgFileName } from "./svg";

const rng = createRng();
const graph = createGraphLogic();
const generation = createGenerationLogic({
  rng,
  topology: createTopologyLogic({ rng, graph }),
  river: createRiverLogic({ rng, graph }),
  districts: createDistrictLogic({ rng, graph }),
  validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
});

const svg = createMapSvgLogic();
const writer = createArtifactWriter({ sink: createFileSink() });

const CONFIG: MapConfig = { columns: 8, rows: 6, exitCount: 3 };
const SEED = 7;

let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "manhunter-sim-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** The M2.4 acceptance criterion end to end: generate, render, write, read the file back. */
describe("map-<seed>.svg", () => {
  it("writes a generated map to disk under its seed's name", async () => {
    const generated = generation.generate({
      config: CONFIG,
      balance: BALANCE,
      state: rng.seed(SEED),
    });
    expect(generated.kind).toBe("map");
    if (generated.kind !== "map") return;

    const contents = svg.render({ graph: generated.graph });
    const path = join(directory, makeMapSvgFileName(SEED));
    const result = await writer.write({ path, contents });

    expect(result.kind).toBe("written");
    expect(path.endsWith("map-7.svg")).toBe(true);
    expect(await readFile(path, "utf8")).toBe(contents);
  });

  it("leaves no file behind when the artefact is over the bound", async () => {
    const path = join(directory, makeMapSvgFileName(SEED + 1));
    const result = await writer.write({ path, contents: "<svg />", maxBytes: 1 });

    expect(result).toEqual({ kind: "too_large", bytes: 7, maxBytes: 1 });
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  it("keeps a rendered map far inside LIMITS.maxOutputFileBytes", async () => {
    const generated = generation.generate({
      config: CONFIG,
      balance: BALANCE,
      state: rng.seed(SEED),
    });
    if (generated.kind !== "map") return;

    const bytes = new TextEncoder().encode(svg.render({ graph: generated.graph })).byteLength;
    expect(bytes).toBeLessThan(LIMITS.maxOutputFileBytes);
  });
});
