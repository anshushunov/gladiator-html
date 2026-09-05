# Skinned gladiators — playtest, 2026-09-05

**Slice:** skinned KayKit gladiators driven by pack clips (PR #25 merged on
`main` at `b2b9a17`). Spec: `docs/superpowers/specs/2026-09-04-skinned-gladiators-design.md`.

**Reviewer:** the design owner, live build at `npm run dev`, seed 20260815 and
others, ×1 and ×2. **This document is not the human review gate** (two humans
who did not implement the combat); it is the owner's pass plus the
implementer's instrumented follow-up on each finding, as the two earlier
playtests did.

## Checklist verdicts

| # | question | verdict |
|---|---|---|
| 1 | three types read at a glance; two fighters of one type distinguishable | «да, более чем» |
| 2 | windup and tip land on the contact tick | «да, стало определенно лучше» |
| 3 | stance, walk, block, stagger, death: no T-pose, sliding, snapping | «стало лучше» |
| 4 | camera and on-screen size, narrow window included | «нормально» |
| 5 | net and trident in hand, no clipping through the body | «для текущего уровня неплохо» |

## Findings

> Hoplomachus идет в мили и никак не пытается рвать дистанцию и просто
> обменивается ударами. С трезубцем и щитом бойцы в целом нормально дерутся,
> с копьем не так сильно читается.

> Иногда бойцы входят в клинч и просто месят друг друга в мили почти
> слипшись — выглядит странно, мне кажется должно быть всё равно какое-то
> расстояние между ними даже когда обмениваются ударами, для замаха.

> Хочется улучшения анимации получения урона и ударов. Может быть цифры
> урона? или кровь вместо точки красной? Как-то более явно показывать промах
> или звуком это артикулировать.

> Ещё боец в арморе слишком одетый для гладиатора — у него не должен быть
> фул плейт, поищи референсы как мурмилло выглядели.

## What the simulation actually does (measured)

Per-tick root separation over all nine pairings, 20 seeds each, whole bouts
(`createBattle`/`advanceBattleTick`, the shipped catalogue). «Clinch» below
is a run of at least 60 consecutive ticks (1 s) under 1.2 units; the duel's
`DUEL_MINIMUM_SEPARATION` is 0.9.

| pairing | median | <1.0 | 1.0–1.6 | 1.6–2.1 | 2.1–2.8 | >2.8 | clinch runs / 20 bouts | longest clinch |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| brutus (murmillo) vs drusus (retiarius) | 1.61 | 13.6 % | 35.2 % | 23.3 % | 16.0 % | 12.0 % | 42 | 6.6 s |
| brutus (murmillo) vs cassius (hoplomachus) | 1.47 | 7.1 % | 58.3 % | 22.9 % | 4.4 % | 7.2 % | 30 | 3.6 s |
| brutus (murmillo) vs magnus (murmillo) | 1.40 | 13.4 % | 57.0 % | 18.9 % | 3.2 % | 7.6 % | 25 | 2.4 s |
| aquila (retiarius) vs drusus (retiarius) | 2.51 | 3.4 % | 14.7 % | 16.7 % | 24.4 % | 40.8 % | 9 | 2.6 s |
| aquila (retiarius) vs cassius (hoplomachus) | 2.33 | 1.1 % | 14.3 % | 22.8 % | 32.7 % | 29.0 % | 1 | 1.3 s |
| aquila (retiarius) vs magnus (murmillo) | 1.55 | 13.6 % | 39.8 % | 21.2 % | 14.3 % | 11.1 % | 53 | 6.3 s |
| nerva (hoplomachus) vs drusus (retiarius) | 2.34 | 1.5 % | 17.1 % | 20.2 % | 31.7 % | 29.6 % | 3 | 1.4 s |
| nerva (hoplomachus) vs cassius (hoplomachus) | 1.75 | 0.1 % | 33.9 % | 35.2 % | 19.6 % | 11.2 % | 2 | 1.6 s |
| nerva (hoplomachus) vs magnus (murmillo) | 1.45 | 8.9 % | 57.7 % | 22.5 % | 4.3 % | 6.6 % | 41 | 4.4 s |

### Finding 1 — the hoplomachus does fight in melee, and nothing in the rules tells him not to

The hoplomachus' authored preferred range is 2.1–2.8. Against the murmillo he
spends **4.3 %** of ticks there and **58 %** at 1.0–1.6; in the mirror bout,
20 % and 34 %. Only against the retiarius does he stand where the design says
(32 % in band). So the feeling is exact: the spear fighter is a spear fighter
only when the other man keeps the distance for him.

The reason is in the catalogue, not the models. Every hoplomachus attack is
**legal at melee range**: `technical-thrust` contacts at 1.2–2.8,
`technical-parry-counter` at 0.9–2.3, `technical-driving-thrust` at 1.6–3.1.
The retiarius has a real floor — the trident is illegal under 1.6, which is
what the reach slice built — and that floor is what makes him give ground.
The hoplomachus has no such floor, so once the murmillo closes (his whole game,
contact 0.9–1.4) the hoplomachus loses nothing by staying and trading.

