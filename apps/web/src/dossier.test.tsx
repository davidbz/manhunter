import { fc, test } from "@fast-check/vitest";
import type { RevealFrame } from "@manhunter/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { avatarOf, REDACTED_AVATAR } from "./avatar";
import { AVATAR_TEST_ID } from "./avatarportrait";
import {
  CRIMINAL_DOSSIER_STATUS_TEST_ID,
  CRIMINAL_DOSSIER_TEST_ID,
  CriminalDossier,
  dossierSubjectOf,
} from "./dossier";

/**
 * PLAN M6.7's hidden-information AC, asserted directly: before the reveal the dossier is identical
 * across seeds, both as data and as rendered markup. `dossierSubjectOf` only reads whether a frame
 * list exists, so an empty one stands in for "the hunt has settled" here; `dossierpanel.test.tsx`
 * proves the same thing against frames a real store built.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SETTLED: readonly RevealFrame[] = [];
const arbitrarySeed = fc.integer({ min: 0, max: 0xffff_ffff });

let root: Root | null = null;
let container: HTMLElement | null = null;

const markupOf = async (node: ReactNode): Promise<string> => {
  const host = document.createElement("div");
  document.body.append(host);
  const mounted = createRoot(host);
  container = host;
  root = mounted;
  await act(async () => mounted.render(node));

  return host.innerHTML;
};

const unmount = async (): Promise<void> => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
};

afterEach(unmount);

describe("dossierSubjectOf", () => {
  test.prop([arbitrarySeed, arbitrarySeed])(
    "is the same redacted subject for every seed while the hunt runs",
    (first, second) => {
      expect(dossierSubjectOf(first, null)).toEqual(dossierSubjectOf(second, null));
      expect(dossierSubjectOf(first, null)).toEqual({ kind: "redacted" });
    },
  );

  test.prop([arbitrarySeed])("reveals the seeded criminal once frames exist", (seed) => {
    expect(dossierSubjectOf(seed, SETTLED)).toEqual({
      kind: "revealed",
      avatar: avatarOf(seed, "criminal"),
    });
  });
});

describe("the criminal dossier", () => {
  it("renders byte-identical markup for two seeds before the reveal", async () => {
    const first = await markupOf(<CriminalDossier subject={dossierSubjectOf(1, null)} />);
    await unmount();
    const second = await markupOf(<CriminalDossier subject={dossierSubjectOf(2, null)} />);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it("draws the redacted silhouette and says so before the reveal", async () => {
    await markupOf(<CriminalDossier subject={dossierSubjectOf(1, null)} />);
    const dossier = container?.querySelector(`[data-testid="${CRIMINAL_DOSSIER_TEST_ID}"]`);
    const portrait = dossier?.querySelector(`[data-testid="${AVATAR_TEST_ID}"]`);

    expect(dossier?.getAttribute("data-subject")).toBe("redacted");
    expect(portrait?.getAttribute("data-subject")).toBe(REDACTED_AVATAR.subject);
    expect(
      container?.querySelector(`[data-testid="${CRIMINAL_DOSSIER_STATUS_TEST_ID}"]`)?.textContent,
    ).not.toBe("");
  });

  it("draws the seeded criminal after the reveal", async () => {
    await markupOf(<CriminalDossier subject={dossierSubjectOf(1, SETTLED)} />);
    const dossier = container?.querySelector(`[data-testid="${CRIMINAL_DOSSIER_TEST_ID}"]`);

    expect(dossier?.getAttribute("data-subject")).toBe("revealed");
    expect(
      dossier?.querySelector(`[data-testid="${AVATAR_TEST_ID}"]`)?.getAttribute("data-subject"),
    ).toBe("criminal");
  });

  it("renders different portraits for two seeds after the reveal", async () => {
    const first = await markupOf(<CriminalDossier subject={dossierSubjectOf(1, SETTLED)} />);
    await unmount();
    const second = await markupOf(<CriminalDossier subject={dossierSubjectOf(2, SETTLED)} />);

    expect(second).not.toBe(first);
  });
});
