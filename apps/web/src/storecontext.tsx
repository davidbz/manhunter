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

export const useGameStore = <T,>(selector: (state: GameStoreState) => T): T => {
  const store = useContext(GameStoreContext);
  if (!store) throw new Error(MISSING_PROVIDER);

  return useStore(store, selector);
};
