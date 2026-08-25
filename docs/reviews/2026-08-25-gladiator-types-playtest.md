# Gladiator types — playtest, 2026-08-25

**Slice:** readable gladiator types (PR #15). Names, silhouettes and framing
changed; behaviour unchanged, proved by the per-tick state hash, `dc635911`,
the render-frame freeze and the allowlist gate.

**Reviewer:** Andrey, informal single-reviewer pass on the live build.

## Verdict on the slice's own question

> «бой стал лучше читаться, классы отличаются и узнаются»

The slice's premise holds: the bottleneck was perception. The same behaviour,
presented differently, became readable — which is exactly the outcome the
no-behaviour-change invariant was built to make attributable.

## The finding the slice surfaced

Once the fight read, the reviewer immediately saw a rules problem that had
been there all along and was previously invisible:

> «дистанция удара осталась у всех одинаковая — даже с копьём и трезубцем
> нужно подойти вплотную чтобы ударить. И не всегда с длинным оружием бойцы
> рвут дистанцию»

Measured against `src/content/combatStyles.ts` and `ProceduralFighter.ts`:

| Type | Drawn weapon | Attack reach (max) | `preferredRange` |
|---|---|---|---|
| Murmillo (`heavy`) | gladius **0.55** | **1.8** (`heavy-cleave`) | 1.2–1.7 |
| Retiarius (`fast`) | trident **1.15** | **1.45** (`fast-burst-lunge`) | **2.4–3.0** |
| Hoplomachus (`technical`) | spear **1.30** | **3.1** (`technical-driving-thrust`) | 2.1–2.8 |

The reviewer is half right, and the half that is right is worse than stated:

- **The spear is genuinely long.** The hoplomachus strikes from 3.1, nearly
  twice the murmillo's reach, and is internally coherent: long weapon, long
  attacks, holds outside.
- **The retiarius has the shortest attack reach in the game — 1.45.** That is
  *shorter than the murmillo's 1.8*, so the fighter carrying a trident must
  step inside the reach of the fighter carrying a short sword.
- **The retiarius' two range numbers contradict each other.** It holds
  2.4–3.0, from which it physically cannot attack, then dives to ≤1.45 and
  withdraws. That oscillation is what reads as "doesn't commit to its range".

### This also undermines the type choice's stated justification

The design spec picked Retiarius over Dimachaerus for `fast` on the grounds
that "`fast` holds the *longest* preferred range of the three (2.4-3.0) and
retreats most — reach-and-give-ground, not in-and-out brawling"
(`docs/superpowers/specs/2026-08-23-readable-gladiator-types-design.md`,
"The three types"). That is true of `preferredRange` and false of attack
reach. The argument rests on half the data: `fast`'s *attack* numbers describe
a short-weapon hit-and-run fighter, which is the reading the spec explicitly
rejected.

## Decision

**Option 1: bring the rules up to the equipment.** Give the retiarius attack
ranges that match a trident — roughly 2.0–2.6 — so "fights at reach, gives
ground, closes only to strike" becomes true rather than aspirational. The type
choice stands; the numbers move.

Rejected alternative, recorded for completeness: re-open the type choice and
keep `fast`'s numbers. Not taken — the equipment is the historical claim and
it is already drawn, authored and baselined.

**This is a behaviour change** and therefore a separate slice. It will move
`dc635911`, the nine per-tick state digests, `encounterCapacity`'s hash, the
key-pose ticks, the balance cohorts and the golden season — all of which the
readable-types slice deliberately froze. Expect to re-baseline all of them,
and expect the counter triangle and balance cohorts to need re-tuning, since
changing one type's effective reach changes every matchup it appears in.

## Carried forward from the readable-types slice

Items that outlive that slice's workspace and bear on what comes next.

- **The arena canvas is 730×518 inside a 1280×820 page**, with dead floor
  below the action, and the 130 px body floor is 25% of a 518 px canvas.
  Growing it needs `src/style.css`, which the slice's allowlist forbade. The
  final review names this as the largest remaining lever on legibility per
  unit of risk — larger than further prop authoring.
- **Trident and spear do not separate at the shipped framing** (the fork
  resolves at ~2×). Today the hoplomachus is identified mainly by its two
  greave bands. Note this interacts with the decision above: giving the
  retiarius real reach makes the *behaviour* separate the pair even while the
  silhouette does not.
- **The screenshot comparator cannot discriminate arena frames.** Two adjacent
  ticks of one bout measure 1.44–3.60% against a 4% bar, which let four
  baselines pass while showing pre-slice frames. Recorded in
  `playwright.config.ts`; the remedy is structural comparison, not a tuned
  ratio. The debug snapshot already exposes projected per-fighter bounds.
- **The CI allowlist step is slice-scoped.** `scripts/check-allowlist.sh`
  lists the paths *the readable-types slice* was allowed to touch, and
  `.github/workflows/ci.yml` now runs it first on every PR. **A slice that
  legitimately edits `src/simulation/**` — including this one — must widen or
  remove that step before its first PR.**
- **Camera return residue.** After a wide excursion the sticky extent dead
  zone leaves a residue whose structural ceiling is 0.3554 ≈ −3.88% of
  on-screen body height, against a +2.25% floor margin. Zero-impact today
  because bouts close monotonically. Any change that makes fighters separate
  and re-close within a bout must read `ArenaCamera.test.ts`'s "framing
  distance under motion" first.
- **The amended floor criterion is weaker than its wording.** `130 px at p92`
  guarantees only that the top ~8% of in-band frames clear the floor; 29.9%
  fall below it, and the +2.25% margin sits inside the metric's own ~4 px
  upward bias. The ≥3% margin the criterion was defined with was measured
  unreachable jointly with a resolvable safe-area margin.
