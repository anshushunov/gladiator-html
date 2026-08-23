# Order Legibility — Industry References

**Status: research notes, 2026-08-23.** Gathered after the bout-orders
playtest failed two of its three gate criteria
(`docs/reviews/2026-08-22-bout-orders-playtest.md`). Input for the next
brainstorming session; nothing here is a decision.

## The problem this is research for

The orders mechanic works and is balanced. What failed is legibility, on both
halves:

- **Visibility** — «стили не сильно различимы, возможно виновата очень
  условная графика». The simulation genuinely diverges (an 8.2-point win swing;
  traces differ from tick one), so the difference exists and does not reach the
  eye.
- **Attribution** — «нет обратной связи о том что на что влияет». The game
  states the order before the bout and the condition after it, and never
  connects the two.

Both are old, well-documented problems in genres adjacent to ours. What follows
is what other games did about them.

A note on evidence quality: the Slay the Spire / Into the Breach material and
the Skillz summary-screen guidance are design writing about shipped, successful
systems. The auto-battler devlogs are practitioner anecdote from small teams —
useful as failure reports, weak as principle. Steam-forum material (Domina,
Total War) is player testimony about how a shipped feature actually reads,
which is exactly the kind of evidence our playtest produced, so it is treated
as peer evidence rather than authority.

---

## 1. The closest neighbour: Domina

A gladiator-ludus management sim with the same command-level question we have —
you run the school, but somebody has to fight the bout.

Its answer: fights are automated by default, and direct control of one
gladiator is **gated behind a researched skill** ("Mind control"), toggled per
fight by clicking the fighter's card, shown by a gamepad icon replacing the
"AI" label in the corner of his box.

What went wrong there, and why it matters to us:

- Players bought the game specifically to control gladiators and could not find
  the toggle. Multiple forum threads exist about it.
- One diagnosis in those threads is exactly our failure mode, stated by a
  player rather than a designer: *"I think you thought you were controlling
  something when in fact you didn't. That's why it didn't feel right."*
- Experienced players advise leaving the AI on at high difficulty, because
  manual control is mechanically weak — so the headline feature reads as
  optional flavour.

**Read for us:** a lever the player cannot see themselves operating is
indistinguishable from no lever. Domina's is invisible because it is hidden in
a menu; ours is invisible because its effect is diffuse across 3600 ticks. Same
result: the player is not sure anything is happening.

## 2. Stance toggles that ship, and how they read: Total War

Guard mode (fight defensively, hold formation, do not pursue) and skirmish mode
(keep distance, retreat when approached) are essentially our `guarded`. In
older titles guard mode carried an explicit stat trade — **−2 attack, +2
defence** — i.e. the trade was a number the player could read, not an emergent
tendency.

The readability failures reported by players are worth copying down verbatim,
because they are ours:

- Players routinely **conflate the two toggles** and misattribute behaviour to
  the wrong one.
- A **default stance applied invisibly** (auto-skirmish for archers) produces
  "why did my unit do that?" confusion.
- Stance drift **goes unnoticed off-screen** while the player is busy
  elsewhere.

And the structural point: the stance state is communicated **only through the
selected-unit button panel**. Banners above units show type, strength and
allegiance — not stance. No persistent on-unit indicator exists. Total War, a
series with two decades of iteration, still has no world-space stance tell.

**Read for us:** our order selector is the button panel. The equivalent of the
missing banner overlay — a persistent, world-space or HUD-adjacent marker tied
to the fighter, not to the menu — is the cheap half of the visibility fix, and
even a mature series has not solved the "see it in the movement" half.

## 3. Authored opponent personality that spectators can read: Fire Pro Wrestling

The closest existing thing to our temperaments. Fire Pro's **CPU Logic Editor**
authors a wrestler's behaviour: move priorities by damage tier, personality
traits like Flex (how much the character plays to the match's stipulations and
adapts to the opponent), and above all **ukemi** — how willingly the AI takes
an opponent's move, which is the game's tool for match *narrative* rather than
match outcome.

Two things transfer directly:

- The community's baseline finding is that **default logic produces bad
  spectator matches** ("big-move spam") because defaults are tuned for
  player-vs-CPU, not for watching. Authoring for legibility is a separate
  activity from authoring for difficulty. Our `TEMPERAMENTS` rows were authored
  against a difficulty criterion; nobody authored them for how they read.
- Ukemi is a **pacing** dial with a hidden spirit meter behind it: 20 early /
  30 mid / 10 late for a comeback-shaped match. The personality is expressed as
  a *shape over the match's timeline*, not a constant bias. Our dispositions
  are a constant weight bias for the whole bout, which is the least legible
  possible shape — nothing changes, so there is no moment to notice.

**Read for us:** a disposition that varies across the bout (commit early, cover
late) may be far more readable than the same disposition applied flatly, at the
same or lower average magnitude. This is a hypothesis worth testing before
raising magnitudes.

