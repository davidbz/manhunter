/**
 * The dispatch screen (PLAN M5.5a): the city, the heatmap over it, the meters, the feed, and the
 * board the player arms an action from. Before a hunt exists it is the new-hunt form instead,
 * because `state.hunt` is `null` and every panel renders nothing (PLAN M5.2's note).
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
 * `draft` is the seam PLAN M5.5b picks up: the queue it adds takes exactly that value, and
 * nothing here commits it. The error surfaces are M5.5b's too - `state.rejections` and
 * `state.refusal` are deliberately unread in this file.
 */

import type { HunterActionKind } from "@manhunter/core";
import { useState } from "react";
import { acceptsTarget, buildAction, targetOf } from "./actiondraft";
import { ActionPanel, actionOptionsOf } from "./actionpanel";
import { BeliefOverlayPanel } from "./beliefoverlaypanel";
import { MapPanel } from "./mappanel";
import type { MapSelection } from "./maprenderer";
import { MetersPanel } from "./meterspanel";
import { NewHuntForm } from "./newhuntform";
import { ReportFeedPanel } from "./reportfeedpanel";
import { useGameStore } from "./storecontext";

export const DISPATCH_SCREEN_TEST_ID = "dispatch-screen";

const DISPATCH_LABEL = "Dispatch";

export const DispatchScreen = () => {
  const balance = useGameStore((state) => state.balance);
  const resources = useGameStore((state) => state.hunt?.view.hunter ?? null);
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

  if (resources === null) return <NewHuntForm />;

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
      <MetersPanel />
      <ReportFeedPanel />
    </section>
  );
};
