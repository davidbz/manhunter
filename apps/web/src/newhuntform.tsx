/**
 * What the player sees before there is a hunt (PLAN M5.5a). `state.hunt` is `null` until `start`
 * is dispatched and every panel renders nothing, so this is the whole screen at that point.
 *
 * **The setup surface is as small as DESIGN.md allows: a difficulty and a seed.** The grid and
 * the deadline are balance, not configuration - the same call `sim`'s `setupFrom` makes, and for
 * the same reason (PLAN M1.3 put the defaults in `balance.ts`; a field here would be a second
 * place to state them). The start hour and the criminal's profile are not offered at all: both
 * are drawn from the seed, which is what keeps a shared replay link from spoiling the hunt it
 * replays (PLAN "Decisions": where the start hour comes from).
 *
 * The seed is the one number the player types, so it is untrusted input and is bounded before it
 * is parsed (AGENTS.md section 5). Over the bound is a refusal with a reason, never a truncation,
 * and the field carries no `maxLength`: a bound the browser silently enforces is a refusal nobody
 * can reach and no test can mean anything about.
 *
 * **A real `<form onSubmit>`, closing the standing Inbox item (PLAN M5.7).** The element itself
 * was already a `<section>` holding a text field, a select and a button with no keyboard path to
 * either; it is a `<form>` now and the button is `type="submit"`, which is a swap in element and
 * attribute, not a restructuring - `submit` already existed and is unchanged, so Enter in the
 * seed field now reaches it the way clicking Start always did.
 *
 * PLAN M6.9 restyled it for the case briefing (`briefingscreen.tsx`) with classes only: the
 * difficulty stays a `<select>`, so the form still holds exactly one input and one select.
 */

import type { Difficulty, GameSetup } from "@manhunter/core";
import type { FormEvent } from "react";
import { useState } from "react";
import { LIMITS } from "./limits";
import { useGameStore } from "./storecontext";

/** A seed is an index into a stream, so zero is a seed (`sim`'s `MIN_SEED`, same reason). */
const MIN_SEED = 0;

const DEFAULT_SEED = 1;
const DEFAULT_DIFFICULTY: Difficulty = "standard";

/** Digits only. A seed that is not a whole number is a typo, not a hunt nobody asked for. */
const SEED_PATTERN = /^\d+$/;

export type SeedParse =
  | { readonly kind: "seed"; readonly seed: number }
  | { readonly kind: "too_long"; readonly length: number; readonly maxLength: number }
  | { readonly kind: "not_a_seed"; readonly value: string };

export type SeedRefusal = Exclude<SeedParse, { readonly kind: "seed" }>;

/**
 * The length is checked before anything is parsed or allocated, which is the whole of the bound:
 * `LIMITS.maxSeedInputLength` digits is the unsigned 32-bit range the RNG seeds from, and it
 * keeps every accepted seed inside `Number.MAX_SAFE_INTEGER` without a second check saying so.
 */
export const parseSeed = (text: string): SeedParse => {
  if (text.length > LIMITS.maxSeedInputLength) {
    return { kind: "too_long", length: text.length, maxLength: LIMITS.maxSeedInputLength };
  }
  const trimmed = text.trim();
  if (!SEED_PATTERN.test(trimmed)) {
    return { kind: "not_a_seed", value: text };
  }
  const seed = Number(trimmed);

  return seed < MIN_SEED ? { kind: "not_a_seed", value: text } : { kind: "seed", seed };
};

const TOO_LONG_PREFIX = "Seed is too long: ";
const TOO_LONG_SEPARATOR = " characters, at most ";
const NOT_A_SEED_MESSAGE = "Seed must be a whole number";

export const seedRefusalMessage = (refusal: SeedRefusal): string => {
  switch (refusal.kind) {
    case "too_long":
      return `${TOO_LONG_PREFIX}${refusal.length}${TOO_LONG_SEPARATOR}${refusal.maxLength}`;
    case "not_a_seed":
      return NOT_A_SEED_MESSAGE;
    default: {
      const exhaustive: never = refusal;
      return exhaustive;
    }
  }
};

