/**
 * The dispatch board (PLAN M5.5a): every action the hunter can take this turn, what each costs,
 * which one is armed, and whether the armed one is ready to commit.
 *
 * Presentational and controlled, like `maprenderer.tsx` and `meters.tsx`. It holds no state:
 * which action is armed and what it is pointed at is screen state, because `MapPanel` reads the
 * same selection (PLAN M5.3a's note), so both arrive as props.
 *
 * **No cost and no target kind is stated here.** `actionCostOf` and `targetKindOf` are read from
 * `core` on every option, so an action whose price or target changes in `balance.ts` changes here
 * with it, and an action added to `core` is a compile error in `ACTION_PRESENTATION` until it has
 * a label. What this file owns is words, which is the one thing `core` has none of.
 *
 * An action the hunter cannot afford is offered disabled rather than hidden: DESIGN.md "End
 * conditions" rejects an unaffordable action at planning time, and a player who cannot see the
 * price of the thing they cannot buy cannot plan around it.
 */

import {
  type ActionCost,
  type ActionTargetKind,
  actionCostOf,
  type Balance,
  type HunterAction,
  type HunterActionKind,
  targetKindOf,
} from "@manhunter/core";
import type { ActionTarget } from "./actiondraft";

/** The part of `HunterState` an action is billed against, named the way `MeterBounds` is. */
export type ActionResources = {
  readonly actionPoints: number;
  readonly budget: number;
};

/** What one action says on the board. Written out per kind so a fifth is a compile error. */
export type ActionPresentation = {
  readonly kind: HunterActionKind;
  readonly label: string;
};

/**
 * DESIGN.md's MVP subset, in the order the board offers it: containment first, then the two
 * intelligence actions, then media. Keyed by kind and read back with `Object.values`, which is
 * the `DIFFICULTY_TABLE` precedent in `sim`'s CLI: one table, no cast, and no second list to
 * fall out of step with `HunterActionKind`.
 */
export const ACTION_PRESENTATION: Readonly<Record<HunterActionKind, ActionPresentation>> = {
  roadblock: { kind: "roadblock", label: "Roadblock" },
  canvass: { kind: "canvass", label: "Canvass" },
  pull_cctv: { kind: "pull_cctv", label: "Pull CCTV" },
  true_briefing: { kind: "true_briefing", label: "Brief the press" },
};

export const ACTION_KINDS: readonly HunterActionKind[] = Object.values(ACTION_PRESENTATION).map(
  (presentation) => presentation.kind,
);

/** What the board asks for once an action is armed, keyed by what `core` says it targets. */
export const ACTION_TARGET_PROMPTS: Readonly<Record<ActionTargetKind, string>> = {
  edge: "Select a road on the map",
  node: "Select a district on the map",
  global: "No target needed",
};

/** One action, priced and judged against what the hunter is holding. */
export type ActionOption = {
  readonly kind: HunterActionKind;
  readonly label: string;
  readonly targetKind: ActionTargetKind;
  readonly cost: ActionCost;
  readonly affordable: boolean;
};

export type ActionPanelProps = {
  readonly options: readonly ActionOption[];
  readonly armed: HunterActionKind | null;
  readonly onArm: (kind: HunterActionKind) => void;
  readonly target: ActionTarget | null;
  /**
   * The armed action once it has a target it accepts, which is the seam PLAN M5.5b picks up: the
   * queue takes exactly this value, and it is `null` for as long as there is nothing to queue.
   */
  readonly draft: HunterAction | null;
};

export const ACTION_PANEL_TEST_ID = "action-panel";
export const ACTION_OPTION_TEST_ID = "action-option";
export const ACTION_COST_TEST_ID = "action-cost";
export const ACTION_DRAFT_TEST_ID = "action-draft";

const ACTIONS_LABEL = "Actions";
const COST_SEPARATOR = ", ";
const ACTION_POINT_SUFFIX = " AP";
const BUDGET_SUFFIX = " budget";
const CHOOSE_PROMPT = "Choose an action";
const READY_PREFIX = "Ready: ";
const READY_SEPARATOR = " - ";
/** Exported because PLAN M5.5b's queue names the same target, and the city has one name here. */
export const GLOBAL_TARGET_LABEL = "the whole city";

export const costLabel = (cost: ActionCost): string =>
  `${cost.actionPoints}${ACTION_POINT_SUFFIX}${COST_SEPARATOR}${cost.budget}${BUDGET_SUFFIX}`;

/**
 * Every action, priced from `core`. The affordability test is the same pair of comparisons
 * `core`'s `validate` makes, against the meters the view carries rather than the world it cannot
 * see, which is why `actionCostOf` exists (its own note).
 */
export const actionOptionsOf = (
  balance: Balance,
  resources: ActionResources,
): readonly ActionOption[] =>
  ACTION_KINDS.map((kind) => {
    const cost = actionCostOf(kind, balance);

    return {
      kind,
      label: ACTION_PRESENTATION[kind].label,
      targetKind: targetKindOf(kind),
      cost,
      affordable: cost.actionPoints <= resources.actionPoints && cost.budget <= resources.budget,
    };
  });

const targetLabel = (target: ActionTarget): string => {
  if ("edgeId" in target) return target.edgeId;
  if ("nodeId" in target) return target.nodeId;

  return GLOBAL_TARGET_LABEL;
};

/** What the board says under the buttons: nothing armed, what to pick, or what is ready. */
export const draftMessage = (props: ActionPanelProps): string => {
  const option = props.options.find((candidate) => candidate.kind === props.armed);
  if (option === undefined) return CHOOSE_PROMPT;
  if (props.draft === null || props.target === null)
    return ACTION_TARGET_PROMPTS[option.targetKind];

  return `${READY_PREFIX}${option.label}${READY_SEPARATOR}${targetLabel(props.target)}`;
};

const ActionOptionButton = ({
  option,
  armed,
  onArm,
}: {
  readonly option: ActionOption;
  readonly armed: boolean;
  readonly onArm: (kind: HunterActionKind) => void;
}) => (
  <li>
    <button
      type="button"
      aria-pressed={armed}
      disabled={!option.affordable}
      data-testid={ACTION_OPTION_TEST_ID}
      data-action={option.kind}
      data-target={option.targetKind}
      data-affordable={option.affordable}
      data-armed={armed}
      onClick={() => onArm(option.kind)}
    >
      <span>{option.label}</span>
      <span data-testid={ACTION_COST_TEST_ID}>{costLabel(option.cost)}</span>
    </button>
  </li>
);

export const ActionPanel = (props: ActionPanelProps) => (
  <section aria-label={ACTIONS_LABEL} data-testid={ACTION_PANEL_TEST_ID}>
    <ul>
      {props.options.map((option) => (
        <ActionOptionButton
          key={option.kind}
          option={option}
          armed={option.kind === props.armed}
          onArm={props.onArm}
        />
      ))}
    </ul>
    <p data-testid={ACTION_DRAFT_TEST_ID} data-ready={props.draft !== null}>
      {draftMessage(props)}
    </p>
  </section>
);
