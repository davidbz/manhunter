/**
 * The share link, connected (PLAN M5.6b-2). The same split `mappanel.tsx` makes, doubled: one
 * connected component per widget `sharelink.tsx` draws, since each reads a different slice of the
 * store and neither is ever mounted where the other is (`ShareLinkPanel` only once a hunt exists,
 * `ShareLinkErrorPanel` only while one does not).
 *
 * `window.location.href` is read here rather than threaded down as a prop: it is a browser
 * boundary a connected component is allowed to touch directly, the same call `main.tsx` makes for
 * `document.getElementById`, and `shareLinkFor`/`decodeShareLink` are exactly what stays
 * injectable and unit-tested (`sharelink.test.ts`) by taking that URL as a plain string instead.
 */

import { makeReplay } from "@manhunter/core";
import { ShareLink, ShareLinkLoadError } from "./sharelink";
import { shareLinkFor } from "./sharelinkurl";
import { useGameStore } from "./storecontext";

export const ShareLinkPanel = () => {
  const hunt = useGameStore((state) => state.hunt);
  if (hunt === null) return null;

  const replay = makeReplay({
    seed: hunt.seed,
    setup: hunt.setup,
    actions: hunt.recordedActions,
  });
  const encoding = shareLinkFor(replay, window.location.href);

  return <ShareLink encoding={encoding} />;
};

export const ShareLinkErrorPanel = () => {
  const refusal = useGameStore((state) => state.shareLinkRefusal);

  return <ShareLinkLoadError refusal={refusal} />;
};
