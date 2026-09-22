/**
 * Draws an `Avatar` (PLAN M6.7). `avatar.ts` decides every shape and tone; this file only turns
 * its layers into paths on a plate, so what an avatar is and how it is drawn are tested apart.
 *
 * Named `avatarportrait.tsx` rather than the `avatar.tsx` the plan suggested: beside `avatar.ts`,
 * an extensionless `./avatar` import resolves to the `.ts` file under `moduleResolution: bundler`
 * and Vite alike, so a same-named `.tsx` could not be imported at all.
 */

import { AVATAR_VIEWBOX_SIZE, type Avatar, type AvatarRamp } from "./avatar";
import { AVATAR_THEME } from "./theme";

export type AvatarToneRamp = readonly [string, ...string[]];

export type AvatarTheme = {
  readonly ramps: Readonly<Record<AvatarRamp, AvatarToneRamp>>;
  readonly plate: string;
  readonly plateEdge: string;
  readonly plateEdgeWidth: number;
  /** The dossier's portrait, in CSS pixels. */
  readonly portraitSize: number;
  /** A feed row's source badge, in CSS pixels. */
  readonly thumbnailSize: number;
};

export const DEFAULT_AVATAR_THEME: AvatarTheme = AVATAR_THEME;

export type AvatarPortraitProps = {
  readonly avatar: Avatar;
  /** Read aloud in place of the picture. */
  readonly label: string;
  readonly size: number;
  readonly theme?: AvatarTheme;
};

export const AVATAR_TEST_ID = "avatar";
export const AVATAR_LAYER_TEST_ID = "avatar-layer";

const VIEWBOX = `0 0 ${AVATAR_VIEWBOX_SIZE} ${AVATAR_VIEWBOX_SIZE}`;

/** A tone index past the ramp's end wraps rather than drawing nothing. */
export const toneOf = (ramp: AvatarToneRamp, tone: number): string =>
  ramp[tone % ramp.length] ?? ramp[0];

export const AvatarPortrait = ({
  avatar,
  label,
  size,
  theme = DEFAULT_AVATAR_THEME,
}: AvatarPortraitProps) => (
  <svg
    role="img"
    aria-label={label}
    viewBox={VIEWBOX}
    width={size}
    height={size}
    data-testid={AVATAR_TEST_ID}
    data-subject={avatar.subject}
  >
    <rect
      width={AVATAR_VIEWBOX_SIZE}
      height={AVATAR_VIEWBOX_SIZE}
      fill={theme.plate}
      stroke={theme.plateEdge}
      strokeWidth={theme.plateEdgeWidth}
    />
    {avatar.layers.map((layer) => (
      <path
        key={layer.part}
        d={layer.path}
        fill={toneOf(theme.ramps[layer.ramp], layer.tone)}
        data-testid={AVATAR_LAYER_TEST_ID}
        data-part={layer.part}
        data-ramp={layer.ramp}
      />
    ))}
  </svg>
);
