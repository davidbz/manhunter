/**
 * The debrief (PLAN M6.9): what a finished hunt lands on. The report - `EndScreenPanel`'s outcome
 * banner and score tally - spans the top; the replay, with the criminal's revealed path and the
 * transport scrubber, takes the dominant column under it; and a side column holds the suspect's
 * dossier, the share link with its copy button, and the way back to the briefing.
 *
 * Placement only: every panel here already decides for itself whether it has anything to show.
 * `CriminalDossierPanel` is mounted here and nowhere earlier because the debrief is only reached
 * once the hunt has settled, which is when `hunt.frames` exists and the dossier reveals a face
 * (PLAN M6.7's note). Nothing here reads a `RevealFrame` itself.
 */

import { CriminalDossierPanel } from "./dossierpanel";
import { EndScreenPanel } from "./endscreenpanel";
import { ReplayScreen } from "./replayscreen";
import { RestartButton } from "./restartbutton";
import { ShareLinkPanel } from "./sharelinkpanel";

export const DEBRIEF_SCREEN_TEST_ID = "debrief-screen";

const DEBRIEF_LABEL = "Debrief";
const CASE_FILE_LABEL = "Case file";
const NEW_HUNT_LABEL = "New hunt";

export const DebriefScreen = () => (
  <section className="mh-debrief" aria-label={DEBRIEF_LABEL} data-testid={DEBRIEF_SCREEN_TEST_ID}>
    <EndScreenPanel />
    <ReplayScreen />
    <aside className="mh-debrief__side" aria-label={CASE_FILE_LABEL}>
      <div className="mh-card">
        <CriminalDossierPanel />
      </div>
      <div className="mh-card">
        <ShareLinkPanel />
      </div>
      <RestartButton screen="debrief" label={NEW_HUNT_LABEL} />
    </aside>
  </section>
);
