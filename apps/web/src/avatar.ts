/**
 * Procedural avatars (PLAN M6.7): a seed plus an `AvatarKind` becomes layered shape **data** -
 * build, head, headwear, mask band, eye band, each with a palette ramp and a tone index - and
 * `avatarportrait.tsx` only draws what this returns. Nothing here knows a colour; the ramps are
 * named, and `theme.ts`'s `AVATAR_THEME` says what each one looks like.
 *
 * **The hash is written here rather than borrowed from `core`'s `Rng`.** `createRng` is a factory
 * the composition root owns (AGENTS.md "Inversion of control"), so taking it would mean threading
 * an injected logic object through every component that draws a face, for a draw that is
 * cosmetic, stateless and never has to agree with the simulation's stream. A splitmix32
 * finaliser over `seed` and the kind's salt is the whole requirement: same inputs, same face.
 *
 * **The criminal's seeded portrait is a spoiler** (DESIGN.md "Visual direction"). The profile is
 * derived from the seed, so a face derived from it would correlate with exactly what `HunterView`
 * hides. `REDACTED_AVATAR` is therefore a constant - no seed reaches it - and `dossier.tsx` is the
 * one place that decides which of the two the player is shown.
 */

export const AVATAR_KINDS = ["criminal", "witness", "cctv", "tip", "patrol"] as const;

export type AvatarKind = (typeof AVATAR_KINDS)[number];

/** Who a drawn avatar is of. `redacted` is the seed-independent stand-in for the criminal. */
export type AvatarSubject = AvatarKind | "redacted";

export type AvatarBuild = "broad" | "narrow" | "jacket";
export type AvatarHead = "round" | "long" | "square";
export type AvatarHeadwear = "none" | "hair" | "beanie" | "cap" | "hood";
export type AvatarMask = "none" | "bandana" | "balaclava" | "scarf";
export type AvatarEyes = "dots" | "slit" | "glasses";

/** The palettes a layer can be toned from. `mark` is the criminal's red; nothing else uses it. */
export const AVATAR_RAMPS = [
  "skin",
  "garment",
  "headwear",
  "mask",
  "mark",
  "eyes",
  "redacted",
] as const;

export type AvatarRamp = (typeof AVATAR_RAMPS)[number];

/** Draw order, back to front. */
export const AVATAR_PARTS = ["build", "head", "headwear", "mask", "eyes"] as const;

export type AvatarPart = (typeof AVATAR_PARTS)[number];

/** Every choice an avatar is made of: a shape per part, and a tone index per toned part. */
export type AvatarTraits = {
  readonly build: AvatarBuild;
  readonly head: AvatarHead;
  readonly headwear: AvatarHeadwear;
  readonly mask: AvatarMask;
  readonly eyes: AvatarEyes;
  readonly skinTone: number;
  readonly garmentTone: number;
  readonly headwearTone: number;
  readonly maskTone: number;
};

/** One drawable shape. `path` is SVG path data in the `AVATAR_VIEWBOX_SIZE` square. */
export type AvatarLayer = {
  readonly part: AvatarPart;
  readonly path: string;
  readonly ramp: AvatarRamp;
  readonly tone: number;
};

export type Avatar = {
  readonly subject: AvatarSubject;
  readonly traits: AvatarTraits;
  readonly layers: readonly AvatarLayer[];
};

/** Side of the square every path below is authored in. */
export const AVATAR_VIEWBOX_SIZE = 64;

/**
 * How many tones each ramp holds. `theme.ts`'s ramps must be exactly this long, and
 * `avatarportrait.test.tsx` asserts it, so a tone index drawn here always names a real colour.
 */
export const AVATAR_TONE_COUNTS: Readonly<Record<AvatarRamp, number>> = {
  skin: 4,
  garment: 4,
  headwear: 3,
  mask: 3,
  mark: 1,
  eyes: 1,
  redacted: 3,
};

type Choices<T> = readonly [T, ...T[]];

/**
 * What each kind may wear. The criminal is always masked, in `mark` red, because a mask over an
 * unknown face is the Payday read; a patrol officer always wears the cap; a tip caller may be
 * hooded or scarfed, because an anonymous voice has no face to show.
 */
type Wardrobe = {
  readonly headwear: Choices<AvatarHeadwear>;
  readonly mask: Choices<AvatarMask>;
  readonly eyes: Choices<AvatarEyes>;
  readonly maskRamp: AvatarRamp;
};

