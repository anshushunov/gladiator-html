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

_(filled in after the pass; the instrumented follow-up on each finding goes
below, one section per finding, in the style of the 2026-09-05 report)_