The visual half of the same finding: the pack's `1H_Melee_Attack_Stab` used
for `technical-thrust` is a short one-handed stab, so a spear thrust reads like
a dagger poke; the trident's `2H_Melee_Attack_Stab` reads because it is a
two-handed reach.

### Finding 2 — the clinch is real, frequent, and legal

Every murmillo pairing has 25–53 clinch runs per 20 bouts, up to 6.6 s
continuous under 1.2 units. `DUEL_MINIMUM_SEPARATION` is 0.9, and the
murmillo's `heavy-shield-jab` contacts at 0.9–1.4, so the separation solver
holds the pair at exactly the distance where his attacks are best. With
1.8–2.0-unit bodies whose heads are a third of their height, 0.9 units of
root separation is visibly two men standing inside each other's guard, and
the pack's windups need about 1.3–1.5 units to read as a swing.

This was also true of the procedural rig; the skinned bodies make it
visible.

### Finding 3 — hit, miss and damage feedback

What exists today: a contact flash (`shield`/`weapon` kinds, a coloured dot),
`Hit_A` on the victim, the weapon trail, and audio cues `body-hit`,
`shield-block`, `weapon-parry`, `stagger`, `defeat`, two whooshes and two
footsteps. A **miss** has no visual at all and only the whoosh in audio; the
only place it is stated is the battle feed («Brutus misses.»). Damage amounts
exist only in the feed.

### Finding 4 — the murmillo is wearing the Knight's plate

The archetype mapping used the pack's Knight as-is: full plate body, closed
helm. Historically the murmillo is nearly bare: a large crested bronze helmet
with a face grille (the «fish» crest), a **manica** on the sword arm, a single
short greave on the leading left leg, a **subligaculum** (loincloth) with a
wide **balteus** belt, bare torso, the tall rectangular **scutum** and a
gladius. No breastplate — only the provocator wore one. References:
[Encyclopaedia Romana, murmillo](https://penelope.uchicago.edu/encyclopaedia_romana/gladiators/murmillo.html),
[Legio X Fretensis, murmillo](https://x-legio.com/en/wiki/murmillo)
(with the Pompeii relief and lamp figurines),
[Through Eternity, gladiator types](https://www.througheternity.com/travel-guide/roman-gladiator-types-a-complete-guide),
[Kayserstuhl reenactment helmets](https://kayserstuhl.com/collections/gladiator-helmets/murmillo),
[Warriors and Legends, murmillo](https://www.warriorsandlegends.com/gladiators/murmillo-gladiator/).
Junkelmann's *Das Spiel mit dem Tod* (2000) is the standard.

The Barbarian body (bare torso, bracers) is closer to every historical type
than the Knight is; the pack's `Knight_Helmet` is a closed great helm, not a
brimmed crested galea.

## Proposed next slice (not started; the owner asked for fixes in the next session)

Ordered by what the playtest weighted most, with the layer each lives in:

1. **Hoplomachus keeps his distance (simulation, content).** Give the spear a
   floor the way the trident has one: raise `technical-thrust`'s and
   `technical-parry-counter`'s `contactRange.min` toward 1.5–1.6, and give the
   technical style a disengage impulse when the opponent is inside that floor
   (the retiarius' forced-disengage seam already exists in `combatDecision.ts`).
   This is a balance change: the cohorts, the golden season and the camera
   traces all move, and the counter triangle has to be re-measured. Gate it
   with the same time-at-distance table above, not only the contact bands.
2. **A swing needs room (simulation).** Raise `DUEL_MINIMUM_SEPARATION` from
   0.9 toward 1.2–1.3 and re-check the murmillo's `heavy-shield-jab` window
   (0.9–1.4) so his best attack still has a band. Same re-baseline cost as (1);
   do both in one slice so the balance work happens once.
3. **Hit and miss feedback (presentation only, no simulation).** A miss gets
   its own visual (a short weapon-trail flick past the target or a dust puff at
   the tip) and a distinct audio cue; a hit gets a blood spurt or spray in
   place of the dot, plus floating damage numbers drawn from the same
   `damage-dealt` events the feed already reads. All from existing events;
   nothing in `src/simulation/` changes.
4. **Murmillo kit (Blender script).** Rebuild `heavy` from the Barbarian body
   with a script-built crested brimmed helmet, a manica on the right arm, one
   greave on the left leg, keep the rectangle shield and sword; drop the plate.
   Same pipeline as the trident and spear. Keeps the three silhouettes distinct
   (crest + big shield vs bare-headed net vs buckler + spear), which is what
   the legibility harness measures.
5. **Spear thrust that reads as a spear (Blender).** Author `Spear_Thrust`
   (two-handed reach, like the trident's) and fix `Spear_Drive`'s reach at
   contact, both in the build script, and map `technical-thrust` to it.

Items 1–2 are one balance slice; items 3–5 are presentation and can go in
parallel with it or first, since they never touch a frozen number.
