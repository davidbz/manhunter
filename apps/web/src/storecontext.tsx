/**
 * How a component reaches the store the composition root wired (PLAN M5.2, M0.4's note).
 *
 * The store is created once in `main.tsx` and handed down, never constructed by a component and
 * never a module-level singleton: a singleton would be a second composition root, and it would
 * make the wiring impossible to vary under test.
 */

import { createContext, type ReactNode, useContext } from "react";
import { useStore } from "zustand";
import type { GameStore, GameStoreState } from "./gamestore";

const MISSING_PROVIDER = "useGameStore was called outside a GameStoreProvider";

const GameStoreContext = createContext<GameStore | null>(null);

export const GameStoreProvider = ({
  store,
  children,
}: {
  readonly store: GameStore;
  readonly children: ReactNode;
}) => <GameStoreContext value={store}>{children}</GameStoreContext>;

/**
 * The store itself, for the one thing a selector cannot do: read the state a dispatch has just
 * written, inside the handler that dispatched it (PLAN M5.5b). Ending a turn has to know whether
 * the turn happened before it decides what to do with the queue, and a selector's value is the
 * one from the render that is already over.
 *
 * It exposes no more than `useGameStore` does - `GameStoreState` names no member of the world
 * (architecture rule 4, and `gamestore.test.ts` asserts it) - and it subscribes to nothing, so a
 * component that only dispatches does not re-render on every write.
 */
export const useGameStoreApi = (): GameStore => {
  const store = useContext(GameStoreContext);
  if (!store) throw new Error(MISSING_PROVIDER);

  return store;
};

export const useGameStore = <T,>(selector: (state: GameStoreState) => T): T =>
  useStore(useGameStoreApi(), selector);
