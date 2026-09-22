/**
 * The criminal's path, connected (PLAN M5.6b). The same split `beliefoverlaypanel.tsx` makes:
 * `CriminalPath` stays a pure function of props, and this is the one half that knows a store
 * exists. `turn` is not read from the store - it is UI state the replay screen owns because the
 * scrubber control needs it too (`maprenderer.tsx`'s selection precedent), so it arrives as a
 * prop the way `MapPanel`'s `selection` does.
 */

import type { Turn } from "@manhunter/core";
import { CriminalPath } from "./criminalpath";
import { useGameStore } from "./storecontext";

export type CriminalPathPanelProps = {
  readonly turn: Turn;
};

export const CriminalPathPanel = ({ turn }: CriminalPathPanelProps) => {
  const frames = useGameStore((state) => state.hunt?.frames ?? null);
  const nodes = useGameStore((state) => state.hunt?.view.map.nodes ?? null);
  if (!frames || !nodes) return null;

  return <CriminalPath frames={frames} nodes={nodes} turn={turn} />;
};