const WARDROBES: Readonly<Record<AvatarKind, Wardrobe>> = {
  criminal: {
    headwear: ["none", "hair", "beanie", "hood"],
    mask: ["bandana", "balaclava", "scarf"],
    eyes: ["dots", "slit", "glasses"],
    maskRamp: "mark",
  },
  witness: {
    headwear: ["none", "hair", "beanie", "cap"],
    mask: ["none"],
    eyes: ["dots", "glasses"],
    maskRamp: "mask",
  },
  cctv: {
    headwear: ["hair", "none"],
    mask: ["none"],
    eyes: ["glasses", "dots"],
    maskRamp: "mask",
  },
  tip: {
    headwear: ["hood", "cap", "none"],
    mask: ["none", "scarf"],
    eyes: ["dots", "slit"],
    maskRamp: "mask",
  },
  patrol: {
    headwear: ["cap"],
    mask: ["none"],
    eyes: ["dots", "slit"],
    maskRamp: "mask",
  },
};

const BUILDS: Choices<AvatarBuild> = ["broad", "narrow", "jacket"];
const HEADS: Choices<AvatarHead> = ["round", "long", "square"];

const BUILD_PATHS: Readonly<Record<AvatarBuild, string>> = {
  broad: "M6 64 C8 50 18 45 32 45 C46 45 56 50 58 64 Z",
  narrow: "M12 64 C13 52 21 46 32 46 C43 46 51 52 52 64 Z",
  jacket: "M8 64 L14 50 C18 46 24 45 32 45 C40 45 46 46 50 50 L56 64 L38 64 L32 52 L26 64 Z",
};

const HEAD_PATHS: Readonly<Record<AvatarHead, string>> = {
  round: "M32 14 C40 14 44 20 44 28 C44 37 39 44 32 44 C25 44 20 37 20 28 C20 20 24 14 32 14 Z",
  long: "M32 12 C39 12 42 18 42 27 C42 38 38 45 32 45 C26 45 22 38 22 27 C22 18 25 12 32 12 Z",
  square:
    "M32 14 C40 14 44 19 44 27 L43 36 C41 41 37 44 32 44 C27 44 23 41 21 36 L20 27 C20 19 24 14 32 14 Z",
};

/** `none` has no entry: an absent part is an absent layer, not an empty path. */
const HEADWEAR_PATHS: Readonly<Record<Exclude<AvatarHeadwear, "none">, string>> = {
  hair: "M20 26 C20 17 25 13 32 13 C39 13 44 17 44 26 C42 21 38 19 32 19 C26 19 22 21 20 26 Z",
  beanie: "M19 26 C19 16 25 11 32 11 C39 11 45 16 45 26 L45 28 L19 28 Z",
  cap: "M20 24 C20 16 25 12 32 12 C39 12 44 16 44 24 L53 26 L53 28 L20 28 Z",
  hood: "M14 50 C14 30 20 10 32 10 C44 10 50 30 50 50 L44 46 C44 30 40 18 32 18 C24 18 20 30 20 46 Z",
};

const MASK_PATHS: Readonly<Record<Exclude<AvatarMask, "none">, string>> = {
  bandana: "M20 32 L44 32 L44 38 C40 44 24 44 20 38 Z",
  balaclava: "M20 22 L44 22 L44 33 L20 33 Z",
  scarf: "M21 36 L43 36 L45 42 L19 42 Z",
};

const EYES_PATHS: Readonly<Record<AvatarEyes, string>> = {
  dots: "M25 27 h4 v2 h-4 Z M35 27 h4 v2 h-4 Z",
  slit: "M24 27.5 h16 v1.5 h-16 Z",
  glasses: "M23 26 h7 v4 h-7 Z M34 26 h7 v4 h-7 Z M30 27.5 h4 v1 h-4 Z",
};

/** The tone each part takes on the redacted figure: one flat body, a darker band, dim eyes. */
const REDACTED_TONES: Readonly<Record<AvatarPart, number>> = {
  build: 0,
  head: 0,
  headwear: 0,
  mask: 1,
  eyes: 2,
};

const REDACTED_TRAITS: AvatarTraits = {
  build: "broad",
  head: "round",
  headwear: "hood",
  mask: "balaclava",
  eyes: "slit",
  skinTone: 0,
  garmentTone: 0,
  headwearTone: 0,
  maskTone: 0,
};

const SPLITMIX32 = {
  increment: 0x9e37_79b9,
  firstShift: 16,
  firstMultiplier: 0x21f0_aaad,
  secondShift: 15,
  secondMultiplier: 0x735a_2d97,
  finalShift: 15,
} as const;

