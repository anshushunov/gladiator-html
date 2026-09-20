# Fighting room, feedback, kit and spear — playtest checklist, 2026-09-20

**Slice:** four PRs merged onto `main` at `27d2739`, in this order:

| PR | what it claims | spec |
|---|---|---|
| [#26](https://github.com/anshushunov/gladiator-html/pull/26) | the bout has room to fight in | `docs/superpowers/specs/2026-09-05-fighting-room-design.md` |
| [#28](https://github.com/anshushunov/gladiator-html/pull/28) | the murmillo reads as a gladiator, not a knight | `docs/superpowers/specs/2026-09-17-kit-design.md` §4.1 |
| [#27](https://github.com/anshushunov/gladiator-html/pull/27) | hit, block and miss read from the arena alone | `docs/superpowers/specs/2026-09-17-feedback-design.md` |
| [#29](https://github.com/anshushunov/gladiator-html/pull/29) | a spear thrust lands on the man | `docs/superpowers/specs/2026-09-17-kit-design.md` §4.2 |

Each answers one finding of the 2026-09-05 playtest
(`docs/reviews/2026-09-05-skinned-gladiators-playtest.md`). **This document is
not the human review gate** (that wants two humans who did not implement the
combat); it is the owner's pass, and the instrumented follow-up on each finding
is written underneath afterwards, as the earlier playtests did.

**Material:** `docs/reviews/clips/` (thirteen clips, seed 20260815, ×1 with the
HUD and ×1 with the HP cards and battle feed hidden — the hidden ones are what
the feedback claim has to survive). Sound is not in the files; Chromium records
silent. Audio is reviewed live at `npm run dev`, and the ten cues can be fired
in isolation from the `?audioDebug=1` panel.

## Checklist

Answer in whatever words come; the verdict column takes prose, not scores.

| # | question | what changed, and why this question | verdict |
|---|---|---|---|
| 1 | Do two fighters ever look **stuck together**? Is there room for a windup in a close exchange? | Every authored separation moved outward by 0.30 and the arena grew with it (6.5×2.5 → 7.5×3.3). Continuous clinches under 1.2 units went from dozens per twenty bouts to none — but "none by the instrument" and "none to the eye" are different claims. | |
| 2 | Does the **hoplomachus try to make room**, or does he stand and trade? | His thrusts now push (0.30→0.70 and 0.50→1.10). Time inside his own measure rose 15.9% → 26.7%, roughly doubling against a murmillo. Watch clips 2, 5, 7, 8. | |
| 3 | With the **HP cards and feed hidden**, can you tell hit from block from miss on every exchange? | Four new channels: blood spray along the blow, a sand puff on a miss, a floating damage number, and a separate audio cue for miss/evade. This is the whole feedback claim. Clips 1, 4, 7 are the hidden ones. | |
| 4 | Can you tell **roughly how much** a hit cost, without the cards? | The damage number is the "cost" half. Does it read at ×1, or does it need ×0.5? Is it in the way? | |
| 5 | Does the **murmillo read as a gladiator** rather than a knight? | Barbarian body, bronze galea with a wide brim and a low crest, manica on the sword arm, one greave, behind the Knight's scutum and gladius. This is the one thing only the eye can judge. | |
| 6 | Does the **spear thrust land on the man**? Does the shaft behind the fist look right? | The spear is gripped 0.3 source units from the butt, so 1.756 units sit ahead of the hand and 0.274 behind. Measured, the tip lands 0.244 past the opponent's root on the driving thrust and 0.334 on the ordinary one. The 0.334 is the one to watch — it is the longer of the two and may read as passing through. | |
| 7 | Is anything **cropped** at a narrow window? | The safe-area gate fails on six of nine pairings at 1024×768 — a known, reported regression from the arena growing, not a new one (see below). Worth your eyes on whether it is visible or merely measurable. | |
| 8 | Anything that got **worse**? | Four slices landed together. | |

## Where the fighters actually stand now (measured, for question 1)

`scripts/measure-distance.ts` on `27d2739`, every tick of every bout, 20 seeds
per pairing. The 2026-09-05 table is the same instrument at
`DUEL_MINIMUM_SEPARATION` 0.9; this one is at 1.2.

| pairing | median | clinch runs (≥1 s under 1.2) | was | pinned runs (≥1 s within 0.15 of the floor) | pinned % of ticks |
|---|---:|---:|---:|---:|---:|
| brutus (murmillo) vs drusus (retiarius) | 1.92 | **0** | 42 | 42 | 17.6% |
| brutus vs cassius (hoplomachus) | 1.82 | **0** | 30 | 13 | 8.9% |
| brutus vs magnus (murmillo) | 1.70 | **0** | 25 | 12 | 16.8% |
| aquila (retiarius) vs drusus | 2.87 | **0** | 9 | 0 | 2.9% |
| aquila vs cassius | 2.70 | **0** | 1 | 0 | 1.9% |
| aquila vs magnus | 1.87 | **2** | 53 | 41 | 19.4% |
| nerva (hoplomachus) vs drusus | 2.66 | **0** | 3 | 0 | 2.3% |
| nerva vs cassius | 2.68 | **0** | 2 | 0 | 0.3% |
| nerva vs magnus | 1.83 | **0** | 41 | 9 | 9.3% |

**Read the last two columns before answering question 1.** The absolute clinch
counter went to almost zero, but that counter is defined at 1.2 and the floor is
now 1.2 — it cannot report a pair welded together at the new floor, which is the
opposite of the truth. The `pinned` columns are the floor-relative companion,
and they say the pressing did not vanish: the murmillo pairings still spend
17–19% of their ticks within 0.15 of the floor, in runs up to 5.3 s. What
changed is the distance at which that happens, not that it happens. Whether 1.2
units of separation is enough to read as a fight is exactly what the eye has to
answer here.

The hoplomachus' own measure: 26.7% of ticks inside 2.4–3.1 (was 15.9%), but
still closed down below it 50.1% of the time overall and **82.0% against a
murmillo**. Question 2 is whether the improvement is visible or merely
statistical.

## Known, reported, not fixed

- **Safe area at 1024×768 fails on six of nine pairings.** The pair can spread
  wider than the old arena allowed, so a fighter leaves the 5% canvas inset for
  16–62 ticks depending on the pairing. The 130 px body-height floor still
  clears with 12–41% of margin everywhere. Pulling `FLAT_DISTANCE` back to 9.2
  was tried and does not fix it; the remaining levers are the swept framing pair
  that `ArenaCamera.ts` says wants its own slice. Question 7 is whether it is
  visible at all.
- **`MISS_REACH.technical`** (where a miss puff is placed for the hoplomachus)
  is probably ~0.05 too far after the spear re-grip. It is capped by the actual
  separation in use, so the puff cannot land past the opponent; the effect is a
  puff slightly further out than the spear really reached.
- **Trace 04's band-edge crossings went 1 → 5.** The camera visits the flat
  region's boundary more often than it did, because the arena grew while the
  flat region is sized by the widest pairing. Not chatter by the harness's own
  ceiling, but the margin is thinner than it was.

## Open questions the specs left for the owner

Decided by default in the implementation; this is the pass where they get a real
answer.

1. **Blood spray life, 420 ms.** The spec offered ≤360 ms as the alternative.
   Too long? Too short?
2. **Damage digits under the battle-status heading.** They paint there rather
   than over the arena's own chrome. Right place?
3. **The killing blow's number lingers between bouts** — the result panel comes
   up while the number is still fading. Deliberate; keep?
4. **"Two-handed reach" reads as amplitude** with the buckler kept in hand: the
   hoplomachus never actually puts his second hand on the shaft.
5. **The Barbarian's fur kilt stands in for a loincloth.** Acceptable, or does it
   want its own mesh?

## Verdicts

The owner's pass, 2026-09-20, live build at `npm run dev`, seed 20260815,
×1 through ×4.

| # | question | verdict |
|---|---|---|
| 1 | slipping together | «бывает, но реже. Когда с трезубцем чуваку нужно рвать дистанцию он упирается спиной в границу и часто не может» |
| 2 | hoplomachus making room | «пытаются, но есть что улучшить» |
| 3 | hit / block / miss without the HUD | «стали нормальные цифры выводиться, по ним понятно. По удару — почти всегда» |
| 4 | how much it cost | «нормально» |
| 5 | murmillo reads as a gladiator | «шлем очень странный с каким-то гребешком. Тут бы посмотреть на шлемы гладиаторов» |
| 6 | the spear lands | «вроде нормально» |
| 7 | cropping at a narrow window | «если свернуть а потом развернуть то арена не возвращается к исходной» |
| 8 | anything worse | «в целом ок. Единственное что арт самих гладиаторов как-то ушёл от задумки изначальной. Хотелось более естественных тел» |
| 9 | spray life 420 ms | «брызги не очень хорошо видно. В половине раз как будто не появляются. Можно чуть ярче и чуть дольше» |
| 10 | digits under the status heading | «нормально» |
| 11 | killing blow's number lingers | «ок» |
| 12 | two-handed reach as amplitude | «пока ок» |
| 13 | fur kilt for a loincloth | «пока ок» |

New asks, outside the checklist:

> Ещё неясно зачем нужен щит. Как будто хочется механику эвейда и блока — тем
> у кого есть щит с разной анимацией.

> Ну потом бы прикрутить разные статы и скилы, чтобы разные гладиаторы
> по-разному читались. Ну и массовые бои потом.

## Finding 1 — the retiarius fights with his back to the wall for half the bout

The clinch is gone and the owner says so, but the thing that replaced it is
worse to watch: the retiarius, whose whole game is distance, spends most of a
murmillo bout unable to take any.

Measured over all nine pairings, 20 seeds each, every tick. "At the edge" is
within 0.35 of `DUEL_RADIUS` 7.5 or `DUEL_LATERAL_LIMIT` 3.3; "backing" is a
`backstep` or `disengage` locomotion intent.

| pairing | who | % of bout at the edge | % of its backing done AT the edge |
|---|---|---:|---:|
| brutus (murmillo) vs drusus (retiarius) | retiarius | **51.5%** | **50.9%** |
| | murmillo | 1.2% | — |
| aquila (retiarius) vs magnus (murmillo) | retiarius | **58.4%** | **62.7%** |
| | murmillo | 0.6% | — |
| nerva (hoplomachus) vs drusus (retiarius) | retiarius | 23.5% | 40.2% |
| aquila (retiarius) vs cassius (hoplomachus) | retiarius | 23.1% | 43.3% |
| brutus vs cassius | hoplomachus | 17.9% | 27.2% |
| nerva vs magnus | hoplomachus | 15.9% | 24.0% |
| aquila vs drusus | both retiarii | 6–8% | 7–18% |
| nerva vs cassius | both hoplomachi | 3–6% | 0% |

Read the second column against the third. Against a murmillo the retiarius is
on the boundary for **more than half the bout**, and when he decides to back
away, **half to two-thirds of that decision is spent already against the wall**
— the intent fires, the movement has nowhere to go, and what the eye sees is a
man pressed to the edge being worked over. The murmillo is at the edge 0.6–1.2%
of the same bouts: he is the one doing the pushing, and nothing pushes him back.

The fighting-room slice moved every separation outward by 0.30 and grew the
arena's radius by 1.0 (6.5 → 7.5) to pay for it. That was sized against the
CLINCH, and it fixed the clinch. It was not sized against the retiarius' own
authored range (`preferredRange` 2.7–3.3, the widest in the roster) plus a
murmillo advancing on him: the pair needs room for his preferred separation AND
his retreat AND the murmillo's approach, and 7.5 does not have it.

Levers, in the order they should be tried: the arena radius again (cheapest,
and the same instrument measures it); a boundary-aware disengage that turns
along the wall instead of into it (`selectEvadeDirection` already knows about
arena boundaries for evades — `disengage` does not); or a ring rather than an
ellipse, so there is no short axis to be pinned against. This is its own slice.

## Finding 2 — the spray is short because effect life is simulation time, not wall time

"В половине раз как будто не появляются" is not about brightness, and it is not
about blocked hits: over the same 4,239 `damage-dealt` events across the roster,
only **284 (6.7%)** are blocked, and those are the only hits that deliberately
show a shield spark instead of blood.

The actual mechanism: `ArenaView` drives every effect off
`presentationMs = encounter.tick * MS_PER_TICK` — SIMULATION time. The speed
control multiplies ticks per real second, so it divides every effect's wall-clock
life by the same factor:

| speed | spray life, wall clock | at full opacity (`SPRAY_HOLD_FRACTION` 0.45) |
|---|---:|---:|
| ×1 | 420 ms | 189 ms |
| ×2 | 210 ms | 95 ms |
| ×4 | **105 ms** | **47 ms — about 3 frames** |

The owner watched at ×4. Three frames at full opacity is below what the eye
reliably catches, which is exactly the reported symptom, and it applies to every
channel: the sand puff (220 ms) is 55 ms at ×4, the shield and weapon sparks
(260 ms) are 65 ms.

Two levers, and they are not equivalent:

- **Brighter and longer, as asked.** `SPRAY_PEAK_OPACITY` 0.92 and
  `FLASH_DURATION_MS.body` 420 are one-line changes and they help at every
  speed. They do not remove the ×4 divisor, they only move where it bites.
- **Make effect life wall-clock.** The principled fix — an effect is a thing the
  eye must catch, so it should be measured in the eye's time. But the tick-driven
  clock is precisely what makes `combat-visuals.spec.ts`'s frozen frames
  reproducible: `advanceToCaptureTick` can place a spray at age 0 because age is
  a function of the tick. A wall-clock life would need those fixtures re-founded
  on a clock the test can hold still.

Recommend the first now (it is what was asked for and it is safe), and the second
as its own slice with the fixture question answered first.

## Finding 3 — the arena never comes back after a minimise (fixed here)

Reproduced, root-caused and fixed in this commit; the repro is now
`smoke.spec.ts`'s "the arena comes back to its own size after the window shrinks
and is restored".

`.arena` has no definite height — only `min-height: 520px` — so `height: 100%`
on an in-flow canvas does not resolve and falls back to the canvas's INTRINSIC
size, which is its `width`/`height` attributes. `ArenaView.resize()` writes those
attributes from the element's measured box. That is a loop: any reflow that
leaves the row height indefinite for a frame lets the canvas take its own aspect
ratio, grow `.arena` to match, and have the next `resize()` write a buffer at the
new ratio — which then holds it there.

Measured: 730×518 before, **730×691 after one shrink-and-restore cycle**, and
stable at 691 on every cycle after. Not a ratchet, but it never returns. With
the HP cards sized to the old row it pushes them below the fold, which is what
the owner's screenshot shows.

The fix is `position: absolute; inset: 0` on the canvas — `.arena` is already
`position: relative`, so taking the canvas out of flow breaks the loop at its
first link and the row goes back to being sized by the HP cards.

## Finding 4 — the galea, and the bodies

Two art notes, neither of them a defect, both for the next art pass:

- **«Шлем очень странный с каким-то гребешком».** The galea is four primitives:
  a dome, a cone, a brim 1.72 wide and a low dark crest. At the shipped camera
  the brim hides the dome from above, so what reads is a wide flat hat with a
  ridge on it. The brim width is the number to attack — it was sized to be
  visible in silhouette at 130 px, and it overshot into hat territory. Real
  murmillo helmets are a tall rounded bowl with a broad angled brim and a
  substantial fin-like crest; the reference the owner asks for belongs in
  `docs/reference/gladiator-equipment.md` beside the existing rows.
- **«Арт ушёл от задумки, хотелось более естественных тел».** The KayKit
  Adventurers pack is chibi by construction — large heads, short limbs. That was
  accepted when the pack was chosen (PR #25) as the cost of a rigged CC0 set with
  clips; it is not something this slice moved. Changing it means a different pack
  or authored bodies, which is a track, not a slice.

## Backlog from this pass

Not scheduled here, recorded so they are not lost:

1. **The shield needs a reason to exist.** The owner wants block and evade as
   distinct mechanics with distinct animations, split by who carries a shield.
   Today `heavy-guard` blocks, `fast-evade` dodges and `technical-parry` parries
   — the mechanics exist per archetype, but the shield is not what decides, and
   the animations do not read as different answers to the same blow.
2. **Per-gladiator stats and skills**, so two fighters of one type read
   differently.
3. **Mass battles.**
