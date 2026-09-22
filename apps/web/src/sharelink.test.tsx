import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ShareLinkLoadRefusal } from "./gamestore";
import {
  SHARE_LINK_ENCODE_ERROR_TEST_ID,
  SHARE_LINK_LOAD_ERROR_TEST_ID,
  SHARE_LINK_TEST_ID,
  SHARE_LINK_URL_TEST_ID,
  ShareLink,
  ShareLinkLoadError,
  shareLinkErrorMessage,
  shareLinkLoadRefusalMessage,
} from "./sharelink";
import type { ShareLinkEncoding } from "./sharelinkurl";

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SHARE_LINK_URL = "https://example.test/?replay=1.7.8.6.3.24.s";

/** One of every variant, written out so a new `core` refusal fails this file to compile. */
const EVERY_ENCODE_ERROR: readonly Exclude<ShareLinkEncoding, { readonly kind: "share_link" }>[] = [
  { kind: "not_encodable", field: "action" },
  { kind: "too_long", length: 9000, maxLength: 8192 },
  { kind: "unsupported_version", version: 1, supported: 4 },
  { kind: "deadline_too_long", requestedTurns: 500, maxTurns: 240 },
  { kind: "too_many_turns", recordedTurns: 300, maxTurns: 24 },
  { kind: "too_many_actions", turn: 3, requestedActions: 40, maxActions: 32 },
];

const EVERY_LOAD_REFUSAL: readonly ShareLinkLoadRefusal[] = [
  { kind: "share_link_too_long", length: 9000, maxLength: 8192 },
  { kind: "malformed", field: "structure" },
  { kind: "too_long", length: 9000, maxLength: 8192 },
  { kind: "unsupported_version", version: 1, supported: 4 },
  { kind: "deadline_too_long", requestedTurns: 500, maxTurns: 240 },
  { kind: "too_many_turns", recordedTurns: 300, maxTurns: 24 },
  { kind: "too_many_actions", turn: 3, requestedActions: 40, maxActions: 32 },
  {
    kind: "not_started",
    failure: { kind: "deadline_too_long", requestedTurns: 500, maxTurns: 240 },
  },
  {
    kind: "turn_refused",
    turn: 5,
    failure: { kind: "too_many_actions", requestedActions: 40, maxActions: 32 },
  },
];

describe("shareLinkErrorMessage", () => {
  it("has a sentence for every way a hunt can fail to become a link", () => {
    for (const encoding of EVERY_ENCODE_ERROR) {
      expect(shareLinkErrorMessage(encoding), encoding.kind).not.toBe("");
    }
  });

  it("gives every kind its own words", () => {
    const messages = EVERY_ENCODE_ERROR.map(shareLinkErrorMessage);

    expect(new Set(messages).size).toBe(EVERY_ENCODE_ERROR.length);
  });
});

describe("shareLinkLoadRefusalMessage", () => {
  it("has a sentence for every way a shared link can fail to load", () => {
    for (const refusal of EVERY_LOAD_REFUSAL) {
      expect(shareLinkLoadRefusalMessage(refusal), refusal.kind).not.toBe("");
    }
  });

  it("gives every kind its own words", () => {
    const messages = EVERY_LOAD_REFUSAL.map(shareLinkLoadRefusalMessage);

    expect(new Set(messages).size).toBe(EVERY_LOAD_REFUSAL.length);
  });
});

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (element: ReactElement): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(element));
};

const find = (testId: string): HTMLElement | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("ShareLink", () => {
  it("draws the link when a hunt encoded cleanly", async () => {
    await render(<ShareLink encoding={{ kind: "share_link", url: SHARE_LINK_URL }} />);

    expect(find(SHARE_LINK_TEST_ID)).not.toBeNull();
    const link = find(SHARE_LINK_URL_TEST_ID);
    expect(link?.getAttribute("href")).toBe(SHARE_LINK_URL);
    expect(link?.textContent).toBe(SHARE_LINK_URL);
    expect(find(SHARE_LINK_ENCODE_ERROR_TEST_ID)).toBeNull();
  });

  it("draws the error, not a link, when the hunt could not be encoded", async () => {
    const encoding: ShareLinkEncoding = { kind: "too_long", length: 9000, maxLength: 8192 };
    await render(<ShareLink encoding={encoding} />);

    const error = find(SHARE_LINK_ENCODE_ERROR_TEST_ID);
    expect(error?.getAttribute("data-kind")).toBe("too_long");
    expect(error?.textContent).toBe(shareLinkErrorMessage(encoding));
    expect(find(SHARE_LINK_URL_TEST_ID)).toBeNull();
  });
});

describe("ShareLinkLoadError", () => {
  it("draws nothing when nothing refused the link", async () => {
    await render(<ShareLinkLoadError refusal={null} />);

    expect(find(SHARE_LINK_LOAD_ERROR_TEST_ID)).toBeNull();
  });

  it("draws the refusal when the shared link could not be loaded", async () => {
    const refusal: ShareLinkLoadRefusal = { kind: "malformed", field: "seed" };
    await render(<ShareLinkLoadError refusal={refusal} />);

    const error = find(SHARE_LINK_LOAD_ERROR_TEST_ID);
    expect(error?.querySelector('[role="alert"]')?.getAttribute("data-refusal")).toBe("malformed");
    expect(error?.textContent).toBe(shareLinkLoadRefusalMessage(refusal));
  });
});
