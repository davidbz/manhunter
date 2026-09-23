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
 * The map dims what the armed action cannot target (`selectableOf`, PLAN M6.5), but that is
 * presentation only; `select` stays the one place a click is accepted or dropped.
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
 *
 * **`ShareLinkPanel` (PLAN M5.6b-2) renders alongside them**, and `ShareLinkErrorPanel` renders
 * beside `NewHuntForm` instead - a shared link that failed to load leaves `state.hunt` `null`,
 * which is exactly the branch that already shows the form and `DispatchErrorsPanel`.
 *
 * **Where each panel sits is decided here; how the regions are laid out is `appframe.tsx`'s**
 * (PLAN M6.2). The map takes the dominant column, the meters sit above the feed in the intel
 * column, and the action board, the queue with End Turn, and any dispatch problem share the
 * command bar - the problems beside the queue whose turn they are about. The map's legend
 * (PLAN M6.6) sits under the map in the same region.
 *
 * **The focused node is a third piece of state (PLAN M7.2)**, beside `armed` and `selection`, and
 * unlike them it is presentation only: it never narrows a click and never feeds `draft`. A feed
 * row, a map node or a report pin puts its node there while pointed at or focused, and clears it
 * on leaving. The feed marks the rows at that node, and `MapFocusBeaconPanel`, in the overlay
 * slot after the heat so the ring is drawn over it, rings the node on the map.
 *
 * **PLAN M6.9 gathered the two non-board halves into screens of their own**: `BriefingScreen`
 * (the new-hunt form, `DispatchErrorsPanel` and `ShareLinkErrorPanel`, beside the case rules and
 * the redacted dossier) and `DebriefScreen` (`EndScreenPanel`, `ReplayScreen`, `ShareLinkPanel`
 * and the revealed dossier). Which panels render in which state is unchanged from the notes
 * above; each screen owns where its panels sit, and both carry the restart button.
 *
 * **PLAN M7.3 moved the queue up and replaced Add with sticky tools.** The plan - queue, armed
 * tool, last queue refusal - is one piece of state here, changed only through `dispatchplan.ts`,
 * because the board prices its tiles against what the plan leaves (`remainingAfter`), the map
 * draws its orders, and the queue lists them. With a tool armed a map click places the order
 * rather than selecting, so `selection` is now only what a click picks with nothing armed, and
 * `draft` is the armed tool pointed at the hovered target (`hoverTarget`, a fourth piece of
 * presentation state, separate from `focusedNodeId` as that one is from `selection`): it is what
 * the board's ready line names and what `MapPlannedOrdersPanel` previews as a ghost with its cost
 * tag. Escape, a right-click on the map, or End Turn disarm; keys 1 to 4 arm the tiles in board
 * order, through a document listener that ignores keys typed into a field or held with a modifier.
 * The planned-order layer is the map's `plan` slot, drawn above the nodes; the paragraphs above
 * about `TurnQueuePanel` owning the queue and disarming on `onCommitted` describe M5.5b's flow.
 *
 * **What the plan leaves is computed once here (PLAN M7.4)** and handed to everything that
 * forecasts it: the action board prices its tiles against it, the rail and the meters read
 * "now -> after", and the queue's head counts the action points it spends. It is passed as props
 * rather than put in the store because the plan it derives from is this board's state.
 */

import type { HunterActionKind, HunterView, NodeId } from "@manhunter/core";
import { useEffect, useState } from "react";
import { ActionPanel, actionKindOfKey, actionOptionsOf } from "./actionpanel";
import { remainingAfter } from "./actionqueue";
import { AppFrame, ScreenFrame } from "./appframe";
import { BeliefLegend } from "./belieflegend";
import { BeliefOverlayPanel } from "./beliefoverlaypanel";
import { BriefingScreen } from "./briefingscreen";
import { DebriefScreen } from "./debriefscreen";
import { DispatchErrorsPanel } from "./dispatcherrorspanel";
import {
  armTool,
  clickTarget,
  type DispatchPlan,
  disarmTool,
  draftOf,
  EMPTY_PLAN,
  removeOrder,
} from "./dispatchplan";
import { HeaderRailPanel } from "./headerrailpanel";
import { HeatmapSummaryPanel } from "./heatmapsummarypanel";
import { MapFocusBeaconPanel } from "./mapfocusbeaconpanel";
import { huntPlaceNamesOf } from "./mapnodes";
import { MapPanel } from "./mappanel";
import { MapPlannedOrdersPanel } from "./mapplannedorderspanel";
import type { MapSelection } from "./maprenderer";
import { closedEdgeIdsOf, selectableOf } from "./mapselectable";
import { MetersPanel } from "./meterspanel";
import { NO_PLACE_NAMES } from "./placenames";
import { ReportFeedPanel } from "./reportfeedpanel";
import { useGameStore, useGameStoreApi } from "./storecontext";
import { actionPointPlanOf } from "./turnqueue";
import { TurnQueuePanel } from "./turnqueuepanel";