const FNV1A = {
  offset: 0x811c_9dc5,
  prime: 0x0100_0193,
} as const;

/** One draw per trait, in `AvatarTraits` order; the position is the stream index. */
const TRAIT_DRAWS = {
  build: 1,
  head: 2,
  headwear: 3,
  mask: 4,
  eyes: 5,
  skinTone: 6,
  garmentTone: 7,
  headwearTone: 8,
  maskTone: 9,
} as const;

const mix32 = (value: number): number => {
  const first = Math.imul(value ^ (value >>> SPLITMIX32.firstShift), SPLITMIX32.firstMultiplier);
  const second = Math.imul(first ^ (first >>> SPLITMIX32.secondShift), SPLITMIX32.secondMultiplier);

  return (second ^ (second >>> SPLITMIX32.finalShift)) >>> 0;
};

const saltOf = (kind: AvatarKind): number => {
  let hash: number = FNV1A.offset;
  for (const character of kind) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), FNV1A.prime);
  }

  return hash >>> 0;
};

const drawOf = (base: number, index: number): number =>
  mix32((base + Math.imul(index, SPLITMIX32.increment)) >>> 0);

const choose = <T>(choices: Choices<T>, draw: number): T =>
  choices[draw % choices.length] ?? choices[0];

const traitsOf = (seed: number, kind: AvatarKind): AvatarTraits => {
  const base = mix32((seed ^ saltOf(kind)) >>> 0);
  const wardrobe = WARDROBES[kind];
  const draw = (index: number): number => drawOf(base, index);

  return {
    build: choose(BUILDS, draw(TRAIT_DRAWS.build)),
    head: choose(HEADS, draw(TRAIT_DRAWS.head)),
    headwear: choose(wardrobe.headwear, draw(TRAIT_DRAWS.headwear)),
    mask: choose(wardrobe.mask, draw(TRAIT_DRAWS.mask)),
    eyes: choose(wardrobe.eyes, draw(TRAIT_DRAWS.eyes)),
    skinTone: draw(TRAIT_DRAWS.skinTone) % AVATAR_TONE_COUNTS.skin,
    garmentTone: draw(TRAIT_DRAWS.garmentTone) % AVATAR_TONE_COUNTS.garment,
    headwearTone: draw(TRAIT_DRAWS.headwearTone) % AVATAR_TONE_COUNTS.headwear,
    maskTone: draw(TRAIT_DRAWS.maskTone) % AVATAR_TONE_COUNTS[wardrobe.maskRamp],
  };
};

const optionalLayer = (
  part: AvatarPart,
  path: string | undefined,
  ramp: AvatarRamp,
  tone: number,
): readonly AvatarLayer[] => (path === undefined ? [] : [{ part, path, ramp, tone }]);

const headwearPathOf = (headwear: AvatarHeadwear): string | undefined =>
  headwear === "none" ? undefined : HEADWEAR_PATHS[headwear];

const maskPathOf = (mask: AvatarMask): string | undefined =>
  mask === "none" ? undefined : MASK_PATHS[mask];

const portraitLayersOf = (traits: AvatarTraits, maskRamp: AvatarRamp): readonly AvatarLayer[] => [
  { part: "build", path: BUILD_PATHS[traits.build], ramp: "garment", tone: traits.garmentTone },
  { part: "head", path: HEAD_PATHS[traits.head], ramp: "skin", tone: traits.skinTone },
  ...optionalLayer("headwear", headwearPathOf(traits.headwear), "headwear", traits.headwearTone),
  ...optionalLayer("mask", maskPathOf(traits.mask), maskRamp, traits.maskTone),
  { part: "eyes", path: EYES_PATHS[traits.eyes], ramp: "eyes", tone: 0 },
];

/** The same seed and kind always give the same avatar; nothing else is read. */
export const avatarOf = (seed: number, kind: AvatarKind): Avatar => {
  const traits = traitsOf(seed, kind);

  return {
    subject: kind,
    traits,
    layers: portraitLayersOf(traits, WARDROBES[kind].maskRamp),
  };
};

/**
 * The criminal before the reveal. Built from fixed traits and drawn entirely from the `redacted`
 * ramp, so it is one value for every hunt: there is no seed for it to leak.
 */
export const REDACTED_AVATAR: Avatar = {
  subject: "redacted",
  traits: REDACTED_TRAITS,
  layers: portraitLayersOf(REDACTED_TRAITS, "redacted").map((layer) => ({
    ...layer,
    ramp: "redacted",
    tone: REDACTED_TONES[layer.part],
  })),
};
