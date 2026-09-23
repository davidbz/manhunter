/**
 * What one order costs the plan, in all three meters it moves (PLAN M7.3).
 *
 * `core`'s `actionCostOf` answers the two meters it validates, action points and budget. Trust is
 * the third meter an order moves, but `core` keeps each action's `trustChange` private to its
 * `ACTION_TABLE`, so the one place `web` reads it is `TRUST_CHANGES` below, and every number there
 * is still a `Balance` field rather than a copy of one. A fifth action is a compile error here
 * until it says what it does to trust.
 *
 * Trust is signed, the way `core` applies it: negative is spent, positive is gained. It is never
 * refused, only clamped (`core`'s `charge`), which is why nothing here asks whether it is short.
 *
 * Its own file rather than `actionqueue.ts` or `actionpanel.tsx` because both read it, and
 * `actionqueue.ts` already imports its words from `actionpanel.tsx`.
 */

import { actionCostOf, type Balance, type HunterActionKind } from "@manhunter/core";

/** The three meters an order moves, named the way `HunterState` names them. */
export type PlanResources = {
  readonly actionPoints: number;
  readonly budget: number;
  readonly trust: number;
};

/** `actionCostOf`'s two costs plus the signed change the order makes to trust. */
export type PlanCost = {
  readonly actionPoints: number;
  readonly budget: number;
  readonly trust: number;
};

const NO_TRUST_CHANGE = 0;

const TRUST_CHANGES: Readonly<Record<HunterActionKind, (balance: Balance) => number>> = {
  roadblock: (balance) => -balance.actions.roadblock.trustCost,
  canvass: (balance) => -balance.actions.canvass.trustCost,
  pull_cctv: () => NO_TRUST_CHANGE,
  true_briefing: (balance) => balance.actions.trueBriefing.trustGain,
};

export const planCostOf = (kind: HunterActionKind, balance: Balance): PlanCost => ({
  ...actionCostOf(kind, balance),
  trust: TRUST_CHANGES[kind](balance),
});
