/**
 * Copy-to-clipboard for the share link (PLAN M6.9, closing M5.6b-2's Inbox item). One button and
 * one status line. The write itself is `clipboard.ts`'s, reached through `useClipboard`, so the
 * bound and the failure handling live at the boundary and this only says what happened.
 *
 * Whatever the result, the link stays on screen as text (`sharelink.tsx`), so a copy the browser
 * would not make still leaves the player a way to share the hunt by hand.
 */

import { useState } from "react";
import type { ClipboardResult } from "./clipboard";
import { useClipboard } from "./clipboardcontext";

export type CopyStatus = { readonly kind: "idle" } | { readonly kind: "copying" } | ClipboardResult;

export const SHARE_LINK_COPY_TEST_ID = "share-link-copy";
export const SHARE_LINK_COPY_STATUS_TEST_ID = "share-link-copy-status";

const COPY_LABEL = "Copy link";
const COPYING_MESSAGE = "Copying...";
const COPIED_MESSAGE = "Link copied.";
const BY_HAND = " Copy the link above by hand.";
const TOO_LONG_PREFIX = "The link is too long to copy: ";
const AT_MOST = " characters, at most ";
const UNAVAILABLE_MESSAGE = `This browser offers no clipboard here.${BY_HAND}`;
const REJECTED_MESSAGE = `The browser refused the copy.${BY_HAND}`;
const TIMED_OUT_PREFIX = "The clipboard did not answer within ";
const TIMED_OUT_SUFFIX = ` ms.${BY_HAND}`;

const IDLE: CopyStatus = { kind: "idle" };
const COPYING: CopyStatus = { kind: "copying" };

export const copyStatusMessage = (status: Exclude<CopyStatus, { kind: "idle" }>): string => {
  switch (status.kind) {
    case "copying":
      return COPYING_MESSAGE;
    case "copied":
      return COPIED_MESSAGE;
    case "too_long":
      return `${TOO_LONG_PREFIX}${status.length}${AT_MOST}${status.maxLength}.`;
    case "unavailable":
      return UNAVAILABLE_MESSAGE;
    case "rejected":
      return REJECTED_MESSAGE;
    case "timed_out":
      return `${TIMED_OUT_PREFIX}${status.afterMilliseconds}${TIMED_OUT_SUFFIX}`;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

export type ShareLinkCopyProps = {
  readonly text: string;
};

export const ShareLinkCopy = ({ text }: ShareLinkCopyProps) => {
  const clipboard = useClipboard();
  const [status, setStatus] = useState<CopyStatus>(IDLE);

  const copy = async (): Promise<void> => {
    setStatus(COPYING);
    setStatus(await clipboard.copy(text));
  };

  return (
    <div className="mh-share__copy">
      <button
        type="button"
        className="mh-button"
        data-testid={SHARE_LINK_COPY_TEST_ID}
        disabled={status.kind === "copying"}
        onClick={copy}
      >
        {COPY_LABEL}
      </button>
      {status.kind === "idle" ? null : (
        <output
          className="mh-share__status"
          data-testid={SHARE_LINK_COPY_STATUS_TEST_ID}
          data-result={status.kind}
        >
          {copyStatusMessage(status)}
        </output>
      )}
    </div>
  );
};
