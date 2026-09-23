/**
 * How a component reaches the clipboard the composition root wired (PLAN M6.9), the
 * `storecontext.tsx` shape. `main.tsx` builds one `ClipboardLogic` over `navigator.clipboard` and
 * hands it down; nothing below it touches the browser's clipboard directly, so every copy goes
 * through the bound in `clipboard.ts` and tests hand in a fake.
 */

import { createContext, type ReactNode, useContext } from "react";
import type { ClipboardLogic } from "./clipboard";

const MISSING_PROVIDER = "useClipboard was called outside a ClipboardProvider";

const ClipboardContext = createContext<ClipboardLogic | null>(null);

export const ClipboardProvider = ({
  clipboard,
  children,
}: {
  readonly clipboard: ClipboardLogic;
  readonly children: ReactNode;
}) => <ClipboardContext value={clipboard}>{children}</ClipboardContext>;

export const useClipboard = (): ClipboardLogic => {
  const clipboard = useContext(ClipboardContext);
  if (!clipboard) throw new Error(MISSING_PROVIDER);

  return clipboard;
};
