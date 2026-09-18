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
   * Nodes a single pathfinding or min-cut search may expand (PLAN M1.4). Tuned down from 100_000
   * when M1.4a chose a scanned frontier over a heap: city maps are tens of nodes, so this is two
   * orders of magnitude of headroom, and it keeps the quadratic worst case well under a second.
   * A search that reaches it is a generator bug, not a workload.
   */
  maxSearchExpansions: 5_000,
  /** Candidate actions the criminal AI may enumerate in one turn (PLAN M3.5). */
  maxAiCandidates: 256,
} as const;
