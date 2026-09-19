/**
 * Generation validity (PLAN M2.2): the rules from DESIGN.md that a generated city has to satisfy
 * before it is worth hunting in. A city that fails one is regenerated, never repaired (PLAN M2.3).
 *
 * It returns every violation it finds rather than the first, because the caller that reports an
 * impossible config has to be able to name what was wrong with it, and because a map can be broken
 * in several ways at once.
 *
 * Two readings that DESIGN.md left open are settled in PLAN "Decisions" and implemented here
 * literally. Distances are measured in `balance.map.escapeMode`. A chokepoint that matters is a
 * **`bridge` or `tunnel`** edge whose removal strictly increases the shortest start-to-nearest-exit
 * cost; without the edge-kind half the rule passes almost every map, because almost every map has
 * some edge on a unique shortest path.
 *
 * Rules defer to each other rather than restating each other's findings: `escape_distance`,
 * `exit_cut` and `chokepoint` all report nothing when no exit is reachable, because there is no
 * cost, cut or baseline to measure and `exits_reachable` has already said so.
 */

import type { Balance } from "./balance";
import type { GraphLogic, Traversal } from "./graph";
import type { EdgeId, NodeId } from "./ids";
import { LIMITS } from "./limits";
import type { EdgeKind, MapEdge, MapGraph, TraversableGraph } from "./map";
import type { MinCutLogic } from "./mincut";
import type { NonEmptyArray } from "./rng";

export type ValidationRule =
  | "exits_reachable"
  | "escape_distance"
  | "exit_cut"
  | "chokepoint"
  | "start_clear_of_exits";

/**
 * `undecided` is not a property of the map: it is a bounded search giving up before it could
 * answer. It is reported as a violation so that a map whose validity is unknown is regenerated
 * rather than accepted, and it names its rule so the reason is never mistaken for the map being
 * genuinely bad.
 */
export type Violation =
  | { readonly kind: "no_exits" }
  | { readonly kind: "exit_unreachable"; readonly nodeId: NodeId }
  | { readonly kind: "escape_too_short"; readonly cost: number; readonly required: number }
  | { readonly kind: "exit_cut_too_small"; readonly value: number; readonly required: number }
  | { readonly kind: "no_chokepoint" }
  | { readonly kind: "start_is_exit"; readonly nodeId: NodeId }
  | { readonly kind: "exit_adjacent_to_start"; readonly nodeId: NodeId; readonly edgeId: EdgeId }
  | { readonly kind: "undecided"; readonly rule: ValidationRule };

export type ValidationResult =
  | { readonly kind: "valid" }
  | { readonly kind: "invalid"; readonly violations: NonEmptyArray<Violation> };

export type ValidationRequest = {
  readonly graph: MapGraph;
  readonly balance: Balance;
  /** Defaults to `LIMITS.maxSearchExpansions`. Overridable so a test can reach the cap (M1.4a). */
  readonly maxExpansions?: number;
};

export type ValidatorLogic = {
  readonly validate: (request: ValidationRequest) => ValidationResult;
};

type ValidatorDeps = {
  readonly graph: GraphLogic;
  readonly minCut: MinCutLogic;
};

/** Everything the rules read, derived once. Plain data; the rules are the logic over it. */
type RuleContext = {
  readonly graph: MapGraph;
  readonly balance: Balance;
  readonly traversal: Traversal;
  readonly startNodeId: NodeId;
  readonly exitNodeIds: readonly NodeId[];
};

type RuleCheck = (deps: ValidatorDeps, context: RuleContext) => readonly Violation[];

/**
 * The edge kinds a chokepoint can be. Part of the rule rather than decoration: restricting it to
 * the crossings M2.1b builds is what ties the validator to the river.
 */
const CHOKEPOINT_KINDS: readonly EdgeKind[] = ["bridge", "tunnel"];

const NO_VIOLATIONS: readonly Violation[] = [];
const VALID = { kind: "valid" } as const;

const undecided = (rule: ValidationRule): readonly Violation[] => [{ kind: "undecided", rule }];

/** DESIGN.md: "Every exit is reachable from the criminal start." */
const checkExitsReachable: RuleCheck = (deps, context) => {
  if (context.exitNodeIds.length === 0) {
    return [{ kind: "no_exits" }];
  }
  const reached = deps.graph.reachable(context.traversal, context.startNodeId);
  if (reached.kind !== "reachable") {
    return undecided("exits_reachable");
  }
  const found = new Set(reached.nodeIds);
  return context.exitNodeIds
    .filter((nodeId) => !found.has(nodeId))
    .map((nodeId) => ({ kind: "exit_unreachable", nodeId }) as const);
};

/** DESIGN.md: "Shortest start-to-nearest-exit path >= `MIN_ESCAPE_TURNS`." */
const checkEscapeDistance: RuleCheck = (deps, context) => {
  const path = deps.graph.shortestPathToAny(
    context.traversal,
    context.startNodeId,
    context.exitNodeIds,
  );
  if (path.kind === "expansion_limit_exceeded") {
    return undecided("escape_distance");
  }
  if (path.kind === "unreachable") {
    return NO_VIOLATIONS;
  }
  const required = context.balance.map.minEscapeTurns;
  if (path.cost >= required) {
    return NO_VIOLATIONS;
  }
  return [{ kind: "escape_too_short", cost: path.cost, required }];
};

/**
 * DESIGN.md: "Min-cut between start and the set of exits >= 2 (one roadblock never wins)."
 *
 * The cut counts edges, not blockable edges (M1.4b's note): a footpath cannot be roadblocked but
 * is still a way out, and the rule is about how many ways out exist.
 */
