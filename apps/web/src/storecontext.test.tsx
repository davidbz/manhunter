import type { GameLogic, GameSetup, SealedWorld, TurnLogic } from "@manhunter/core";
import {
  BALANCE,
  createActionLogic,
  createBeliefLogic,
  createCriminalAiLogic,
  createDistrictLogic,
  createEventLogic,
  createGameLogic,
  createGenerationLogic,
  createGraphLogic,
  createIntelLogic,
  createMinCutLogic,
  createRiverLogic,
  createRng,
  createTopologyLogic,
  createTurnLogic,
  createValidatorLogic,
} from "@manhunter/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createGameStore, type GameStore } from "./gamestore";
import { GameStoreProvider, useGameStore } from "./storecontext";

/**
 * The store driven the way a component drives it: through `react-dom/client` under the jsdom
 * environment PLAN M5.2 installs, asserted with DOM queries. No component-testing library is
 * needed for this - nothing here needs user-event semantics - and Playwright still owns the two
 * end-to-end flows.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const rng = createRng();
const graph = createGraphLogic();

const game: GameLogic = createGameLogic({
  rng,
  generation: createGenerationLogic({
    rng,
    topology: createTopologyLogic({ rng, graph }),
    river: createRiverLogic({ rng, graph }),
    districts: createDistrictLogic({ rng, graph }),
    validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
  }),
});

const turn: TurnLogic = createTurnLogic({
  intel: createIntelLogic({ rng, graph }),
  events: createEventLogic({ rng }),
  belief: createBeliefLogic({ graph }),
  action: createActionLogic({ rng }),
  ai: createCriminalAiLogic({ rng, graph }),
  graph,
});

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

const SEED = 1;

const TURN_TEST_ID = "turn";
const NODES_TEST_ID = "nodes";

/** A stand-in for PLAN M5.4's feed: it reads the view and nothing else off the store. */
const Dispatch = () => {
  const hunt = useGameStore((state) => state.hunt);
  if (!hunt) return <p data-testid={TURN_TEST_ID}>no hunt</p>;

  return (
    <section>
      <p data-testid={TURN_TEST_ID}>{hunt.view.clock.turn}</p>
      <p data-testid={NODES_TEST_ID}>{hunt.view.map.nodes.length}</p>
    </section>
  );
};

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (store: GameStore, children: ReactNode): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(<GameStoreProvider store={store}>{children}</GameStoreProvider>);
  });
};

const textOf = (testId: string): string =>
  container?.querySelector(`[data-testid="${testId}"]`)?.textContent ?? "";

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("a component reading the store", () => {
  it("renders nothing about a hunt that has not started", async () => {
    const store = createGameStore({ game, turn }, BALANCE);

    await render(store, <Dispatch />);

    expect(textOf(TURN_TEST_ID)).toBe("no hunt");
  });

  it("renders the view once a hunt is dispatched, and again when a turn is played", async () => {
    const store = createGameStore({ game, turn }, BALANCE);
    await render(store, <Dispatch />);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    expect(textOf(TURN_TEST_ID)).toBe("0");
    expect(Number(textOf(NODES_TEST_ID))).toBeGreaterThan(0);

    await act(async () => store.getState().endTurn([]));

    expect(textOf(TURN_TEST_ID)).toBe("1");
  });

  it("refuses to be read outside a provider, rather than reading a store of its own", () => {
    const Unwired = () => {
      const hunt = useGameStore((state) => state.hunt);
      return <p>{hunt ? "hunt" : "none"}</p>;
    };
    const orphan = createRoot(document.createElement("div"));

    expect(() => {
      act(() => {
        orphan.render(<Unwired />);
      });
    }).toThrow(/GameStoreProvider/);
  });
});

/**
 * Architecture rule 4, from the component's side: a selector can reach the sealed world the
 * store holds and can name no member of it. A readable member fails `bun run typecheck`.
 */
type AssertTrue<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type Selected = ReturnType<typeof useGameStore<SealedWorld | undefined>>;

export type SelectedWorldNamesNoMember = AssertTrue<
  IsNever<Extract<keyof NonNullable<Selected>, string>>
>;
