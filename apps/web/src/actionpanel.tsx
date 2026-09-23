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
 *
 * **Tiles (PLAN M6.8).** Each option is a tile with a stencil icon and one cost chip per resource;
 * a chip the hunter cannot cover is marked `data-short`, so an unaffordable tile says *which*
 * meter is the problem, and the tile adds a visible "cannot afford" line rather than relying on
 * the dimming alone.
 *
 * **The board prices the plan, not the purse (PLAN M7.3).** The screen hands `actionOptionsOf`
 * what `remainingAfter` says the queued plan leaves, so a tile goes dark the moment the plan has
 * spent what it needs, before the player tries it. Tiles carry a third chip, trust, signed the way
 * `planCostOf` signs it; trust is clamped by `core` and never refused, so its chip is never
 * `data-short`. Each tile shows the key that arms it (`actionKeyOf`, 1 to 4 in board order), and
 * the screen listens for the same keys through `actionKindOfKey`.
 */

import {
  type ActionTargetKind,
  type Balance,
  type HunterAction,
  type HunterActionKind,
  targetKindOf,
} from "@manhunter/core";
import type { ActionTarget } from "./actiondraft";
import { ActionIcon } from "./actionicon";
import { edgeNameOf, nodeNameOf, type PlaceNames } from "./placenames";
import { type PlanCost, planCostOf } from "./plancost";

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

/** The three meters an action moves, one chip each on its tile. */
export const COST_CHIP_KINDS = ["action_points", "budget", "trust"] as const;

export type CostChipKind = (typeof COST_CHIP_KINDS)[number];

/** One action, priced and judged against what the hunter is holding. */
export type ActionOption = {
  readonly kind: HunterActionKind;
  readonly label: string;
  readonly targetKind: ActionTargetKind;
  readonly cost: PlanCost;
  readonly affordable: boolean;
  /** Which meter falls short of the price; all `false` exactly when affordable. Trust never is. */
  readonly short: Readonly<Record<CostChipKind, boolean>>;
};

export type CostChip = {
  readonly kind: CostChipKind;
  readonly text: string;
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
  /** What each place is called (PLAN M7.1). The ready line names its target by this. */
  readonly placeNames: PlaceNames;
};

export const ACTION_PANEL_TEST_ID = "action-panel";
export const ACTION_OPTION_TEST_ID = "action-option";
export const ACTION_COST_TEST_ID = "action-cost";
export const ACTION_DRAFT_TEST_ID = "action-draft";
export const ACTION_COST_CHIP_TEST_ID = "action-cost-chip";
export const ACTION_UNAFFORDABLE_TEST_ID = "action-unaffordable";
export const ACTION_KEYCAP_TEST_ID = "action-keycap";

const ACTIONS_LABEL = "Actions";
/** The keycap is announced once, as the tile's `aria-keyshortcuts`, not again as its text. */
const ARIA_HIDDEN = true;
const ACTIONS_TITLE = "Action board";
const UNAFFORDABLE_TEXT = "Cannot afford";
const COST_SEPARATOR = ", ";
const ACTION_POINT_SUFFIX = " AP";
const BUDGET_SUFFIX = " budget";
const TRUST_SUFFIX = " trust";
const GAIN_SIGN = "+";
const NO_SIGN = "";
const CHOOSE_PROMPT = "Choose an action";
const READY_PREFIX = "Ready: ";
const READY_SEPARATOR = " - ";
/** Exported because PLAN M5.5b's queue names the same target, and the city has one name here. */
export const GLOBAL_TARGET_LABEL = "the whole city";

/** A signed change reads with its sign, so a gain is never mistaken for a price. */
const signedText = (change: number): string => `${change > 0 ? GAIN_SIGN : NO_SIGN}${change}`;

export const costChipsOf = (cost: PlanCost): readonly CostChip[] => [
  { kind: "action_points", text: `${cost.actionPoints}${ACTION_POINT_SUFFIX}` },
  { kind: "budget", text: `${cost.budget}${BUDGET_SUFFIX}` },
  { kind: "trust", text: `${signedText(cost.trust)}${TRUST_SUFFIX}` },
];

export const costLabel = (cost: PlanCost): string =>
  costChipsOf(cost)
    .map((chip) => chip.text)
    .join(COST_SEPARATOR);

/**
 * The key that arms the tile at `index`: the board's order, counted from one, so the keys read
 * left to right the way the tiles do.
 */
export const actionKeyOf = (index: number): string => String(index + 1);

/** The action a key arms, or `null` for a key no tile answers to. */
export const actionKindOfKey = (key: string): HunterActionKind | null =>
  ACTION_KINDS.find((_, index) => actionKeyOf(index) === key) ?? null;

