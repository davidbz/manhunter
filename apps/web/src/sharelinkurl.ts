/**
 * The URL boundary for a shared hunt (PLAN M5.6b-2): the query parameter a replay lives at, and
 * the two directions that cross it - reading one back out of the page's own URL on load, and
 * building one from a finished hunt to hand to someone else. Named apart from `sharelink.tsx`,
 * which draws the widgets: TypeScript module resolution cannot tell a `./sharelink.ts` from a
 * `./sharelink.tsx` apart, so the two files need different basenames despite the one concept.
 *
 * AGENTS.md section 5: the string is bounded before anything is parsed. `decodeReplay` already
 * checks its own `LIMITS.maxReplayStringLength` (PLAN M3.9), but that is a different boundary - a
 * malformed replay, however it arrived - so `decodeShareLink` checks the same bound again, first,
 * on the string as it came straight out of the URL, with its own refusal kind
 * (`share_link_too_long`, never `core`'s `too_long`). A hostile URL and a malformed replay are
 * refused for different reasons even though, after PLAN M5.6b-2 settled the `LIMITS` duplication,
 * the two bounds now read the same imported constant.
 */

import {
  decodeReplay,
  encodeReplay,
  type Replay,
  type ReplayDecoding,
  type ReplayEncoding,
} from "@manhunter/core";
import { LIMITS } from "./limits";

export const SHARE_LINK_PARAM = "replay";

/** `null` when the page was not opened from a share link at all. */
export const replayParamOf = (search: string): string | null =>
  new URLSearchParams(search).get(SHARE_LINK_PARAM);

export type ShareLinkRefusal =
  | { readonly kind: "share_link_too_long"; readonly length: number; readonly maxLength: number }
  | Exclude<ReplayDecoding, { readonly kind: "replay" }>;

export type ShareLinkDecoding =
  | { readonly kind: "replay"; readonly replay: Replay }
  | ShareLinkRefusal;

/**
 * The boundary itself. The length is checked on the raw string before `decodeReplay` ever runs,
 * the same order that module's own note keeps for the same reason: an over-long string is an
 * error result, never a truncation, and nothing downstream may allocate against it.
 */
export const decodeShareLink = (value: string): ShareLinkDecoding => {
  if (value.length > LIMITS.maxReplayStringLength) {
    return {
      kind: "share_link_too_long",
      length: value.length,
      maxLength: LIMITS.maxReplayStringLength,
    };
  }
  return decodeReplay(value);
};

export type ShareLinkEncoding =
  | { readonly kind: "share_link"; readonly url: string }
  | Exclude<ReplayEncoding, { readonly kind: "replay_string" }>;

/**
 * The link for a hunt, or why there is none. `href` is the page's own current URL, read by the
 * caller the way `main.tsx` reads `document.getElementById` - a browser boundary this function
 * takes as a plain string rather than reaching for `window` itself, so it stays testable on
 * fabricated strings with no DOM at all. Any existing query or hash is cleared before the replay
 * is written in, so a link built while viewing one shared hunt never carries another's.
 */
export const shareLinkFor = (replay: Replay, href: string): ShareLinkEncoding => {
  const encoded = encodeReplay(replay);
  if (encoded.kind !== "replay_string") return encoded;

  const url = new URL(href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(SHARE_LINK_PARAM, encoded.value);
  return { kind: "share_link", url: url.toString() };
};
