/**
 * What the case briefing tells the player before a hunt (PLAN M6.9): the rules the hunt will be
 * played and lost under, stated from `Balance` so the words cannot drift from the numbers `core`
 * enforces. Nothing here is drawn from a seed or a world, so nothing here can hint at who the
 * criminal is or where they start (architecture rule 4).
 *
 * One entry per `BriefingItemKind`, written out in a `Record` so a new kind is a compile error
 * until it says something.
 */

import type { Balance } from "@manhunter/core";

export const BRIEFING_ITEM_KINDS = [
  "objective",
  "deadline",
  "casualties",
  "trust",
  "resources",
] as const;
export type BriefingItemKind = (typeof BRIEFING_ITEM_KINDS)[number];

export type BriefingItem = {
  readonly kind: BriefingItemKind;
  readonly title: string;
  readonly detail: string;
};

const BRIEFING_TEXT: Readonly<
  Record<BriefingItemKind, (balance: Balance) => Omit<BriefingItem, "kind">>
> = {
  objective: (balance) => ({
    title: "Objective",
    detail: `Run the fugitive down before they reach one of the city's ${balance.map.defaults.exitCount} exits.`,
  }),
  deadline: (balance) => ({
    title: "Deadline",
    detail: `${balance.time.maxTurns} turns on the clock. When it runs out, the case goes cold.`,
  }),
  casualties: (balance) => ({
    title: "Casualties",
    detail: `${balance.endConditions.casualtiesToLose} civilian casualties and you are pulled off the case.`,
  }),
  trust: (balance) => ({
    title: "Public trust",
    detail: `Trust starts at ${balance.hunter.startingTrust}. At ${balance.endConditions.trustCollapseAt}, you are removed from the case.`,
  }),
  resources: (balance) => ({
    title: "Resources",
    detail: `A budget of ${balance.hunter.startingBudget} and ${balance.hunter.actionPointsPerTurn} action points a turn.`,
  }),
};

export const briefingOf = (balance: Balance): readonly BriefingItem[] =>
  BRIEFING_ITEM_KINDS.map((kind) => ({ kind, ...BRIEFING_TEXT[kind](balance) }));