## 4. The attribution problem, named by the genre that has it worst: auto-battlers

The genre is structurally ours — all agency is front-loaded into a preparation
phase, then you watch. Findings:

- Unreadable combat is **reported by players as "too random"**, not as "I
  couldn't tell why I lost". Our reviewer's «нет обратной связи» is the more
  articulate version of the same report; expect the less articulate version
  from anyone else.
- One devlog's conclusion after trying several UI fixes: **it was not a UI
  problem** — players said they did not know where to look, and the cause was
  the combat system itself competing for attention on too many channels.
  Warning for us: adding a post-bout line may not be enough on its own.
- **Pause-on-proc** was singled out by a player as the thing that made learning
  the game easy: pausing playback when an ability triggers converts an opaque
  damage blur into discrete, named causal events. In-playback attribution
  teaches the causal *rule*; a retrospective screen teaches only the outcome.
- Persistent state across rounds **compounds** attribution failure — a loss
  five rounds later traces to damage you can no longer inspect. That is exactly
  our condition ladder: wear taken in bout I decides bout III, and the player
  never saw the link.
- Design principle stated plainly: *it never feels good to lose when there was
  nothing you could have done to prevent it.*

## 5. The attribution problem in a game built on it: Football Manager

Sports Interactive's own guidance **concedes the problem**: it is difficult to
spot why things are not going your way, and a tactic that makes sense in your
head need not translate onto the pitch. Their tooling answer is the Analysis
tab — average positions, heat maps, key stats, staff feedback — plus an
opposition widget that shows not only the opponent's setup but the **tweaks
they made during the match**.

The community's method answer matters more to us than the tooling: **change one
variable at a time**, read the first 15 minutes before touching anything, and
do not attack every scouted weakness at once — changing several things
simultaneously makes attribution impossible.

**Read for us:** our Run B (all-standard season, then Rematch with orders) is
exactly this one-variable-at-a-time protocol, and the game does not help the
player run it. A built-in A/B — "this bout, under `standard`, went like this" —
would be the game doing the comparison the player cannot hold in their head.

## 6. What a good post-outcome screen actually does

From summary-screen design guidance and the game-based-learning literature on
debriefs, three properties recur:

1. **Decompose** the outcome into itemised, attributable line items — this is
   what converts one opaque number into a chain of causes.
2. **Counterfactualise** — name what went wrong and what the alternative would
   have been. The learning-science debrief template is four-part: *what
   happened / why it mattered / what you got wrong / what to do differently.*
   The military AAR unit of analysis is the **situation → response → effect**
   triple.
3. **Stay optional and skippable** — serve the mastery-seeking player without
   taxing everyone. FF16 is cited as the counter-example for unskippable
   post-battle screens.

**The caution, and it is a real one for us:** a designer worry recorded in a
Conquest of Elysium thread is that a good summary screen *encourages players
not to watch the battles* — one player admitted to sifting summaries instead of
watching combat. We are building a game whose combat is meant to be watched.
Improving attribution via a summary can actively worsen visibility. These two
failed criteria are not independent, and a fix aimed only at #3 may cost us #2.

## 7. Transparency as a design stance: Slay the Spire, Into the Breach

Both give the player **perfect information about intent** before it resolves —
icons above each enemy showing exactly what they will do and for how much,
generally exactly reliable, adjusted for current modifiers, with the weapon art
scaling across five threat tiers so the icon's *shape* carries the magnitude.
The sequel's refinement was to split merged icons into side-by-side ones —
readability improved by showing more, not by simplifying.

The argument for it, against the older strategy-game instinct to withhold: when
players cannot blame anyone but themselves, they engage more deeply.
Transparency converts uncertainty-anxiety into triage decisions. And the design
prices obscurity as a **cost**: the Runic Dome hides all intents in exchange for
a permanent extra Energy — hidden information is a drawback strong enough to
justify a resource bonus.

**Read for us:** our temperament badge is an intent icon with none of the
properties that make one work. It names a disposition, not a prediction; it
carries no magnitude; and it is never confirmed or refuted by what happens
next. Slay the Spire's icon is trustworthy because the turn immediately proves
it right.

---

## Candidate directions this suggests

Not decisions — the material for the next brainstorming session, roughly in the
order the evidence supports.

1. **State the causal link out loud after the bout** (§4, §6). One line in the
   condition/summary row: this order, this wear, this cost. Cheapest thing on
   the list. Keep it skippable (§6.3), and watch that it does not pull the
   player's eyes away from the fight (§6 caution).
2. **Make the disposition a shape over the bout, not a flat bias** (§3). Commit
   early / cover late gives the watcher a *moment* to notice. Plausibly buys
   more legibility per point of magnitude than raising the constants, and the
   constants are already at the top of what balance tolerates.