export const DISPATCH_SCREEN_TEST_ID = "dispatch-screen";

const DISPATCH_LABEL = "Dispatch";

/** The key that puts the armed tool down. */
const DISARM_KEY = "Escape";

/** Elements a key typed into belongs to, so a digit in a field never arms a tool. */
const TYPING_TAGS: readonly string[] = ["INPUT", "TEXTAREA", "SELECT"];

const isTypingInto = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || TYPING_TAGS.includes(target.tagName));

const isBoardKey = (event: KeyboardEvent): boolean =>
  !(event.ctrlKey || event.metaKey || event.altKey || isTypingInto(event.target));

type DispatchBoardProps = {
  readonly view: HunterView;
};

/**
 * The board half, mounted only while a hunt is in progress, so the plan and the looking state die
 * with the hunt the way `TurnQueuePanel`'s queue did: a hunt that ends, or a new one, starts from
 * an empty plan with nothing armed.
 */
const DispatchBoard = ({ view }: DispatchBoardProps) => {
  const store = useGameStoreApi();
  const balance = useGameStore((state) => state.balance);
  const placeNames = useGameStore(huntPlaceNamesOf) ?? NO_PLACE_NAMES;
  const [plan, setPlan] = useState<DispatchPlan>(EMPTY_PLAN);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<NodeId | null>(null);
  const [hoverTarget, setHoverTarget] = useState<MapSelection | null>(null);
  const account = { resources: view.hunter, balance };

  const arm = (kind: HunterActionKind): void => {
    setSelection(null);
    setPlan(armTool(plan, kind, account));
  };

  const disarm = (): void => {
    setPlan(disarmTool(plan));
    setSelection(null);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (!isBoardKey(event)) return;
    if (event.key === DISARM_KEY) {
      disarm();
      return;
    }
    const kind = actionKindOfKey(event.key);
    if (kind === null) return;

    event.preventDefault();
    arm(kind);
  };

  useEffect(() => {
    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  });

  const closed = closedEdgeIdsOf(view.hunter.containments, view.clock.turn, plan.queue);
  const selectable = plan.armed === null ? null : selectableOf(plan.armed, balance.edges, closed);
  const context = { account, selectable, edges: view.map.edges };
  const { target, draft } = draftOf(plan.armed, hoverTarget, context);
  const remaining = remainingAfter(view.hunter, plan.queue, balance);

  const select = (next: MapSelection): void => {
    if (plan.armed === null) {
      setSelection(next);
      return;
    }

    setPlan(clickTarget(plan, next, context));
  };

  const remove = (index: number): void => setPlan(removeOrder(plan, index));

  const endTurn = (): void => {
    store.getState().endTurn(plan.queue);
    if (store.getState().refusal !== null) return;

    setPlan(EMPTY_PLAN);
    setSelection(null);
    setHoverTarget(null);
  };

  return (
    <AppFrame
      label={DISPATCH_LABEL}
      testId={DISPATCH_SCREEN_TEST_ID}
      rail={<HeaderRailPanel remaining={remaining} />}
      map={
        <>
          <HeatmapSummaryPanel />
          <MapPanel
            selection={selection}
            onSelect={select}
            overlay={
              <>
                <BeliefOverlayPanel />
                <MapFocusBeaconPanel nodeId={focusedNodeId} />
              </>
            }
            selectableKind={selectable}
            onFocusNode={setFocusedNodeId}
            onHoverTarget={setHoverTarget}
            onCancel={plan.armed === null ? undefined : disarm}
            plan={<MapPlannedOrdersPanel queue={plan.queue} draft={draft} onRemove={remove} />}
          />
          <BeliefLegend />
        </>
      }
      intel={
        <>
          <MetersPanel remaining={remaining} />
          <ReportFeedPanel focus={{ nodeId: focusedNodeId, onFocus: setFocusedNodeId }} />
        </>
      }
      command={
        <>
          <ActionPanel
            options={actionOptionsOf(balance, remaining)}
            armed={plan.armed}
            onArm={arm}
            target={target}
            draft={draft}
            placeNames={placeNames}
          />
          <TurnQueuePanel
            queue={plan.queue}
            refusal={plan.refusal}
            onRemove={remove}
            onEndTurn={endTurn}
            actionPoints={actionPointPlanOf(view.hunter, remaining)}
          />
          <DispatchErrorsPanel />
        </>
      }
    />
  );
};

export const DispatchScreen = () => {
  const view = useGameStore((state) => state.hunt?.view ?? null);

  if (view === null)
    return (
      <ScreenFrame>
        <BriefingScreen />
      </ScreenFrame>
    );

  if (view.outcome.kind !== "in_progress")
    return (
      <ScreenFrame>
        <DebriefScreen />
      </ScreenFrame>
    );

  return <DispatchBoard view={view} />;
};
