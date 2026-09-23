/**
 * The two ways a share link can go wrong, and the words for both (PLAN M5.6b-2), the
 * `dispatcherrors.tsx` shape: producing one from a finished hunt, and reading one back out of the
 * URL on load. They are drawn as separate widgets because a link that would not encode and a link
 * that would not decode happen to a different player at a different moment - the one sharing, and
 * the one who just opened it - the same reasoning that keeps `StoreRefusal` and
 * `PlanningRejection` apart in that file.
 *
 * Both unions grow from `core` (through `sharelinkurl.ts` and `gamestore.ts`), so both are
 * narrowed by an exhaustive `switch` with a `never` check, `dispatcherrors.tsx`'s own precedent.
 */

import type { ReactNode } from "react";
import type { ShareLinkLoadRefusal } from "./gamestore";
import type { ShareLinkEncoding } from "./sharelinkurl";

const AT_MOST = ", at most ";

const overBound = (subject: string, value: number, maximum: number): string =>
  `${subject}${value}${AT_MOST}${maximum}`;

const SHARE_LINK_TOO_LONG_PREFIX = "That link is too long: ";
const REPLAY_TOO_LONG_PREFIX = "That replay is too long: ";
const MALFORMED_PREFIX = "That replay could not be read (bad ";
const MALFORMED_SUFFIX = ").";
const NOT_ENCODABLE_PREFIX = "This hunt cannot be written into a link (bad ";
const NOT_ENCODABLE_SUFFIX = ").";
const UNSUPPORTED_VERSION_PREFIX = "That replay is from a different game version (";
const UNSUPPORTED_VERSION_SEPARATOR = ", this build reads version ";
const UNSUPPORTED_VERSION_SUFFIX = ").";
const DEADLINE_TOO_LONG_PREFIX = "That hunt's deadline is too long: ";
const TOO_MANY_TURNS_PREFIX = "That replay records more turns than it could have played: ";
const TOO_MANY_ACTIONS_PREFIX = "Turn ";
const TOO_MANY_ACTIONS_MIDDLE = " queues too many actions: ";
const NOT_STARTED_MESSAGE = "That shared hunt could not be started.";
const TURN_REFUSED_PREFIX = "That shared hunt's turn ";
const TURN_REFUSED_SUFFIX = " could not be replayed.";

export const shareLinkErrorMessage = (
  encoding: Exclude<ShareLinkEncoding, { readonly kind: "share_link" }>,
): string => {
  switch (encoding.kind) {
    case "not_encodable":
      return `${NOT_ENCODABLE_PREFIX}${encoding.field}${NOT_ENCODABLE_SUFFIX}`;
    case "too_long":
      return overBound(REPLAY_TOO_LONG_PREFIX, encoding.length, encoding.maxLength);
    case "unsupported_version":
      return (
        `${UNSUPPORTED_VERSION_PREFIX}${encoding.version}` +
        `${UNSUPPORTED_VERSION_SEPARATOR}${encoding.supported}${UNSUPPORTED_VERSION_SUFFIX}`
      );
    case "deadline_too_long":
      return overBound(DEADLINE_TOO_LONG_PREFIX, encoding.requestedTurns, encoding.maxTurns);
    case "too_many_turns":
      return overBound(TOO_MANY_TURNS_PREFIX, encoding.recordedTurns, encoding.maxTurns);
    case "too_many_actions":
      return overBound(
        `${TOO_MANY_ACTIONS_PREFIX}${encoding.turn}${TOO_MANY_ACTIONS_MIDDLE}`,
        encoding.requestedActions,
        encoding.maxActions,
      );
    default: {
      const exhaustive: never = encoding;
      return exhaustive;
    }
  }
};

export const shareLinkLoadRefusalMessage = (refusal: ShareLinkLoadRefusal): string => {
  switch (refusal.kind) {
    case "share_link_too_long":
      return overBound(SHARE_LINK_TOO_LONG_PREFIX, refusal.length, refusal.maxLength);
    case "malformed":
      return `${MALFORMED_PREFIX}${refusal.field}${MALFORMED_SUFFIX}`;
    case "too_long":
      return overBound(REPLAY_TOO_LONG_PREFIX, refusal.length, refusal.maxLength);
    case "unsupported_version":
      return (
        `${UNSUPPORTED_VERSION_PREFIX}${refusal.version}` +
        `${UNSUPPORTED_VERSION_SEPARATOR}${refusal.supported}${UNSUPPORTED_VERSION_SUFFIX}`
      );
    case "deadline_too_long":
      return overBound(DEADLINE_TOO_LONG_PREFIX, refusal.requestedTurns, refusal.maxTurns);
    case "too_many_turns":
      return overBound(TOO_MANY_TURNS_PREFIX, refusal.recordedTurns, refusal.maxTurns);
    case "too_many_actions":
      return overBound(
        `${TOO_MANY_ACTIONS_PREFIX}${refusal.turn}${TOO_MANY_ACTIONS_MIDDLE}`,
        refusal.requestedActions,
        refusal.maxActions,
      );
    case "not_started":
      return NOT_STARTED_MESSAGE;
    case "turn_refused":
      return `${TURN_REFUSED_PREFIX}${refusal.turn}${TURN_REFUSED_SUFFIX}`;
    default: {
      const exhaustive: never = refusal;
      return exhaustive;
    }
  }
};

export const SHARE_LINK_TEST_ID = "share-link";
export const SHARE_LINK_URL_TEST_ID = "share-link-url";
export const SHARE_LINK_ENCODE_ERROR_TEST_ID = "share-link-encode-error";
export const SHARE_LINK_LOAD_ERROR_TEST_ID = "share-link-load-error";

const SHARE_LINK_LABEL = "Share this hunt";
const SHARE_LINK_LOAD_ERROR_LABEL = "Shared link problem";
const SHARE_LINK_INTRO = "Copy this link to share the hunt: ";
const ALERT_ROLE = "alert";

export type ShareLinkProps = {
  readonly encoding: ShareLinkEncoding;
  /**
   * What copies the link (PLAN M6.9), drawn under it. A slot rather than a component this file
   * imports, so the presentational widget needs no clipboard to render and the connected panel
   * decides what copying means.
   */
  readonly copy?: ReactNode;
};

export const ShareLink = ({ encoding, copy }: ShareLinkProps) => (
  <section aria-label={SHARE_LINK_LABEL} data-testid={SHARE_LINK_TEST_ID} className="mh-share">
    {encoding.kind === "share_link" ? (
      <>
        <p className="mh-share__intro">
          {SHARE_LINK_INTRO}
          <a className="mh-share__url" data-testid={SHARE_LINK_URL_TEST_ID} href={encoding.url}>
            {encoding.url}
          </a>
        </p>
        {copy}
      </>
    ) : (
      <p
        role={ALERT_ROLE}
        className="mh-alert"
        data-testid={SHARE_LINK_ENCODE_ERROR_TEST_ID}
        data-kind={encoding.kind}
      >
        {shareLinkErrorMessage(encoding)}
      </p>
    )}
  </section>
);

export type ShareLinkLoadErrorProps = {
  readonly refusal: ShareLinkLoadRefusal | null;
};

export const ShareLinkLoadError = ({ refusal }: ShareLinkLoadErrorProps) => {
  if (refusal === null) return null;

  return (
    <section aria-label={SHARE_LINK_LOAD_ERROR_LABEL} data-testid={SHARE_LINK_LOAD_ERROR_TEST_ID}>
      <p role={ALERT_ROLE} data-refusal={refusal.kind}>
        {shareLinkLoadRefusalMessage(refusal)}
      </p>
    </section>
  );
};
