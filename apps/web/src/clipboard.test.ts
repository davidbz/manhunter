import { describe, expect, it } from "vitest";
import { type ClipboardWriter, createClipboardLogic, type Wait } from "./clipboard";
import { LIMITS } from "./limits";

/**
 * PLAN M6.9's AC for the clipboard: the write is bounded and failure-tolerant. Every capability
 * is a fake handed to the factory, the way `main.tsx` hands it the real ones.
 */

const LINK = "https://example.test/?replay=1.1.8.6.3.24.standard";

type RecordingWriter = ClipboardWriter & { readonly written: string[] };

const recordingWriter = (): RecordingWriter => {
  const written: string[] = [];
  return {
    written,
    writeText: async (text) => {
      written.push(text);
    },
  };
};

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

const neverElapses: Wait = () => never();

describe("copying text to the clipboard", () => {
  it("writes the text and says how much it wrote", async () => {
    const writer = recordingWriter();
    const clipboard = createClipboardLogic({ writer, wait: neverElapses });

    expect(await clipboard.copy(LINK)).toEqual({ kind: "copied", length: LINK.length });
    expect(writer.written).toEqual([LINK]);
  });

  it("writes text of exactly the maximum length", async () => {
    const writer = recordingWriter();
    const clipboard = createClipboardLogic({ writer, wait: neverElapses });
    const atLimit = "x".repeat(LIMITS.maxClipboardTextLength);

    expect((await clipboard.copy(atLimit)).kind).toBe("copied");
  });

  it("refuses text one character over the limit before it touches the clipboard", async () => {
    const writer = recordingWriter();
    const clipboard = createClipboardLogic({ writer, wait: neverElapses });
    const overLimit = "x".repeat(LIMITS.maxClipboardTextLength + 1);

    expect(await clipboard.copy(overLimit)).toEqual({
      kind: "too_long",
      length: overLimit.length,
      maxLength: LIMITS.maxClipboardTextLength,
    });
    expect(writer.written).toEqual([]);
  });

  it("reports a page with no Clipboard API as unavailable rather than throwing", async () => {
    const clipboard = createClipboardLogic({ writer: null, wait: neverElapses });

    expect(await clipboard.copy(LINK)).toEqual({ kind: "unavailable" });
  });

  it("reports a write the browser rejects as rejected", async () => {
    const writer: ClipboardWriter = { writeText: () => Promise.reject(new Error("denied")) };
    const clipboard = createClipboardLogic({ writer, wait: neverElapses });

    expect(await clipboard.copy(LINK)).toEqual({ kind: "rejected" });
  });

  it("reports a writer that throws outright as rejected too", async () => {
    const writer: ClipboardWriter = {
      writeText: () => {
        throw new TypeError("Illegal invocation");
      },
    };
    const clipboard = createClipboardLogic({ writer, wait: neverElapses });

    expect(await clipboard.copy(LINK)).toEqual({ kind: "rejected" });
  });

  it("gives up on a write still pending after the time limit", async () => {
    const waited: number[] = [];
    const wait: Wait = async (milliseconds) => {
      waited.push(milliseconds);
    };
    const writer: ClipboardWriter = { writeText: () => never() };
    const clipboard = createClipboardLogic({ writer, wait });

    expect(await clipboard.copy(LINK)).toEqual({
      kind: "timed_out",
      afterMilliseconds: LIMITS.maxClipboardWriteMilliseconds,
    });
    expect(waited).toEqual([LIMITS.maxClipboardWriteMilliseconds]);
  });
});
