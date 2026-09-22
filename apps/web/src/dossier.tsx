/**
 * The criminal's dossier card (PLAN M6.7): a portrait and one status line.
 *
 * **This is where the reveal switches, and it switches on `RevealFrame`s existing.** The store
 * only builds frames once a hunt has settled (`gamestore.ts`'s `framesFor`), so `frames === null`
 * is exactly "the hunt is still running", and a frame list is the moment `RevealFrame` has already
 * told the player where the criminal was all along. Before it, the card draws `REDACTED_AVATAR`,
 * which no seed reaches: the profile is derived from the seed (DESIGN.md "Visual direction"), and
 * a face derived from it would leak through the channel `HunterView` closes.
 *
 * The redacted variant of `DossierSubject` carries no seed on purpose, so the card cannot draw
 * anything seed-dependent before the reveal even by mistake - the seed stops at
 * `dossierSubjectOf`.
 */

import type { RevealFrame } from "@manhunter/core";
import { type Avatar, avatarOf, REDACTED_AVATAR } from "./avatar";
import { AvatarPortrait, type AvatarTheme, DEFAULT_AVATAR_THEME } from "./avatarportrait";

export type DossierSubject =
  | { readonly kind: "redacted" }
  | { readonly kind: "revealed"; readonly avatar: Avatar };

export type CriminalDossierProps = {
  readonly subject: DossierSubject;
  readonly theme?: AvatarTheme;
};

export const CRIMINAL_DOSSIER_TEST_ID = "criminal-dossier";
export const CRIMINAL_DOSSIER_STATUS_TEST_ID = "criminal-dossier-status";

const DOSSIER_LABEL = "Criminal dossier";
const DOSSIER_HEADING = "Subject";

type DossierCopy = {
  readonly portraitLabel: string;
  readonly status: string;
};

const DOSSIER_COPY: Readonly<Record<DossierSubject["kind"], DossierCopy>> = {
  redacted: {
    portraitLabel: "Unidentified suspect, redacted",
    status: "Identity unknown. Redacted until the hunt ends.",
  },
  revealed: {
    portraitLabel: "Suspect portrait",
    status: "Identity confirmed.",
  },
};

const REDACTED_SUBJECT: DossierSubject = { kind: "redacted" };

export const dossierSubjectOf = (
  seed: number,
  frames: readonly RevealFrame[] | null,
): DossierSubject =>
  frames === null ? REDACTED_SUBJECT : { kind: "revealed", avatar: avatarOf(seed, "criminal") };

const avatarOfSubject = (subject: DossierSubject): Avatar =>
  subject.kind === "revealed" ? subject.avatar : REDACTED_AVATAR;

export const CriminalDossier = ({
  subject,
  theme = DEFAULT_AVATAR_THEME,
}: CriminalDossierProps) => {
  const copy = DOSSIER_COPY[subject.kind];

  return (
    <section
      aria-label={DOSSIER_LABEL}
      data-testid={CRIMINAL_DOSSIER_TEST_ID}
      data-subject={subject.kind}
    >
      <h3>{DOSSIER_HEADING}</h3>
      <AvatarPortrait
        avatar={avatarOfSubject(subject)}
        label={copy.portraitLabel}
        size={theme.portraitSize}
        theme={theme}
      />
      <p data-testid={CRIMINAL_DOSSIER_STATUS_TEST_ID}>{copy.status}</p>
    </section>
  );
};