const checkExitCut: RuleCheck = (deps, context) => {
  if (context.exitNodeIds.length === 0) {
    return NO_VIOLATIONS;
  }
  const result = deps.minCut.minCut(context.traversal, context.startNodeId, context.exitNodeIds);
  if (result.kind === "expansion_limit_exceeded") {
    return undecided("exit_cut");
  }
  if (result.kind === "not_separable") {
    return NO_VIOLATIONS;
  }
  const required = context.balance.map.minCutToExits;
  if (result.value >= required) {
    return NO_VIOLATIONS;
  }
  return [{ kind: "exit_cut_too_small", value: result.value, required }];
};

const removeEdge = (graph: TraversableGraph, edgeId: EdgeId): TraversableGraph => ({
  nodes: graph.nodes,
  edges: graph.edges.filter((edge) => edge.id !== edgeId),
});

type ChokepointVerdict = "raises_cost" | "leaves_cost" | "undecided";

const verdictFor = (
  deps: ValidatorDeps,
  context: RuleContext,
  baselineCost: number,
  edgeId: EdgeId,
): ChokepointVerdict => {
  const without = deps.graph.shortestPathToAny(
    { ...context.traversal, graph: removeEdge(context.traversal.graph, edgeId) },
    context.startNodeId,
    context.exitNodeIds,
  );
  if (without.kind === "expansion_limit_exceeded") {
    return "undecided";
  }
  // Severing it cuts the city off from every exit, which is as strict an increase as there is.
  if (without.kind === "unreachable") {
    return "raises_cost";
  }
  return without.cost > baselineCost ? "raises_cost" : "leaves_cost";
};

/**
 * DESIGN.md: "At least one chokepoint exists that matters: a `bridge` or `tunnel` edge whose
 * removal strictly increases the shortest start-to-nearest-exit cost."
 */
const checkChokepoint: RuleCheck = (deps, context) => {
  const candidates = context.graph.edges.filter((edge) => CHOKEPOINT_KINDS.includes(edge.kind));
  if (candidates.length > LIMITS.maxChokepointCandidates) {
    return undecided("chokepoint");
  }
  const baseline = deps.graph.shortestPathToAny(
    context.traversal,
    context.startNodeId,
    context.exitNodeIds,
  );
  if (baseline.kind === "expansion_limit_exceeded") {
    return undecided("chokepoint");
  }
  if (baseline.kind === "unreachable") {
    return NO_VIOLATIONS;
  }
  for (const edge of candidates) {
    const verdict = verdictFor(deps, context, baseline.cost, edge.id);
    if (verdict === "undecided") {
      return undecided("chokepoint");
    }
    if (verdict === "raises_cost") {
      return NO_VIOLATIONS;
    }
  }
  return [{ kind: "no_chokepoint" }];
};

/** The end of `edge` opposite `nodeId`, or `null` when the edge does not touch it at all. */
const otherEnd = (edge: MapEdge, nodeId: NodeId): NodeId | null => {
  if (edge.from === nodeId) {
    return edge.to;
  }
  if (edge.to === nodeId) {
    return edge.from;
  }
  return null;
};

/**
 * DESIGN.md: "Start is not adjacent to an exit", plus the degenerate case of the start *being* an
 * exit, which is the same rule one step further along and is what lets `exit_cut` treat an
 * unseparable pair as somebody else's finding.
 *
 * Adjacency here is structural, over every edge kind rather than the foot-traversable ones: a rail
 * line from the crime scene to the airport is still a way out of the front door.
 */
const checkStartClearOfExits: RuleCheck = (_deps, context) => {
  const exits = new Set(context.exitNodeIds);
  if (exits.has(context.startNodeId)) {
    return [{ kind: "start_is_exit", nodeId: context.startNodeId }];
  }
  return context.graph.edges.flatMap((edge) => {
    const other = otherEnd(edge, context.startNodeId);
    if (other === null || !exits.has(other)) {
      return NO_VIOLATIONS;
    }
    return [{ kind: "exit_adjacent_to_start", nodeId: other, edgeId: edge.id } as const];
  });
};

/**
 * Keyed by rule rather than listed, so a new `ValidationRule` is a compile error here until it has
 * a handler (the annotated-table precedent from M1.3). Insertion order is the report order.
 */
const RULES: Readonly<Record<ValidationRule, RuleCheck>> = {
  exits_reachable: checkExitsReachable,
  escape_distance: checkEscapeDistance,
  exit_cut: checkExitCut,
  chokepoint: checkChokepoint,
  start_clear_of_exits: checkStartClearOfExits,
};

const traversalOf = (request: ValidationRequest): Traversal => ({
  graph: request.graph,
  balance: request.balance,
  mode: request.balance.map.escapeMode,
  ...(request.maxExpansions === undefined ? {} : { maxExpansions: request.maxExpansions }),
});

const contextOf = (request: ValidationRequest): RuleContext => ({
  graph: request.graph,
  balance: request.balance,
  traversal: traversalOf(request),
  startNodeId: request.graph.incidentNodeId,
  exitNodeIds: request.graph.exits.map((exit) => exit.nodeId),
});

const isNonEmpty = <T>(items: readonly T[]): items is NonEmptyArray<T> => items.length > 0;

const validate = (deps: ValidatorDeps, request: ValidationRequest): ValidationResult => {
  const context = contextOf(request);
  const violations = Object.values(RULES).flatMap((check) => check(deps, context));
  if (!isNonEmpty(violations)) {
    return VALID;
  }
  return { kind: "invalid", violations };
};

export const createValidatorLogic = (deps: ValidatorDeps): ValidatorLogic => ({
  validate: (request) => validate(deps, request),
});
