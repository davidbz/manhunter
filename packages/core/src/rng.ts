/**
 * Seeded PRNG for `core`. Architecture rule 2: every random choice in the simulation draws
 * from here, so a seed plus an action list reproduces a game byte for byte.
 *
 * This module fixes the IoC shape every later `core` module copies (AGENTS.md section 2):
 * `RngState` is plain serializable data, `Rng` is stateless logic obtained from `createRng()`
 * and injected as a dependency. Every draw takes a state and returns the next state beside the
 * value, so no generator object anywhere in `core` holds a position in the stream.
 *
 * The generator is sfc32, seeded through splitmix32. Chosen over mulberry32 because a 128-bit
 * state gives `fork` room to derive streams that do not collide, and over `crypto` because
 * `core` must be deterministic and run identically in the browser, Node and Bun.
 */

/** A position in a random stream. Four 32-bit words; JSON round-trips unchanged. */
export type RngState = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
};

/** The result of a draw: the value, and the state the next draw must use. */
export type RngDraw<T> = {
  readonly state: RngState;
  readonly value: T;
};

/**
 * A list that cannot be empty. `pick` and `weightedPick` take one so that "nothing to choose
 * from" is a compile error at the call site instead of an `undefined` every caller must handle.
 */
export type NonEmptyArray<T> = readonly [T, ...T[]];

/** One candidate in a weighted draw. Negative weights are clamped to zero. */
export type Weighted<T> = {
  readonly value: T;
  readonly weight: number;
};

export type Rng = {
  /** The stream's starting position for a game seed. */
  readonly seed: (seed: number) => RngState;
  /**
   * A stream derived from this one. Same state and label always give the same child, and the
   * parent is not advanced, so sibling systems can each hold an independent stream off one seed.
   */
  readonly fork: (state: RngState, label: string) => RngState;
  /** A whole number in [0, 2^32). */
  readonly uint32: (state: RngState) => RngDraw<number>;
  /** A number in [0, 1). */
  readonly float: (state: RngState) => RngDraw<number>;
  /** A whole number in [minInclusive, maxExclusive). An empty range draws nothing. */
  readonly int: (state: RngState, minInclusive: number, maxExclusive: number) => RngDraw<number>;
  readonly pick: <T>(state: RngState, items: NonEmptyArray<T>) => RngDraw<T>;
  readonly weightedPick: <T>(state: RngState, entries: NonEmptyArray<Weighted<T>>) => RngDraw<T>;
  readonly shuffle: <T>(state: RngState, items: readonly T[]) => RngDraw<readonly T[]>;
};

const UINT32_RANGE = 0x1_0000_0000;

const SFC32 = {
  shiftB: 9,
  scaleC: 3,
  rotateLeft: 21,
  rotateRight: 11,
  /** Draws discarded after seeding, so low-entropy seeds such as 0 or 1 start decorrelated. */
  warmupRounds: 12,
} as const;

const SPLITMIX32 = {
  increment: 0x9e37_79b9,
  firstShift: 16,
  firstMultiplier: 0x21f0_aaad,
  secondShift: 15,
  secondMultiplier: 0x735a_2d97,
  finalShift: 15,
} as const;

const FNV1A = {
  offsetBasis: 0x811c_9dc5,
  prime: 0x0100_0193,
} as const;

const nextWord = (state: RngState): RngDraw<number> => {
  const mixed = (((state.a + state.b) | 0) + state.d) | 0;
  const a = state.b ^ (state.b >>> SFC32.shiftB);
  const b = (state.c + (state.c << SFC32.scaleC)) | 0;
  const rotated = (state.c << SFC32.rotateLeft) | (state.c >>> SFC32.rotateRight);
  return {
    state: { a, b, c: (rotated + mixed) | 0, d: (state.d + 1) | 0 },
    value: mixed >>> 0,
  };
};

