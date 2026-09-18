/**
 * Bounds for loops whose iteration count depends on generated data, per AGENTS.md
 * "Bound every I/O up front". `core` performs no I/O; these cap the internal searches that
 * could otherwise run unbounded on an unlucky seed. Tuning belongs to the task that adds
 * the loop, not here.
 */
export const LIMITS = {
  /** Map regeneration attempts before generate-until-valid gives up (PLAN M2.3). */
  maxMapGenerationAttempts: 64,
  /**
   * Nodes a generated map may contain (PLAN M2.1a). `MapConfig` comes from the player-visible
   * setup and therefore from a replay string, so the grid is sized from untrusted input and the
   * bound belongs here rather than in `balance.ts`. It is a time bound: generation runs one
   * connectivity sweep per removal candidate, so the work grows with the cube of the grid side,
   * and 256 keeps the default 8x6 two and a half orders of magnitude inside it.
   */
  maxMapNodes: 256,
  /**
   * Nodes a single pathfinding or min-cut search may expand (PLAN M1.4). Tuned down from 100_000
   * when M1.4a chose a scanned frontier over a heap: city maps are tens of nodes, so this is two
   * orders of magnitude of headroom, and it keeps the quadratic worst case well under a second.
   * A search that reaches it is a generator bug, not a workload.
   */
  maxSearchExpansions: 5_000,
  /** Candidate actions the criminal AI may enumerate in one turn (PLAN M3.5). */
  maxAiCandidates: 256,
} as const;
