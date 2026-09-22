/**
 * The dossier, connected (PLAN M6.7). The same split `criminalpathpanel.tsx` makes: the card is a
 * pure function of a `DossierSubject`, and this is the half that knows a store exists.
 *
 * Two selectors returning values already on the store rather than one derived object, so neither
 * subscription allocates on every store write; `dossierSubjectOf` runs in render instead.
 */

import { CriminalDossier, dossierSubjectOf } from "./dossier";
import { useGameStore } from "./storecontext";

export const CriminalDossierPanel = () => {
  const seed = useGameStore((state) => state.hunt?.seed ?? null);
  const frames = useGameStore((state) => state.hunt?.frames ?? null);
  if (seed === null) return null;

  return <CriminalDossier subject={dossierSubjectOf(seed, frames)} />;
};
