/**
 * The screen a finished hunt lands on (PLAN M5.6a): the outcome, and the M3.10 score breakdown
 * component by component rather than one number.
 *
 * Presentational and controlled, like `meters.tsx`: it takes a `ScoreBreakdown` and nothing else,
 * and decides for itself whether there is anything to show, the way `dispatcherrors.tsx`'s
 * `DispatchErrors` already does for its own props. A breakdown whose outcome is still
 * `in_progress` renders nothing - `EndScreenPanel` never hands it one, because a hunt still
 * running has nothing here to say, but the component is where the type is narrowed so the guard
 * lives in one place rather than at every caller.
 *
 * **Every component the breakdown carries is rendered by iterating `breakdown.components`, not
 * by naming each `ScoreComponentKind` in a branch.** `SCORE_COMPONENT_LABELS` is a
 * `Readonly<Record<ScoreComponentKind, string>>`, the `METER_LABELS` pattern `meters.tsx` set: a
 * fifth component added to `core/src/score.ts`'s `SCORE_COMPONENTS` table (PLAN M8's
 * captured-alive bonus) is a compile error here until this table says what it is called, so a
 * new component cannot silently go unrendered. `OUTCOME_LABELS` is the same table over
 * `FinishedOutcome["kind"]`.
 *
 * PLAN M6.9 turned it into the debrief's report: an outcome banner (a verdict kicker over the
 * outcome heading) and the breakdown as a tally, each row carrying `data-sign` so the stylesheet
 * can colour a bonus apart from a penalty without reading the number.
 */

import type { GameOutcome, ScoreBreakdown, ScoreComponentKind } from "@manhunter/core";

/** The outcome kinds the end screen ever draws. A running hunt has no end screen to reach. */
export type FinishedOutcome = Exclude<GameOutcome, { readonly kind: "in_progress" }>;

const OUTCOME_LABELS: Readonly<Record<FinishedOutcome["kind"], string>> = {
  captured: "Captured",
  escaped: "The criminal escaped",
  trust_collapsed: "Public trust collapsed",
  casualties_exceeded: "Casualties exceeded the threshold",
  timed_out: "The deadline ran out",
};

const SCORE_COMPONENT_LABELS: Readonly<Record<ScoreComponentKind, string>> = {
  turns_taken: "Turns taken",
  budget_spent: "Budget spent",
  casualties: "Casualties",
  trust_remaining: "Trust remaining",
};

export type EndScreenProps = {
  readonly breakdown: ScoreBreakdown;
};

export const END_SCREEN_TEST_ID = "end-screen";
export const END_SCREEN_OUTCOME_TEST_ID = "end-screen-outcome";
export const SCORE_BREAKDOWN_TEST_ID = "score-breakdown";
export const SCORE_BASE_TEST_ID = "score-base";
export const SCORE_COMPONENT_TEST_ID = "score-component";
export const SCORE_TOTAL_TEST_ID = "score-total";

const END_SCREEN_LABEL = "Hunt complete";
const ON_TURN_PREFIX = "On turn ";
const POSITIVE_SIGN = "+";
const NO_POINTS = 0;

/** A penalty already reads negative (score.ts's signed weights); a bonus needs its own sign. */
const signed = (points: number): string =>
  points > NO_POINTS ? `${POSITIVE_SIGN}${points}` : String(points);

/**
 * The banner's kicker (PLAN M6.9): one verdict per way a hunt ends, over the same outcome kinds
 * `OUTCOME_LABELS` names, so a sixth outcome is a compile error here too.
 */
const VERDICT_LABELS: Readonly<Record<FinishedOutcome["kind"], string>> = {
  captured: "Case closed",
  escaped: "Case lost",
  trust_collapsed: "Case lost",
  casualties_exceeded: "Case lost",
  timed_out: "Case lost",
};

type TallySign = "bonus" | "penalty" | "nil";

const signOf = (points: number): TallySign => {
  if (points > NO_POINTS) return "bonus";
  return points < NO_POINTS ? "penalty" : "nil";
};

export const EndScreen = ({ breakdown }: EndScreenProps) => {
  if (breakdown.outcome.kind === "in_progress") return null;
  const outcome = breakdown.outcome;

  return (
    <section
      className="mh-debrief__report"
      aria-label={END_SCREEN_LABEL}
      data-testid={END_SCREEN_TEST_ID}
    >
      <header className="mh-banner" data-outcome={outcome.kind}>
        <p className="mh-banner__verdict">{VERDICT_LABELS[outcome.kind]}</p>
        <h2
          className="mh-banner__outcome"
          data-testid={END_SCREEN_OUTCOME_TEST_ID}
          data-outcome={outcome.kind}
          data-turn={outcome.turn}
        >
          {OUTCOME_LABELS[outcome.kind]}
        </h2>
        <p className="mh-banner__turn">
          {ON_TURN_PREFIX}
          {outcome.turn}
        </p>
      </header>
      <dl className="mh-tally" data-testid={SCORE_BREAKDOWN_TEST_ID}>
        <div
          className="mh-tally__row"
          data-testid={SCORE_BASE_TEST_ID}
          data-points={breakdown.base}
          data-sign={signOf(breakdown.base)}
        >
          <dt>Base</dt>
          <dd className="mh-tally__points">{signed(breakdown.base)}</dd>
        </div>
        {breakdown.components.map((component) => (
          <div
            key={component.kind}
            className="mh-tally__row"
            data-testid={SCORE_COMPONENT_TEST_ID}
            data-kind={component.kind}
            data-measured={component.measured}
            data-points={component.points}
            data-sign={signOf(component.points)}
          >
            <dt>
              {SCORE_COMPONENT_LABELS[component.kind]}
              <span className="mh-tally__measured">{component.measured}</span>
            </dt>
            <dd className="mh-tally__points">{signed(component.points)}</dd>
          </div>
        ))}
        <div
          className="mh-tally__row mh-tally__row--total"
          data-testid={SCORE_TOTAL_TEST_ID}
          data-points={breakdown.total}
          data-sign={signOf(breakdown.total)}
        >
          <dt>Total</dt>
          <dd className="mh-tally__points">{signed(breakdown.total)}</dd>
        </div>
      </dl>
    </section>
  );
};
