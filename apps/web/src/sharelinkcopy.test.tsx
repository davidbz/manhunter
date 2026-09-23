import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { type ClipboardLogic, type ClipboardResult, createClipboardLogic } from "./clipboard";
import { ClipboardProvider } from "./clipboardcontext";
import { LIMITS } from "./limits";
import {
  copyStatusMessage,
  SHARE_LINK_COPY_STATUS_TEST_ID,
  SHARE_LINK_COPY_TEST_ID,
  ShareLinkCopy,
} from "./sharelinkcopy";

/**
 * PLAN M6.9's copy button: a click hands the link to the injected clipboard, and every result,
 * failures included, becomes a status line rather than an exception.
 */

const LINK = "https://example.test/?replay=1.1.8.6.3.24.standard";

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (clipboard: ClipboardLogic, text: string): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      <ClipboardProvider clipboard={clipboard}>
        <ShareLinkCopy text={text} />
      </ClipboardProvider>,
    );
  });
};

const find = (testId: string): HTMLElement | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

const click = async (): Promise<void> => {
  const button = find(SHARE_LINK_COPY_TEST_ID);
  if (!(button instanceof HTMLButtonElement)) throw new Error("expected the copy button");
  await act(async () => {
    button.click();
  });
};

const resolving = (result: ClipboardResult): ClipboardLogic => ({
  copy: async () => result,
});

afterEach(async () => {
  const mounted = root;
  if (mounted) {
    await act(async () => mounted.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

describe("ShareLinkCopy", () => {
  it("shows no status until the player copies", async () => {
    await render(resolving({ kind: "copied", length: LINK.length }), LINK);

    expect(find(SHARE_LINK_COPY_TEST_ID)).not.toBeNull();
    expect(find(SHARE_LINK_COPY_STATUS_TEST_ID)).toBeNull();
  });

  it("writes the link through the injected clipboard and says so", async () => {
    const written: string[] = [];
    const clipboard = createClipboardLogic({
      writer: {
        writeText: async (text) => {
          written.push(text);
        },
      },
      wait: () => new Promise<void>(() => undefined),
    });
    await render(clipboard, LINK);

    await click();

    expect(written).toEqual([LINK]);
    expect(find(SHARE_LINK_COPY_STATUS_TEST_ID)?.getAttribute("data-result")).toBe("copied");
  });

  it("reports a missing clipboard as a status, not a crash", async () => {
    await render(createClipboardLogic({ writer: null, wait: async () => undefined }), LINK);

    await click();

    const status = find(SHARE_LINK_COPY_STATUS_TEST_ID);
    expect(status?.getAttribute("data-result")).toBe("unavailable");
    expect(status?.textContent).toContain("by hand");
  });

  it("reports a link over the clipboard bound as too long", async () => {
    const overLimit = "x".repeat(LIMITS.maxClipboardTextLength + 1);
    await render(createClipboardLogic({ writer: null, wait: async () => undefined }), overLimit);

    await click();

    expect(find(SHARE_LINK_COPY_STATUS_TEST_ID)?.getAttribute("data-result")).toBe("too_long");
  });

  it("disables the button while a copy is pending", async () => {
    const pending: ClipboardLogic = { copy: () => new Promise<ClipboardResult>(() => undefined) };
    await render(pending, LINK);

    await click();

    const button = find(SHARE_LINK_COPY_TEST_ID);
    expect(button instanceof HTMLButtonElement && button.disabled).toBe(true);
    expect(find(SHARE_LINK_COPY_STATUS_TEST_ID)?.getAttribute("data-result")).toBe("copying");
  });
});

describe("copyStatusMessage", () => {
  it("words every failure so the player knows to copy by hand", () => {
    const failures: ClipboardResult[] = [
      { kind: "too_long", length: 20000, maxLength: 16384 },
      { kind: "unavailable" },
      { kind: "rejected" },
      { kind: "timed_out", afterMilliseconds: 3000 },
    ];

    for (const failure of failures) {
      expect(copyStatusMessage(failure)).not.toBe("");
    }
    expect(copyStatusMessage({ kind: "too_long", length: 20000, maxLength: 16384 })).toContain(
      "16384",
    );
    expect(copyStatusMessage({ kind: "timed_out", afterMilliseconds: 3000 })).toContain("3000");
    expect(copyStatusMessage({ kind: "rejected" })).toContain("by hand");
  });

  it("confirms a copy", () => {
    expect(copyStatusMessage({ kind: "copied", length: LINK.length })).toBe("Link copied.");
  });
});
