/**
 * The case briefing (PLAN M6.9): what the player sees before a hunt. The rules of the case,
 * stated from the balance (`briefing.ts`); the suspect's dossier, redacted; and the new-hunt form
 * with anything that went wrong reaching it - a refused start, or a share link that would not
 * load.
 *
 * **The dossier here is always the redacted one, built from a literal subject rather than
 * `CriminalDossierPanel`.** No hunt exists yet, so there is no seed to draw a face from, and a
 * shared link that loaded would already have left this screen; drawing the redacted card directly
 * keeps anything that could reveal the criminal out of this file entirely (architecture rule 4).
 *
 * The restart button here clears the refusals the store holds and resets the form, which keeps
 * no state the store can reach: `formKey` is bumped on restart and used as the form's `key`, so
 * React drops the typed seed and difficulty and mounts the form fresh.
 */

import { useState } from "react";
import { briefingOf } from "./briefing";
import { DispatchErrorsPanel } from "./dispatcherrorspanel";
import { CriminalDossier, type DossierSubject } from "./dossier";
import { NewHuntForm } from "./newhuntform";
import { RestartButton } from "./restartbutton";
import { ShareLinkErrorPanel } from "./sharelinkpanel";
import { useGameStore } from "./storecontext";

export const BRIEFING_SCREEN_TEST_ID = "briefing-screen";
export const BRIEFING_ITEM_TEST_ID = "briefing-item";

const BRIEFING_LABEL = "Case briefing";
const BRIEFING_KICKER = "Case briefing";
const BRIEFING_HEADING = "A fugitive is loose in the city";
const BRIEFING_LEDE =
  "Every report you get is partial and some are wrong. Place roadblocks, work the witnesses, and close the net before they slip out.";
const ASSIGNMENT_LABEL = "Assignment";
const ORDERS_LABEL = "Standing orders";
const RESET_LABEL = "Reset briefing";
const REDACTED: DossierSubject = { kind: "redacted" };
const FIRST_FORM = 0;

export const BriefingScreen = () => {
  const balance = useGameStore((state) => state.balance);
  const [formKey, setFormKey] = useState(FIRST_FORM);

  return (
    <section
      className="mh-briefing"
      aria-label={BRIEFING_LABEL}
      data-testid={BRIEFING_SCREEN_TEST_ID}
    >
      <header className="mh-briefing__header">
        <p className="mh-briefing__kicker">{BRIEFING_KICKER}</p>
        <h2 className="mh-briefing__title">{BRIEFING_HEADING}</h2>
        <p className="mh-briefing__lede">{BRIEFING_LEDE}</p>
      </header>
      <div className="mh-card mh-briefing__dossier">
        <CriminalDossier subject={REDACTED} />
      </div>
      <section className="mh-card mh-briefing__rules" aria-label={ORDERS_LABEL}>
        <h3 className="mh-card__title">{ORDERS_LABEL}</h3>
        <dl className="mh-rules">
          {briefingOf(balance).map((item) => (
            <div
              key={item.kind}
              className="mh-rules__item"
              data-testid={BRIEFING_ITEM_TEST_ID}
              data-item={item.kind}
            >
              <dt className="mh-rules__title">{item.title}</dt>
              <dd className="mh-rules__detail">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="mh-card mh-briefing__assignment">
        <h3 className="mh-card__title">{ASSIGNMENT_LABEL}</h3>
        <DispatchErrorsPanel />
        <ShareLinkErrorPanel />
        <NewHuntForm key={formKey} />
        <RestartButton
          screen="briefing"
          label={RESET_LABEL}
          onRestarted={() => setFormKey((key) => key + 1)}
        />
      </div>
    </section>
  );
};
