import { describe, expect, it } from "vitest";
import { createArtifactWriter, type FileSink } from "./artifact";
import { LIMITS } from "./limits";

type Recorded = { readonly path: string; readonly contents: string };

/** A hand-written fake, per AGENTS.md: no module mocking, the seam is the injected `FileSink`. */
const createRecordingSink = (): { sink: FileSink; writes: Recorded[] } => {
  const writes: Recorded[] = [];
  return {
    sink: {
      write: (path, contents) => {
        writes.push({ path, contents });
        return Promise.resolve();
      },
    },
    writes,
  };
};

const PATH = "/tmp/manhunter-artifact.svg";

describe("bounded artefact writer", () => {
  it("writes contents inside the bound and reports the byte count", async () => {
    const { sink, writes } = createRecordingSink();
    const result = await createArtifactWriter({ sink }).write({ path: PATH, contents: "<svg />" });

    expect(result).toEqual({ kind: "written", path: PATH, bytes: 7 });
    expect(writes).toEqual([{ path: PATH, contents: "<svg />" }]);
  });

  it("counts UTF-8 bytes, not code units", async () => {
    const { sink } = createRecordingSink();
    const result = await createArtifactWriter({ sink }).write({ path: PATH, contents: "é" });

    expect(result).toEqual({ kind: "written", path: PATH, bytes: 2 });
  });

  it("accepts contents exactly at the bound", async () => {
    const { sink, writes } = createRecordingSink();
    const maxBytes = 8;
    const result = await createArtifactWriter({ sink }).write({
      path: PATH,
      contents: "a".repeat(maxBytes),
      maxBytes,
    });

    expect(result).toEqual({ kind: "written", path: PATH, bytes: maxBytes });
    expect(writes).toHaveLength(1);
  });

  it("rejects contents one byte over the bound without touching the sink", async () => {
    const { sink, writes } = createRecordingSink();
    const maxBytes = 8;
    const result = await createArtifactWriter({ sink }).write({
      path: PATH,
      contents: "a".repeat(maxBytes + 1),
      maxBytes,
    });

    expect(result).toEqual({ kind: "too_large", bytes: maxBytes + 1, maxBytes });
    expect(writes).toEqual([]);
  });

  it("rejects a multi-byte character that crosses the bound its length does not", async () => {
    const { sink, writes } = createRecordingSink();
    const result = await createArtifactWriter({ sink }).write({
      path: PATH,
      contents: "éé",
      maxBytes: 3,
    });

    expect(result).toEqual({ kind: "too_large", bytes: 4, maxBytes: 3 });
    expect(writes).toEqual([]);
  });

  it("defaults to LIMITS.maxOutputFileBytes and rejects one byte over it", async () => {
    const { sink, writes } = createRecordingSink();
    const writer = createArtifactWriter({ sink });

    const overLimit = await writer.write({
      path: PATH,
      contents: "a".repeat(LIMITS.maxOutputFileBytes + 1),
    });

    expect(overLimit).toEqual({
      kind: "too_large",
      bytes: LIMITS.maxOutputFileBytes + 1,
      maxBytes: LIMITS.maxOutputFileBytes,
    });
    expect(writes).toEqual([]);
  });
});