3. **Persistent stance tell on the fighter, not in the menu** (§2). Total War
   never shipped one; that is an opportunity, and also a warning about the
   difficulty.
4. **In-fight attribution rather than retrospective** (§4, pause-on-proc).
   Expensive, but the evidence says this is what teaches the rule instead of
   the outcome. Our replay/scrub tooling may make it cheaper than it looks.
5. **A built-in counterfactual** (§5, §6.2) — the same bout under a different
   order, run and compared by the game. We already have a deterministic
   simulation and fixed seeds, so this is unusually cheap for us: it is a
   second `createBattle` with one field changed. No other game in this list
   could afford it. Possibly our strongest available move.
6. **Author temperaments for legibility, separately from difficulty** (§3).
   Ours were authored against a balance criterion and then, in the final fix
   wave, against a difficulty budget that turned out to be empty. Nobody has
   ever asked how they read.

## Open questions for the next session

- Is the visibility failure a magnitude problem or an abstraction problem? This
  playtest cannot distinguish them (see the verdict). Direction 2 tests it
  cheaply: if a shaped disposition reads where a flat one at the same average
  did not, the abstraction is fine and the signal was mis-shaped.
- Does fixing attribution (#1, #5) reduce the pressure on visibility, or does
  it, per §6's caution, make the player stop watching and quietly make things
  worse?
- Is the temperament badge worth keeping as-is? Per §7 it currently has none of
  the properties that make an intent icon work, and per the balance measurement
  it does not change which order is best — it may be a label with nothing
  behind it.

## Sources

- [Domina — Steam discussions on gladiator control](https://steamcommunity.com/app/535230/discussions/0/2967272951906107868/), [Mind Control keys](https://steamcommunity.com/app/535230/discussions/0/1319961868323939361/), [Delta Vector: Domina — Gladiator Management](http://deltavector.blogspot.com/2018/02/domina-gladiator-management-pc.html), [Wikipedia](https://en.wikipedia.org/wiki/Domina_(video_game))
- [Total War Center — Guard Mode](https://www.twcenter.net/threads/guard-mode.675883/), [Shogun 2 Encyclopedia — The Battle Interface](https://shogun2-encyclopedia.com/how_to_play/049_enc_manual_battle_conflict_controls.html), [Warhammer III — does guard mode work for missile units](https://steamcommunity.com/app/1142710/discussions/0/3823034639977986781/)
- [Fire Pro Wrestling World — AI & Moveset Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=973746385), [Making CPU Logic Flow](https://steamcommunity.com/sharedfiles/filedetails/?id=2518292334), [SCFL Pro — CPU Logic guide](https://www.scflfirepro.com/guide-cpu-logic-in-fire-pro-wrestling-wold/), [Critical Club — Personality Logic Redux](https://criticalclub.com/thread/20/personality-logic-redux)
- [Order Automatica — launch feedback and plans (devlog)](https://newbeings.itch.io/order-automatica/devlog/415200/launch-version-feedback-and-plans), [TowerCrawl Tactics — new combat system (devlog)](https://krons.itch.io/towercrawl-tactics/devlog/254914/new-combat-system-who-dis), [Auto battler — Wikipedia](https://en.wikipedia.org/wiki/Auto_battler)
- [Football Manager — Spotting a problem (Wednesday Wisdom)](https://www.footballmanager.com/the-byline/spotting-problem-wednesday-wisdom), [A guide to match preparation](https://www.footballmanager.com/the-byline/tips-match-preparation-wednesday-wisdom), [Operation Sports — Why your FM26 tactic isn't working](https://www.operationsports.com/why-your-football-manager-26-tactic-isnt-working-and-how-to-fix-it/)
- [Skillz — Score Summary Screen guidance](https://docs.skillz.com/docs/score-summary/), [Reflection in Game-Based Learning: A Survey of Programming Games](https://arxiv.org/pdf/2006.10793), [After action report — Wikipedia](https://en.wikipedia.org/wiki/After_action_report), [Conquest of Elysium 4 — please add a post battle summary screen](https://steamcommunity.com/app/403950/discussions/0/487877107139797444)
- [Slay the Spire Wiki — Intent](https://slaythespire.wiki.gg/wiki/Intent), [Slay the Spire 2 — Intent](https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Intent), [Perfect Information: The Killer Feature of Slay the Spire and Into the Breach](https://jeremiahgames.com/2019/03/04/perfect-information-the-killer-feature-of-slay-the-spire-and-into-the-breach/), [PC Gamer — Best Design 2019: Slay the Spire](https://www.pcgamer.com/best-design-2019-slay-the-spire/)
- [Game Developer — Enemy design and enemy AI for melee combat systems](https://www.gamedeveloper.com/design/enemy-design-and-enemy-ai-for-melee-combat-systems), [Common Enemy AI Patterns](https://www.abratabia.com/game-ai-npc/enemy-ai-patterns.php)
