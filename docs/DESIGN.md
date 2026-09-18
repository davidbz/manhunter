# Manhunter — Design

## Pitch

You run a manhunt. A criminal is loose in a city and heading for a way out. You never see them directly: you see reports, most of them late, some of them wrong. Each turn you spend limited resources to tighten the net, and every tightening has a cost. Catch them before they escape, before the public turns on you, or before someone else gets hurt.

**Core feeling:** acting on bad information under time pressure. When in doubt, a design choice should increase that tension, not reduce it.

## Pillars

1. **Information is late and unreliable.** Almost nothing tells you where the criminal is *now*.
2. **Every action has a cost.** Containment costs trust, intel costs time, media cuts both ways.
3. **The city is a character.** Districts, chokepoints, and time of day change what works.
4. **Readable afterwards.** The after-action replay shows exactly what happened and why you won or lost.

## Players

- **Hunter:** the human player.
- **Criminal:** AI opponent with a hidden profile.

## Time and turns

One turn ≈ one in-game hour. A standard hunt starts at a random time of day and lasts at most ~24 turns. The start hour is derived from the seed rather than chosen by the player, so it is not part of the player-visible setup a replay string carries.

### Turn phases

1. **Intel** — queued reports arrive (sightings, CCTV results, tips, pranks). Each has an observed-at time, a source, and a hidden reliability.
2. **Events** — random and triggered events fire, weighted by state (desperation, trust, time of day, reward level).
3. **Planning** — the hunter spends action points (AP).
4. **Resolution** — the criminal AI chooses its move from its own knowledge; both sides resolve simultaneously. Interactions (roadblock hit, drone spot, slip past) resolve here.
5. **Consequences** — meters update, the clock advances, end conditions are checked. (Fatigue accrual is post-MVP, with the meter itself.)

## The map

A graph.

- **Nodes:** districts/locations with a `districtType`: `downtown`, `residential`, `suburb`, `industrial`, `park`, `transit_hub`, `exit`.
- **Edges:** typed: `road`, `footpath`, `rail`, `tunnel`, `bridge`. Type sets travel cost per mode (foot, car, transit) and whether it can be blocked.
- **Exits:** `airport`, `port`, `border`, `highway`. Some exits are **timed** (ferry at a given turn, night-only smuggler).

### District properties

| Type | Witness density | Hiding spots | CCTV | Notes |
|---|---|---|---|---|
| downtown | high | high | high | crowds help both sides |
| residential | medium | medium | low | break-ins happen here |
| suburb | low | low | low | movement is conspicuous |
| industrial | low (very low at night) | high | medium | |
| park | medium by day, none at night | medium | none | slow movement, scent trails |
| transit_hub | high | low | high | fast escape routes |

### Generation validity (must always hold)

- Every exit is reachable from the criminal start.
- Shortest start→nearest-exit path ≥ `MIN_ESCAPE_TURNS`.
- Min-cut between start and the set of exits ≥ 2 (one roadblock never wins).
- At least one chokepoint exists that matters: a `bridge` or `tunnel` edge whose removal strictly increases the shortest start→nearest-exit cost. A city whose river could not be bridged has no such edge and is regenerated, not accepted.
- Start is not adjacent to an exit.

Generation is seeded. Invalid maps are rejected and regenerated with a derived seed.

## Hunter resources

- **Action points** per turn.
- **Budget** (helicopter, overtime, reward money).
- **Public trust** 0–100. Low trust ⇒ fewer and worse witness reports. 0 ⇒ removed from case.
- **Political pressure** 0–100, rises over time. High pressure triggers override events. The override events are post-MVP, so in the MVP pressure rises and is displayed and nothing reads it as a trigger yet. It is deliberately kept out of the score below: it rises with the clock, so scoring it would double-count turns taken.
- **Unit fatigue** per unit; tired units are less effective. Post-MVP: no MVP action deploys a unit, so there is nothing for fatigue to accrue on.

## Hunter actions

Each action has: AP cost, budget cost, duration, target type (node, edge, district, global), and effects.

