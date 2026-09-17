/**
 * Bounds for every boundary `sim` crosses, per AGENTS.md "Bound every I/O up front":
 * CLI arguments in, report and map files out. Each boundary gets a test that feeds it
 * input one over the limit when the boundary itself is implemented.
 */
export const LIMITS = {
  /** Games one `bun run sim` invocation may simulate (PLAN M4.2). */
  maxGamesPerRun: 100_000,
  /** Bytes a single written artefact may reach before the write is rejected (PLAN M2.4, M4.2). */
  maxOutputFileBytes: 16 * 1024 * 1024,
  /** CLI arguments accepted before the invocation is rejected (PLAN M4.2). */
  maxCliArguments: 32,
} as const;
