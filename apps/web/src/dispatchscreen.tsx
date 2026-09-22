/**
 * The dispatch screen (PLAN M5.5a, M5.5b): the city, the heatmap over it, the meters, the feed,
 * the board the player arms an action from, and the queue they commit it to. Before a hunt exists
 * it is the new-hunt form instead, because `state.hunt` is `null` and every panel renders nothing
 * (PLAN M5.2's note).
 *
 * **This is the screen that owns selection**, which is why the assembly belongs to this task:
 * `MapPanel` and `ActionPanel` have to read the same value (PLAN M5.3a's note), so it is held
 * here and passed to both. Two pieces of state and nothing else - which action is armed, and
 * what is picked on the map - and every other thing on screen is derived from them plus `core`.
 *
 * **The map is narrowed by `targetKindOf` and by nothing else.** A selection the armed action
 * does not take is not taken here either, and arming an action drops a selection that no longer
 * fits, so the invariant is that the selection is always a target the armed action accepts. That
 * is what makes `draft` either a well-formed `HunterAction` or `null`, with no third state.
 *
 * `draft` is the seam PLAN M5.5b picks up: `TurnQueuePanel` takes exactly that value and owns the
 * queue it goes into, and disarming is this screen's answer to having committed one - a row taken
 * into the queue is a row this screen is no longer pointing at.
 *
 * The errors are `DispatchErrorsPanel`'s, and it is rendered before a hunt as well as during one:
 * a hunt that refused to start leaves `state.hunt` null, so a refusal only reachable on the
 * dispatch half would be a start button that silently does nothing.
 *
 * **A hunt whose outcome is no longer `in_progress` gets `EndScreenPanel` instead of the board.**
 * PLAN M5.5b's note flagged that nothing told this screen the hunt was over except a `hunt_over`
 * refusal surfacing on the next dispatch nobody could make happen twice; this is that fix. Once
 * the swap happens the End Turn button is gone with the rest of the board, so `hunt_over` stops
 * being reachable through play and stays only a defensive case in `dispatcherrors.tsx`.
 *
 * **`ReplayScreen` (PLAN M5.6b) renders beside `EndScreenPanel` once the hunt is over**, the
 * after-action replay next to the outcome it explains.
 */

import type { HunterActionKind } from "@manhunter/core";
import { useState } from "react";
import { acceptsTarget, buildAction, targetOf } from "./actiondraft";
import { ActionPanel, actionOptionsOf } from "./actionpanel";
import { BeliefOverlayPanel } from "./beliefoverlaypanel";
import { DispatchErrorsPanel } from "./dispatcherrorspanel";
import { EndScreenPanel } from "./endscreenpanel";
import { MapPanel } from "./mappanel";
import type { MapSelection } from "./maprenderer";
import { MetersPanel } from "./meterspanel";
import { NewHuntForm } from "./newhuntform";
import { ReplayScreen } from "./replayscreen";
import { ReportFeedPanel } from "./reportfeedpanel";
import { useGameStore } from "./storecontext";
import { TurnQueuePanel } from "./turnqueuepanel";

export const DISPATCH_SCREEN_TEST_ID = "dispatch-screen";

const DISPATCH_LABEL = "Dispatch";

export const DispatchScreen = () => {
  const balance = useGameStore((state) => state.balance);
  const resources = useGameStore((state) => state.hunt?.view.hunter ?? null);
  const outcomeKind = useGameStore((state) => state.hunt?.view.outcome.kind ?? null);
  const [armed, setArmed] = useState<HunterActionKind | null>(null);
  const [selection, setSelection] = useState<MapSelection | null>(null);

  const arm = (kind: HunterActionKind): void => {
    setArmed(kind);
    setSelection((current) => (current !== null && acceptsTarget(kind, current) ? current : null));
  };

  const select = (next: MapSelection): void => {
    if (armed !== null && !acceptsTarget(armed, next)) return;

    setSelection(next);
  };

  const disarm = (): void => {
    setArmed(null);
    setSelection(null);
  };

  if (resources === null)
    return (
      <>
        <DispatchErrorsPanel />
        <NewHuntForm />
      </>
    );

  if (outcomeKind !== "in_progress")
    return (
      <>
        <EndScreenPanel />
        <ReplayScreen />
      </>
    );

  const target = armed === null ? null : targetOf(armed, selection);
  const draft = armed === null || target === null ? null : buildAction(armed, target);

  return (
    <section aria-label={DISPATCH_LABEL} data-testid={DISPATCH_SCREEN_TEST_ID}>
      <MapPanel selection={selection} onSelect={select} overlay={<BeliefOverlayPanel />} />
      <ActionPanel
        options={actionOptionsOf(balance, resources)}
        armed={armed}
        onArm={arm}
        target={target}
        draft={draft}
      />
      <TurnQueuePanel draft={draft} onCommitted={disarm} />
      <DispatchErrorsPanel />
      <MetersPanel />
      <ReportFeedPanel />
    </section>
  );
};
