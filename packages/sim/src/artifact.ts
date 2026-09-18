/**
 * The one bound on everything `sim` writes to disk (PLAN M2.4): the debug SVG now, M4.2's batch
 * report later.
 *
 * AGENTS.md section 5 wants the limit declared before the operation runs, so the size is measured
 * and refused *before* the sink is touched - an oversized artefact leaves no partial file behind,
 * and it is an error result rather than a truncation. The filesystem arrives as an injected
 * capability (`FileSink`) defined here by the consumer, which is what lets the writer's own tests
 * run without touching a disk.
 */

import { LIMITS } from "./limits";

export type FileSink = {
  readonly write: (path: string, contents: string) => Promise<void>;
};

export type ArtifactRequest = {
  readonly path: string;
  readonly contents: string;
  /** Defaults to `LIMITS.maxOutputFileBytes`. Overridable so a test can reach the cap cheaply. */
  readonly maxBytes?: number;
};

/**
 * `too_large` carries both numbers because the caller's only useful response is to say by how much
 * the artefact overran, and it deliberately carries no path: nothing was written.
 */
export type ArtifactResult =
  | { readonly kind: "written"; readonly path: string; readonly bytes: number }
  | { readonly kind: "too_large"; readonly bytes: number; readonly maxBytes: number };

export type ArtifactWriter = {
  readonly write: (request: ArtifactRequest) => Promise<ArtifactResult>;
};

/** UTF-8 bytes, not code units: the sink writes UTF-8, so that is the unit the bound is in. */
const byteLengthOf = (contents: string): number => new TextEncoder().encode(contents).byteLength;

export const createArtifactWriter = (deps: { readonly sink: FileSink }): ArtifactWriter => ({
  write: async ({ path, contents, maxBytes = LIMITS.maxOutputFileBytes }) => {
    const bytes = byteLengthOf(contents);
    if (bytes > maxBytes) {
      return { kind: "too_large", bytes, maxBytes };
    }
    await deps.sink.write(path, contents);
    return { kind: "written", path, bytes };
  },
});
