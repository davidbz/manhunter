/**
 * The cosmetic seed hash `web` draws faces and place names from (PLAN M6.7, extracted at M7.1).
 *
 * **Written here rather than borrowed from `core`'s `Rng`.** `createRng` is a factory the
 * composition root owns (AGENTS.md "Inversion of control"), so taking it would mean threading an
 * injected logic object through every component that draws a face or names a street, for draws
 * that are cosmetic, stateless and never have to agree with the simulation's stream. A splitmix32
 * finaliser over a seed and a salt is the whole requirement: same inputs, same output.
 */

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

/** The splitmix32 finaliser: an unsigned 32-bit value to a well-mixed unsigned 32-bit value. */
export const mix32 = (value: number): number => {
  const first = Math.imul(value ^ (value >>> SPLITMIX32.firstShift), SPLITMIX32.firstMultiplier);
  const second = Math.imul(first ^ (first >>> SPLITMIX32.secondShift), SPLITMIX32.secondMultiplier);

  return (second ^ (second >>> SPLITMIX32.finalShift)) >>> 0;
};

/**
 * FNV-1a over a string, as an unsigned 32-bit seed. The report feed (PLAN M6.8) seeds each
 * source's face from the report's public id with it, never from the hunt's seed.
 */
export const textSeedOf = (text: string): number => {
  let hash: number = FNV1A.offset;
  for (const character of text) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), FNV1A.prime);
  }

  return hash >>> 0;
};

/** The seed a stream of draws starts from: `seed` mixed with a salt naming what is drawn. */
export const streamBaseOf = (seed: number, salt: string): number =>
  mix32((seed ^ textSeedOf(salt)) >>> 0);

/** The `index`th draw of the stream starting at `base`. */
export const drawOf = (base: number, index: number): number =>
  mix32((base + Math.imul(index, SPLITMIX32.increment)) >>> 0);
