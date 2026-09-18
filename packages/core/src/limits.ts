/**
 * Bounds for loops whose iteration count depends on generated data, per AGENTS.md
 * "Bound every I/O up front". `core` performs no I/O; these cap the internal searches that
 * could otherwise run unbounded on an unlucky seed. Tuning belongs to the task that adds
 * the loop, not here.
 */
export const LIMITS = {
  /**
   * Map regeneration attempts before generate-until-valid gives up (PLAN M2.3). Tuned from the
   * placeholder 64 on measurement: 3000 default-grid seeds need a mean of 5.98 attempts (p99 25,
   * p999 38, max 57), so 64 leaves only a factor of ~1.1 over the observed tail. The geometric
   * rate that implies puts a spurious failure at 8.4e-6 per map, which is a 0.8% chance per
   * 1000-game M4.2 batch - a real flake for M4.3 to chase. 128 puts it at 7e-11 instead.
   * The headroom is close to free: the cap is only ever reached by a config that cannot work,
   * and an impossible one (a 3x3 grid, which can carry no river) exhausts all 128 in under 2ms.
   */
  maxMapGenerationAttempts: 128,
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
  /**
   * Bridge and tunnel edges the chokepoint rule may test (PLAN M2.2). Each candidate costs a whole
   * shortest-path search with that edge removed, so this is a time bound on validation rather than
   * a statement about maps. A generated map carries at most `balance.map.maxBridges` of them and
   * no tunnels at all, so this is an order of magnitude of headroom; a map that reaches it leaves
   * the rule undecided rather than letting a partial scan claim the chokepoint is absent.
   */
  maxChokepointCandidates: 64,
  /** Candidate actions the criminal AI may enumerate in one turn (PLAN M3.5). */
  maxAiCandidates: 256,
} as const;
