/**
 * The clipboard boundary (PLAN M6.9): the debrief copies its share link, and that write leaves the
 * page. AGENTS.md section 5 applies, so the text is bounded before the write is attempted and the
 * write is bounded in time, and section 2 applies, so the browser's clipboard and its timer are
 * capabilities this module is handed rather than globals it reaches for. `main.tsx` wires
 * `navigator.clipboard` and `setTimeout`; tests wire fakes.
 *
 * **Every way a copy can go wrong is a result, never a throw.** The Clipboard API is missing
 * outside a secure context, rejects without a user gesture or a permission, and can stay pending
 * behind a prompt. None of those is a bug in the game, so each is a `ClipboardResult` the button
 * can put into words, and the link stays on screen to copy by hand.
 */

import { LIMITS } from "./limits";

/** The one member of the browser's `Clipboard` this needs. `navigator.clipboard` satisfies it. */
export type ClipboardWriter = {
  readonly writeText: (text: string) => Promise<void>;
};

/** Resolves once `milliseconds` have passed. `main.tsx` builds it from `setTimeout`. */
export type Wait = (milliseconds: number) => Promise<void>;

export type ClipboardDeps = {
  /** `null` where the page has no Clipboard API at all (an insecure context, an old browser). */
  readonly writer: ClipboardWriter | null;
  readonly wait: Wait;
};

export type ClipboardResult =
  | { readonly kind: "copied"; readonly length: number }
  | { readonly kind: "too_long"; readonly length: number; readonly maxLength: number }
  | { readonly kind: "unavailable" }
  | { readonly kind: "rejected" }
  | { readonly kind: "timed_out"; readonly afterMilliseconds: number };

export type ClipboardLogic = {
  readonly copy: (text: string) => Promise<ClipboardResult>;
};

const UNAVAILABLE: ClipboardResult = { kind: "unavailable" };
const REJECTED: ClipboardResult = { kind: "rejected" };

/** A writer that throws rather than rejecting is still a refusal, not a crash. */
const written = (writer: ClipboardWriter, text: string): Promise<ClipboardResult> => {
  try {
    return writer.writeText(text).then(
      (): ClipboardResult => ({ kind: "copied", length: text.length }),
      () => REJECTED,
    );
  } catch {
    return Promise.resolve(REJECTED);
  }
};

export const createClipboardLogic = (deps: ClipboardDeps): ClipboardLogic => ({
  copy: async (text) => {
    if (text.length > LIMITS.maxClipboardTextLength) {
      return { kind: "too_long", length: text.length, maxLength: LIMITS.maxClipboardTextLength };
    }
    if (deps.writer === null) return UNAVAILABLE;

    const afterMilliseconds = LIMITS.maxClipboardWriteMilliseconds;
    const timedOut = deps
      .wait(afterMilliseconds)
      .then((): ClipboardResult => ({ kind: "timed_out", afterMilliseconds }));
    return Promise.race([written(deps.writer, text), timedOut]);
  },
});