const scramble = (word: number): { readonly word: number; readonly value: number } => {
  const next = (word + SPLITMIX32.increment) | 0;
  const first = Math.imul(next ^ (next >>> SPLITMIX32.firstShift), SPLITMIX32.firstMultiplier);
  const second = Math.imul(first ^ (first >>> SPLITMIX32.secondShift), SPLITMIX32.secondMultiplier);
  return { word: next, value: (second ^ (second >>> SPLITMIX32.finalShift)) | 0 };
};

const stateFromWord = (word: number): RngState => {
  const first = scramble(word);
  const second = scramble(first.word);
  const third = scramble(second.word);
  const fourth = scramble(third.word);
  let warmed: RngState = {
    a: first.value,
    b: second.value,
    c: third.value,
    d: fourth.value,
  };
  for (let round = 0; round < SFC32.warmupRounds; round += 1) {
    warmed = nextWord(warmed).state;
  }
  return warmed;
};

const hashLabel = (label: string): number => {
  let hash: number = FNV1A.offsetBasis;
  for (let index = 0; index < label.length; index += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(index), FNV1A.prime);
  }
  return hash | 0;
};

const seed = (value: number): RngState => stateFromWord(value | 0);

const fork = (state: RngState, label: string): RngState => {
  let word = hashLabel(label);
  for (const stateWord of [state.a, state.b, state.c, state.d]) {
    word = scramble(word ^ stateWord).value;
  }
  return stateFromWord(word);
};

const float = (state: RngState): RngDraw<number> => {
  const drawn = nextWord(state);
  return { state: drawn.state, value: drawn.value / UINT32_RANGE };
};

const int = (state: RngState, minInclusive: number, maxExclusive: number): RngDraw<number> => {
  const span = maxExclusive - minInclusive;
  if (span <= 0) return { state, value: minInclusive };
  const drawn = float(state);
  return { state: drawn.state, value: minInclusive + Math.floor(drawn.value * span) };
};

const pick = <T>(state: RngState, items: NonEmptyArray<T>): RngDraw<T> => {
  const drawn = int(state, 0, items.length);
  // The index is in range by construction; the fallback exists only because
  // `noUncheckedIndexedAccess` cannot see that, and reads the tuple's guaranteed first element.
  return { state: drawn.state, value: items[drawn.value] ?? items[0] };
};

const positiveWeight = (entry: Weighted<unknown>): number => Math.max(entry.weight, 0);

const weightedPick = <T>(state: RngState, entries: NonEmptyArray<Weighted<T>>): RngDraw<T> => {
  const total = entries.reduce((sum, entry) => sum + positiveWeight(entry), 0);
  if (total <= 0) {
    // Every candidate was excluded. Callers filter before drawing; falling back to uniform keeps
    // the function total and keeps one draw's worth of state advance either way.
    const uniform = pick(state, entries);
    return { state: uniform.state, value: uniform.value.value };
  }
  const drawn = float(state);
  const threshold = drawn.value * total;
  let running = 0;
  for (const entry of entries) {
    running += positiveWeight(entry);
    if (running > threshold) return { state: drawn.state, value: entry.value };
  }
  // Only reachable when floating-point rounding leaves the threshold at or above the total.
  return { state: drawn.state, value: entries.at(-1)?.value ?? entries[0].value };
};

const shuffle = <T>(state: RngState, items: readonly T[]): RngDraw<readonly T[]> => {
  let current = state;
  let shuffled: readonly T[] = [];
  // Insertion variant of Fisher-Yates: placing the nth item in one of n+1 slots uniformly is
  // exactly uniform over permutations, and needs no indexed reads. Quadratic in allocations,
  // which is irrelevant at the sizes `core` shuffles (districts, exits, candidate actions).
  for (const item of items) {
    const drawn = int(current, 0, shuffled.length + 1);
    current = drawn.state;
    shuffled = shuffled.toSpliced(drawn.value, 0, item);
  }
  return { state: current, value: shuffled };
};

export const createRng = (): Rng => ({
  seed,
  fork,
  uint32: nextWord,
  float,
  int,
  pick,
  weightedPick,
  shuffle,
});