**Containment:** roadblock (edge), transit shutdown (line), exit checkpoint (exit), helicopter sweep (area, loud), drone (smaller, quiet), K9 (follows fresh trail).
**Intelligence:** canvass (district), pull CCTV (district, returns past), phone triangulation (needs warrant, may be denied), financial monitoring (global, alert on use), informant (may lie), forensics (on found evidence), interview associates (may tip off).
**Media:** true briefing, fake briefing (misdirection; can be exposed), offer reward (more tips, more pranks), release photo, shelter-in-place.
**Deployment:** patrol, plainclothes, stakeout (multi-turn), request federal help (more units, less control).

**MVP subset:** roadblock, canvass, pull CCTV, true briefing.

## Criminal AI

### State

Position, travel mode, stamina, heat (recognizability), cash, desperation, knowledge (what it believes about police positions), profile.

### Actions

Move (foot/car/transit), hide, rest, change appearance, steal vehicle, ditch phone, use safehouse, contact accomplice, diversion, false trail, bribe, take hostage, wait for exit.

### Profiles

| Profile | Behavior |
|---|---|
| `amateur` (MVP) | heads for nearest exit, erratic, hides when heat is high, likely to hurt someone |
| `professional` | patient, uses safehouses, lays false trails, times exits |
| `local` | knows back routes, accomplices hide them |
| `planner` | pre-committed to a timed exit; the puzzle is which one |

### Decision model

Utility-based: score candidate actions by (progress to exit) − (perceived risk) + (profile weights) + noise, then pick. The AI sees only what it would plausibly know: visible roadblocks, news briefings, helicopters overhead. Leaked information events can give it more.

## Reports

Every report has: `observedAtTurn`, `receivedAtTurn`, `source`, `location`, `content`, hidden `truth` (true, false, prank, planted), hidden `accuracy`.

- **Sighting:** reliability depends on trust, district witness density, time of day, criminal heat.
- **CCTV:** reliable, delayed by 1–2 turns.
- **Prank:** rate scales with reward and media attention. Detectable by inconsistency (e.g. impossible travel time).
- **Planted:** from false trails or accomplices.

A report's `truth` is never visible, and never visible indirectly either: the event feed says a report arrived, not what kind of report it was. Telling a prank from a sighting is the player's job.

## Events

**Information:** eyewitness, prank call, lookalike false alarm, evidence found, anonymous tip.
**Criminal-driven:** civilian hurt (location confirmed, pressure up, roads clog), carjacking, break-in, hostage (switches to negotiation phase; post-MVP).
**World:** rush hour, nightfall, weather (grounds helicopters, washes scent), big public event (crowd), media leak, political override, jurisdiction takeover, vigilantes, unit incident.

Events are data: trigger conditions, weight function, effect handler.

## Probability heatmap

The hunter view includes a belief distribution over nodes: seeded from confirmed sightings, spread each turn along reachable edges by plausible speed, pruned by negative evidence (roadblock not hit, drone saw nothing), weighted by report reliability. Displayed as an overlay. Hardcore mode hides it.

## End conditions

- **Win:** capture. Score: turns taken, budget spent, civilian harm, trust remaining. Captured alive becomes a component once an action can use force; no MVP action can, and capture is both sides on one node, so every MVP capture is alive and the bonus would be a constant added to every win.
- **Lose:** criminal escapes via exit, trust hits 0, or casualties ≥ threshold.

Budget is not an end condition. It is enforced when an action is planned: an action you cannot afford is rejected, so the balance never goes below 0 and running dry costs you the tools to act rather than the case. A bankruptcy loss needs an action billed after the fact (overtime, federal help, standing upkeep on a containment), and those are all post-MVP.

## After-action replay

Stored as `{ seed, setup, hunterActions[] }`, where `setup` is the player-visible half of the configuration. The criminal's profile is *not* stored: it is derived from the seed, so a shared replay link does not spoil the hunt it replays. Replay reveals the criminal's true path over the hunter's heatmap, turn by turn.

## Visual direction (initial)

"Tactical dispatch screen": dark background, thin glowing roads, red heatmap, monospace report feed. Code-drawn, no illustrated assets required for MVP.

## Out of scope for MVP

PvP, campaign mode, hostage negotiation, unit fatigue, mobile layout, audio, portraits, save/load beyond replay strings.