/**
 * Every action, priced from `core`. The affordability test is the same pair of comparisons
 * `core`'s `validate` makes, against the meters the view carries rather than the world it cannot
 * see, which is why `actionCostOf` exists (its own note). The dispatch screen passes what the
 * queued plan leaves (`remainingAfter`), not what the hunter holds.
 */
export const actionOptionsOf = (
  balance: Balance,
  resources: ActionResources,
): readonly ActionOption[] =>
  ACTION_KINDS.map((kind) => {
    const cost = planCostOf(kind, balance);
    const short = {
      action_points: cost.actionPoints > resources.actionPoints,
      budget: cost.budget > resources.budget,
      trust: false,
    };

    return {
      kind,
      label: ACTION_PRESENTATION[kind].label,
      targetKind: targetKindOf(kind),
      cost,
      affordable: !short.action_points && !short.budget,
      short,
    };
  });

const targetLabel = (target: ActionTarget, names: PlaceNames): string => {
  if ("edgeId" in target) return edgeNameOf(names, target.edgeId);
  if ("nodeId" in target) return nodeNameOf(names, target.nodeId);

  return GLOBAL_TARGET_LABEL;
};

/** What the board says under the buttons: nothing armed, what to pick, or what is ready. */
export const draftMessage = (props: ActionPanelProps): string => {
  const option = props.options.find((candidate) => candidate.kind === props.armed);
  if (option === undefined) return CHOOSE_PROMPT;
  if (props.draft === null || props.target === null)
    return ACTION_TARGET_PROMPTS[option.targetKind];

  return `${READY_PREFIX}${option.label}${READY_SEPARATOR}${targetLabel(props.target, props.placeNames)}`;
};

/**
 * The chips' text is `costLabel`'s, piece by piece, so the cost's `textContent` still reads
 * exactly as it did before the chips; the separator is only hidden from sight.
 */
const CostChips = ({ option }: { readonly option: ActionOption }) => (
  <span className="mh-tile__cost" data-testid={ACTION_COST_TEST_ID}>
    {costChipsOf(option.cost).map((chip, position) => (
      <span key={chip.kind} className="mh-tile__chip-slot">
        {position === 0 ? null : <span className="mh-visually-hidden">{COST_SEPARATOR}</span>}
        <span
          className="mh-chip"
          data-testid={ACTION_COST_CHIP_TEST_ID}
          data-chip={chip.kind}
          data-short={option.short[chip.kind]}
        >
          {chip.text}
        </span>
      </span>
    ))}
  </span>
);

const ActionOptionButton = ({
  option,
  keycap,
  armed,
  onArm,
}: {
  readonly option: ActionOption;
  readonly keycap: string;
  readonly armed: boolean;
  readonly onArm: (kind: HunterActionKind) => void;
}) => (
  <li className="mh-board__slot">
    <button
      type="button"
      className="mh-tile"
      aria-pressed={armed}
      disabled={!option.affordable}
      data-testid={ACTION_OPTION_TEST_ID}
      data-action={option.kind}
      data-target={option.targetKind}
      data-affordable={option.affordable}
      data-armed={armed}
      aria-keyshortcuts={keycap}
      onClick={() => onArm(option.kind)}
    >
      <kbd className="mh-tile__key" data-testid={ACTION_KEYCAP_TEST_ID} aria-hidden={ARIA_HIDDEN}>
        {keycap}
      </kbd>
      <ActionIcon kind={option.kind} />
      <span className="mh-tile__label">{option.label}</span>
      <CostChips option={option} />
      {option.affordable ? null : (
        <span className="mh-tile__status" data-testid={ACTION_UNAFFORDABLE_TEST_ID}>
          {UNAFFORDABLE_TEXT}
        </span>
      )}
    </button>
  </li>
);

export const ActionPanel = (props: ActionPanelProps) => (
  <section aria-label={ACTIONS_LABEL} className="mh-card" data-testid={ACTION_PANEL_TEST_ID}>
    <h2 className="mh-card__title">{ACTIONS_TITLE}</h2>
    <ul className="mh-board">
      {props.options.map((option, index) => (
        <ActionOptionButton
          key={option.kind}
          option={option}
          keycap={actionKeyOf(index)}
          armed={option.kind === props.armed}
          onArm={props.onArm}
        />
      ))}
    </ul>
    <p
      className="mh-board__draft"
      data-testid={ACTION_DRAFT_TEST_ID}
      data-ready={props.draft !== null}
    >
      {draftMessage(props)}
    </p>
  </section>
);