type DifficultyOption = {
  readonly value: Difficulty;
  readonly label: string;
};

/** Written out per difficulty so a fourth in `core` is a compile error here (`sim`'s precedent). */
const DIFFICULTY_TABLE: Readonly<Record<Difficulty, DifficultyOption>> = {
  easy: { value: "easy", label: "Easy" },
  standard: { value: "standard", label: "Standard" },
  hard: { value: "hard", label: "Hard" },
};

export const DIFFICULTY_OPTIONS: readonly DifficultyOption[] = Object.values(DIFFICULTY_TABLE);

const difficultyOf = (value: string): Difficulty | null =>
  DIFFICULTY_OPTIONS.find((option) => option.value === value)?.value ?? null;

export const NEW_HUNT_TEST_ID = "new-hunt";
export const NEW_HUNT_SEED_TEST_ID = "new-hunt-seed";
export const NEW_HUNT_DIFFICULTY_TEST_ID = "new-hunt-difficulty";
export const NEW_HUNT_START_TEST_ID = "new-hunt-start";
export const NEW_HUNT_SEED_ERROR_TEST_ID = "new-hunt-seed-error";

const FORM_LABEL = "New hunt";
const SEED_LABEL = "Seed";
const DIFFICULTY_LABEL = "Difficulty";
const START_LABEL = "Start hunt";
const SEED_INPUT_ID = "new-hunt-seed";
const DIFFICULTY_INPUT_ID = "new-hunt-difficulty";
const TEXT_INPUT = "text";
const NUMERIC_INPUT_MODE = "numeric";

export const NewHuntForm = () => {
  const balance = useGameStore((state) => state.balance);
  const start = useGameStore((state) => state.start);
  const [seedText, setSeedText] = useState(String(DEFAULT_SEED));
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);

  const parsed = parseSeed(seedText);
  const setup: GameSetup = {
    map: balance.map.defaults,
    maxTurns: balance.time.maxTurns,
    difficulty,
  };

  const submit = () => {
    if (parsed.kind !== "seed") return;

    start({ setup, seed: parsed.seed });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  return (
    <form
      className="mh-form"
      aria-label={FORM_LABEL}
      data-testid={NEW_HUNT_TEST_ID}
      onSubmit={onSubmit}
    >
      <label className="mh-form__label" htmlFor={SEED_INPUT_ID}>
        {SEED_LABEL}
      </label>
      <input
        id={SEED_INPUT_ID}
        className="mh-form__field"
        data-testid={NEW_HUNT_SEED_TEST_ID}
        type={TEXT_INPUT}
        inputMode={NUMERIC_INPUT_MODE}
        value={seedText}
        onChange={(event) => setSeedText(event.target.value)}
      />
      <label className="mh-form__label" htmlFor={DIFFICULTY_INPUT_ID}>
        {DIFFICULTY_LABEL}
      </label>
      <select
        id={DIFFICULTY_INPUT_ID}
        className="mh-form__field"
        data-testid={NEW_HUNT_DIFFICULTY_TEST_ID}
        value={difficulty}
        onChange={(event) => setDifficulty(difficultyOf(event.target.value) ?? difficulty)}
      >
        {DIFFICULTY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {parsed.kind === "seed" ? null : (
        <p
          className="mh-alert mh-form__error"
          data-testid={NEW_HUNT_SEED_ERROR_TEST_ID}
          data-refusal={parsed.kind}
        >
          {seedRefusalMessage(parsed)}
        </p>
      )}
      <button
        type="submit"
        className="mh-button mh-button--commit mh-form__submit"
        data-testid={NEW_HUNT_START_TEST_ID}
        disabled={parsed.kind !== "seed"}
      >
        {START_LABEL}
      </button>
    </form>
  );
};
