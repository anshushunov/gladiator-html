# Hit and miss feedback — Design

**Status:** as built, 2026-09-17 (proposed the same day). Item 3 of the 2026-09-05 playtest's "Proposed
next slice" (`docs/reviews/2026-09-05-skinned-gladiators-playtest.md`, Finding 3).
Branch `feature/hit-miss-feedback`.

**Owner's request, verbatim (the only direct statement on this track):**

> Хочется улучшения анимации получения урона и ударов. Может быть цифры урона?
> или кровь вместо точки красной? Как-то более явно показывать промах или
> звуком это артикулировать.

**Decisions this spec takes on the owner's behalf** (each is also listed under
§10 with the alternative it beat):

- Blood replaces the body-zone dot; the shield ring and the weapon spark stay.
- A miss gets a sand puff on the ground where the swing ended, plus its own
  audio cue after contact. An evaded attack gets the same two, because from
  the attacker's side it is the same thing: steel through air.
- Damage numbers are DOM text over the arena, placed from the simulation's
  own contact point, aged on the encounter tick like everything else.
- Critical hits, which today are invisible outside the feed, get the larger
  spray and the larger gold number. Nothing else about them changes.

**Taste anchor.** Domina (2019), per `docs/research/2026-08-23-order-legibility-references.md`
§1: hits land as events, a swing has weight. Every number below is chosen so
the effect reads at the fighters' shipped size (146–165 px body height at
1280x820) and is gone before the next exchange; nothing is tuned to look
exciting on its own.

---

## 1. Player hypothesis

**A viewer watching and listening at ×1 with the HP cards and the battle
feed hidden can say, for every exchange, whether the swing hit, was blocked,
or missed, and roughly how much a hit cost — from the arena alone.**

One hypothesis, one PR (AGENTS.md). It has two independently falsifiable
halves — *outcome* legibility (hit / blocked / missed; spray, ring, puff,
`weapon-miss`) and *cost* legibility ("roughly how much"; the number) — and
the playtest report says which half failed if either does, rather than
scoring the sentence as a whole. The 2026-08-16 spec's player-facing
acceptance already asks for "distinguish a hit, block, evade, parry, stagger,
and defeat" with the HUD hidden; today a miss is undistinguishable from a hit
until the victim does or does not stagger, and a hit's cost lives only in the
feed.

## 2. Scope

### 2.1 What changes

- `src/presentation/ArenaView.ts` — the contact-effect pool gains per-kind
  visuals (blood spray for `body`, sand puff for `miss`), a direction for the
  spray, and the `miss` kind; `processNewEvents` gains branches for
  `attack-missed`, `attack-evaded`, `critical-hit` and hands `damage-dealt`
  to the damage-number overlay.
- `src/presentation/DamageNumbers.ts` (new) — a pool of six DOM `<span>`s
  over the arena, positioned per frame by projecting a world point through
  the live camera; pure layout helpers in the same module.
- `src/presentation/CombatAudio.ts` — one new cue, `weapon-miss`, mapped from
  `attack-missed` and `attack-evaded`.
- `src/style.css` — the overlay's rules.
- `ArenaDebugSnapshot` — one new field, `activeDamageNumbers`.
- Tests and baselines per §8, including the `advanceToCaptureTick` helper
  in `tests/combat-visuals.spec.ts` (§8.3).
- `README.md` — one paragraph in the presentation section naming the four
  feedback channels (spray, puff, number, miss cue).

### 2.2 What does not change

- **`src/simulation/` is not touched.** Every event this slice reacts to
  already exists (`encounter.ts` lines 410–479): `attack-missed`,
  `attack-evaded`, `critical-hit`, `damage-dealt` with `amount`,
  `contactZone`, `contactPoint`. The three frozen trace hashes stay as they
  are without edits.
- **Presentation re-derives no rule.** The spray's direction is
  `target.position − actor.position` read from the state the event names;
  the number is `event.amount`; whether a hit was blocked or critical is read
  off the paired `attack-blocked` / `critical-hit` event in the same batch,
  exactly as the feed and the existing dedupe do. Nothing multiplies, rolls
  or compares.
- `battleFeed.ts`, its strings and its eight-line cap. The feed remains the
  text record; the number is the in-playback channel.
- `clipMapping.ts`: `Hit_A` stays keyed off `staggerUntilTick`. A hit that
  does not stagger is shown by spray and number only.
- The shield ring and the weapon spark: geometry, colour, height, 260 ms
  life, two slots.
- `ArenaCamera.ts`: no nudge, no shake, no cut (2026-08-16 spec, "Camera
  does not ... cut, or shake").
- The HP cards: no delta animation, no flash.
- The nine existing cues, the whoosh timing (first tick of windup), the
  ×4 whitelist's existing members, the eight-voice cap.
- The `?snapshot`/tick-time discipline: every new effect ages on
  `current.encounter.tick * MS_PER_TICK`, never on the wall clock.

**Amendment to earlier non-goals.** The 2026-08-16 spec lists "Blood, gore
... particles" and the 2026-09-04 spec lists "blood, or any effect beyond
what already exists" as non-goals. This spec supersedes those two lines for
blood only, and only in this form: a bounded, pooled, two-slot mesh effect on
the existing contact-effect pool. Gore, dismemberment, decals that persist,
and a standalone particle system stay non-goals.

## 3. The event → feedback table, after this slice

| event | 3D | DOM | audio | changed here |
|---|---|---|---|---|
| `action-started` | trail (pose-driven) | — | whoosh light/heavy | no |
| `attack-missed` | **sand puff** at the swing's end | — | **`weapon-miss`** | yes |
| `attack-evaded` | **sand puff** at the swing's end | — | **`weapon-miss`** | yes |
| `attack-blocked` (+ paired `damage-dealt`, zone `shield`) | shield ring | **number, `shield` style** | `shield-block` | number only |
| `attack-parried` | weapon spark | — | `weapon-parry` | no |
| `critical-hit` (+ paired `damage-dealt`) | **spray ×1.4** | **number, `critical` style** | `body-hit` | yes |
| `damage-dealt`, zone `body`, unpaired | **blood spray** | **number, `body` style** | `body-hit` | yes |
| `fighter-staggered` | `Hit_A` | — | `stagger` | no |
| `fighter-defeated` | `Death_A` | — | `defeat` | no |
| `defense-declined`, `defense-failed`, `action-interrupted` | — | — | — | no (still) |

The paired rows use the batch-local `blockedInstanceIds` discipline that
already exists in `ArenaView.processNewEvents` and `CombatAudio.handleEvent`;
`critical-hit` gets a sibling set, `criticalInstanceIds`, filled the same way.
`encounter.ts` emits `critical-hit` and `attack-blocked` immediately before
their `damage-dealt`, same tick, so the pair is never split across batches
(the comment at `ArenaView.ts` line 919 records why this holds).

## 4. Blood spray (replaces the body dot)

### 4.1 Geometry and placement

- One `THREE.BufferGeometry` per pool, built once in the constructor: seven
  droplets, each `THREE.SphereGeometry(r, 5, 4)` translated into place and
  merged into one geometry with `mergeGeometries` from
  `three/examples/jsm/utils/BufferGeometryUtils.js` (present in the shipped
  three `0.179.1`; `stateHash.test.ts` mocks only the bare `three` module,
  lines 19–30, so this jsm import stays real there and must not be
  hand-rolled). Authored in local space along **+Z** (the spray axis):

  | droplet | local (x, y, z) | radius |
  |---|---|---|
  | core | (0, 0, 0.06) | 0.070 |
  | 2 | (0.05, 0.03, 0.18) | 0.055 |
  | 3 | (−0.06, −0.02, 0.22) | 0.050 |
  | 4 | (0.02, 0.07, 0.31) | 0.045 |
  | 5 | (−0.03, −0.06, 0.36) | 0.045 |
  | 6 | (0.08, 0.01, 0.44) | 0.040 |
  | 7 | (−0.05, 0.05, 0.52) | 0.038 |

  Total extent 0.55 units along +Z (about 41 px at the shipped 75 px/unit),
  0.16 across. The old dot was a 0.14-radius sphere (21 px). The spray is
  longer, thinner and directional, so it reads as "something came out of him
  that way" rather than "a marker appeared".
- Material: `MeshBasicMaterial`, colour **`0x8e1b21`** (dark arterial red;
  the ring is `0xe8c876` gold, the spark `0xe7ecf5` white, so the three
  zones still differ in shape *and* colour), `transparent`, `depthWrite:
  false`, `DoubleSide`, `frustumCulled = false` — identical flags to today's
  slots.
- Position: `event.contactPoint` at height **`CONTACT_ZONE_HEIGHT.body =
  1.05`** (unchanged). The contact point is simulation-owned (`actor.position
  + towardTarget × distance × 0.72`); presentation adds only the authored
  height, per the 2026-08-16 spec's contact contract.
- Orientation: `mesh.lookAt(position + direction)` where `direction =
  normalize(target.position − actor.position)` read from
  `current.encounter.combatants` for the event's `actorId`/`targetId`; if the
  two positions coincide, `direction = (0, 0, 1)`. The spray points **away
  from the attacker, through the victim** — the direction the blow travelled.
  (`processNewEvents` gains a `current: BattleState` parameter for this; it
  already receives `events` from the same frame.)
- Critical: `mesh.scale` base is **1.4** instead of 1.0 when the batch
  already carried a `critical-hit` for the same `actionInstanceId`.

### 4.2 Life

`FLASH_DURATION_MS` becomes per kind: **body 420 ms**, shield 260, weapon
260, miss 220 (all presentation ms = ticks × 1000/60, so 25.2 ticks for the
spray at any speed). 420 ms is deliberately *longer* than the fastest
back-to-back repeat of the fastest attack: `fast-slash` is windup 10 +
impact 2 + recovery 10 = 22 ticks = 367 ms (`src/content/combatStyles.ts`
lines 137–139), so one attacker landing twice in a row overlaps his own
sprays by about 3 ticks. That overlap is what the second slot is for, not
luck: the worst case the kernel can produce inside one 25-tick spray life is
both fighters landing on the same tick (the trace has such ticks, e.g.
735/767/799 in `nerva vs cassius`) and then both landing again 22 ticks
later — four sprays, two slots. The round-robin then recycles the two
22-tick-old sprays, which by that point are at t = 0.87 of their life and
opacity ≈ 0.22 (the fade below), so what is cut short is a spray already
almost gone. A shorter life (≤ 360 ms) would make the single-attacker case
non-overlapping but would not change the two-attacker case, and it would
lose the hold that makes the spray read (below); 420 stays.

Per frame, with `t = age / 420` clamped to 0..1 (`update(presentationMs)`):

- scale along the spray axis: `s(t) = 0.45 + 0.55 × (1 − (1 − t)^2)` — the
  spray shoots out in the first ~120 ms and holds its length; multiplied by
  the critical base scale.
- drop: `mesh.position.y = 1.05 − 0.22 × t^2` — gravity, 0.22 units by the
  end.
- opacity: `0.92` for `t < 0.45`, then linear to `0` at `t = 1`. (The old
  dot faded linearly from 0.85 from the first frame; the hold is what makes
  the spray read as a thing that happened rather than a flicker.)

### 4.3 Pool and ids

Same `ContactFlashEffects` class, generalised: `FlashKind = ContactZone |
'miss'`, `FLASH_SLOTS_PER_KIND = 2`, round-robin per kind, id
`${kind}-${serial}`. The `body-` prefix is kept for the spray, so
`tests/combat-visuals.spec.ts` line 550 (`body-` live at tick 232) is
unchanged and now guards the spray. `clear()`, `activeEffectIds()`,
`dispose()` cover the new kind automatically because they iterate all kinds.

Reduced motion (`prefers-reduced-motion: reduce`): spray and puff are not
spawned, exactly as the flashes today (2026-08-16: "transient contact
flashes are disabled"). The number is the reduced-motion hit channel (§6.4).

## 5. Sand puff (the miss)

### 5.1 Why a puff on the ground

`attack-missed` and `attack-evaded` carry no contact point, so the effect
has to come from state. The one thing every miss has in common, whatever
the reason (`accuracy`, `geometry`, `target-unavailable`), is that the weapon
ended its swing with nothing in it. A ground-level puff of sand at the end of
the swing line is the arena's own idiom for that, it can never be confused
with any of the three on-body contact effects (all of which sit at 1.05–1.30
units), and it does not need to know *why* the miss happened.

### 5.2 Placement

- `towardTarget = normalize(target.position − actor.position)` from
  `current.encounter.combatants`; `(0, 0, 1)` if coincident.
- `reach = clamp(|target.position − actor.position| − 0.25, 0.6,
  MISS_REACH[actor archetype])`.
- point `= actor.position + towardTarget × reach`, at **y = 0.03**.
- `MISS_REACH` is an authored presentation table, the same discipline as
  `CONTACT_ZONE_HEIGHT`: the horizontal distance from the root at which the
  pack clip's `weaponTip` sits on the strike frame. Starting values:
  **`{ heavy: 1.15, fast: 1.85, technical: 1.75 }`**. Task 3 measures
  `weaponTip`'s world distance from `root` at `contactAt` for each attack
  clip (one `advanceTicks` to a windup-end tick, read the anchor via a
  temporary debug print), takes the per-archetype median across that
  archetype's attacks, rounds to 0.05, and writes the measured values into
  the table with the measurement in the commit message. The starting values
  are what ships only if the measurement is within 0.10 of them.
  *As built:* the measurement (task 3, `eb573eb`) gave `{ heavy: 1.05,
  fast: 1.70, technical: 2.50 }` — fast (−0.15) and technical (+0.75) were
  outside the tolerance, so the measured values ship; the per-clip figures
  are in the `MISS_REACH` doc comment.

  Not `weaponTip`'s live world position: `processNewEvents` runs before this
  frame's clip is applied, and after an `advanceTicks` burst the last drawn
  pose belongs to a tick hundreds of ticks earlier, so the anchor would be
  wherever the arm last was. The pose is a function of the drawn frame; the
  puff should be a function of the tick.

  **Accepted approximation.** The positions above are read from
  `current.encounter.combatants`, i.e. the *frame's* tick, not the event's:
  `attack-missed`/`attack-evaded` carry no `contactPoint` (`encounter.ts`
  lines 410–430) and no per-tick position history exists without touching
  simulation, which §2.2 forbids. In real playback a batch is the ticks
  since the last render (one to a few ticks at ×1–×4; `main.ts`
  `flushRenderBatch`), so the drift is at most a few ticks of walking. Under
  a test burst the drift is the whole burst (the evade at t=274 in bout 0 is
  placed from tick-430 positions in the §8.2 miss checkpoint's batch); that
  is accepted, and the miss checkpoint asserts presence and kind only, never
  the puff's position.

### 5.3 Geometry and life

- `THREE.RingGeometry(0.06, 0.16, 12)`, `rotation.x = −π/2` (flat on the
  floor), colour **`0xd9c29a`** (dry sand, lighter than the floor's
  `0x8a6845`), same material flags as the other slots.
- Life **220 ms** (13 ticks). `t = age / 220`: uniform scale `1 + 1.4 × (1 −
  (1 − t)^2)` (0.16 → 0.38 outer radius, about 12 → 29 px), opacity `0.7 ×
  (1 − t)`.
- Kind `'miss'`, ids `miss-N`, two slots (a miss cannot repeat faster than
  the fastest attack either).

## 6. Damage numbers

### 6.1 Where they live

A `<div class="arena__numbers" aria-hidden="true">` inserted by `ArenaView`'s
constructor into `canvas.parentElement` **directly after the canvas**
(`parent.insertBefore(overlay, canvas.nextSibling)`) — and only when
`canvas.parentElement` exists, mirroring `showFallback` (`ArenaView.ts`
lines 1119–1122). `stateHash.test.ts` (lines 122–132) constructs `ArenaView`
in plain Node with a fake canvas that has no `parentElement` and no
`document` global at all: on that path **no `document.*` call is made**,
neither the `<div>` nor any `<span>` is created, and the pool below is an
entries-only pool (spawn, age, expire, snapshot) whose DOM binding is
simply `undefined`. Anything that would touch `document` outside the
`parentElement` guard turns the fast unit suite into a `ReferenceError`.

CSS: `position: absolute; inset: 0; pointer-events: none; z-index: 1;
overflow: hidden` — inside `.arena`, which is already `position: relative;
overflow: hidden`. Intended stacking, top to bottom: the WebGL fallback
(`z-index: 2`), then `.arena__status` (the live battle-status heading,
`z-index: 1`, `style.css` lines 544–546), then this overlay (`z-index: 1`
but *earlier in tree order* — inserted right after the canvas, before the
`<h2>` that `index.html` places after it), then the `.arena::after`
vignette, then the canvas. So a digit that rises under the status heading is
painted *beneath* the heading's text, and nothing dims the digits. It is
**not** a second `<canvas>` (eight strict-mode `page.locator('canvas')` sites
in `smoke.spec.ts` would break) and it is inside `#battle-ui`, which
`SeriesView` hides in planning/summary, so `planning.png` and
`season-board.png` cannot move.

Six `<span class="arena__damage" data-testid="damage-number" hidden>` are
created once, together with the `<div>`. Never more than six live at once; a
seventh recycles the oldest. Nothing is created per event.

### 6.2 Data model (`DamageNumbers.ts`)

```ts
export type DamageNumberKind = 'body' | 'shield' | 'critical'
export interface DamageNumberEntry {
  id: string            // `dmg-${serial}`
  amount: number        // event.amount, verbatim
  kind: DamageNumberKind
  worldX: number; worldZ: number   // event.contactPoint
  spawnedAtPresentationMs: number
  lateral: -1 | 1       // alternates by serial parity, see 6.3
}
export const DAMAGE_NUMBER_LIFE_MS = 900
export const DAMAGE_NUMBER_HEIGHT = 1.55        // world units above the contact point
export const DAMAGE_NUMBER_RISE_PX = 38
export const DAMAGE_NUMBER_LATERAL_PX = 12
export function layoutDamageNumber(ageMs: number, reducedMotion: boolean): { risePx: number; opacity: number } | null
export function classifyDamage(event: DamageDealtEvent, blocked: boolean, critical: boolean): DamageNumberKind
```

`classifyDamage`: `critical` if the batch paired a `critical-hit`; else
`shield` if `event.contactZone === 'shield'` (blocked chip damage — the
feed's "blocks but takes N"); else `body`. The kernel never produces a hit
that is both: `encounter.ts` line 2222 sets `isCritical = !blocked && …` and
lines 2236–2259 emit `critical-hit` *or* `attack-blocked`, never both, so
the `critical`-first ordering is a defensive choice for a state the
simulation cannot emit, not a rule with a reachable case; the unit test
covers the three reachable inputs only (§8.1). Both helpers are pure and get
a unit test.

`layoutDamageNumber` with `t = ageMs / 900`: returns `null` once `t ≥ 1`;
`risePx = 38 × (1 − (1 − t)^2)` (ease-out; `0` under reduced motion);
`opacity = 1` for `t < 0.55`, then linear to `0` at `t = 1`.

### 6.3 Placement per frame

A private `placeDamageNumbers(presentationMs)` runs after every direct
`renderer.render` (so the camera's matrices are the ones just drawn): at the
end of `applyFrame`, and at the end of the dev-only `settleCameraSeconds`
(`ArenaView.ts` lines 675–684 render directly without going through
`applyFrame`; `captureFrame` does follow it with `renderActiveBattleAtAlpha(1)`,
but the placement is tied to the render, not to the caller's discipline).
For each live entry: project `(worldX, 1.55, worldZ)` with the existing
`projectToCanvasPx` (moved out of the debug-only section into a shared
helper; it is a pure function of camera and canvas size), then
`left = x + lateral × 12`, `top = y − risePx`. Two hits inside 900 ms at the
same spot therefore sit 24 px apart instead of on top of each other. The
element is `hidden` when the entry is dead. Using `transform: translate(-50%,
-50%) translate(left, top)` and `opacity` — two composited properties, no
layout per frame.

1.55 is the authored height: chest contact at 1.05, head top at ~2.0 on the
2.0-unit rig; 1.55 sits between the shoulders and the crown, so the number
starts over the torso and rises past the head, never over the face.

### 6.4 Style

`.arena__damage`: `position: absolute; font: 700 22px/1 Inter, ...` (the
page's body stack), `font-variant-numeric: tabular-nums; letter-spacing:
0.02em; text-shadow: 0 1px 0 #000, 0 0 6px rgba(0,0,0,0.85);
will-change: transform, opacity`. Colours by kind (attribute
`data-kind`):

| kind | colour | size |
|---|---|---|
| `body` | `#f3e9d8` (bone white) | 22 px |
| `shield` | `#b9ae9c` (dull tan, the "it cost him less" reading) | 18 px |
| `critical` | `#e8c876` (the HUD's gold) | 30 px |

Digits only — no words. `tests/legibility.spec.ts`'s naming test scans
`body.innerText` for `Heavy|Fast|Technical` on every phase, and digits cannot
trip it. The overlay is `aria-hidden`; the feed remains the accessible
record.

**Reduced motion:** numbers are still spawned, do not rise (`risePx = 0`),
and fade exactly as above. This is deliberate: under reduced motion the
spray, puff and trail are all off, so without the number a reduced-motion
viewer has no hit feedback beyond the HP bar. A number that appears and
fades in place is not motion in the sense the preference means.

**Pause and between-bouts:** `presentationMs` does not advance, so a live
number freezes where it is — the same behaviour the flash has today (the
killing-blow flash sits at full opacity through the between-bouts panel).
The last number of a bout therefore stays over the fallen man until
`clearBout`. That is the outcome the viewer most wants to read, and it is
consistent; it is not a bug.

### 6.5 Lifecycle

`clear()` on `startBout` and `clearBout` (next to `flashes.clear()`),
`dispose()` removes the overlay element on `ArenaView.dispose()` and on
`handleContextLost` (which already hides the canvas and shows the fallback;
a dead arena must not keep floating numbers). Spawned only from
`processNewEvents`, past the cursor, so the alpha-replay invariant holds for
numbers the way it holds for flashes.

### 6.6 Debug surface

`ArenaDebugSnapshot.activeDamageNumbers: readonly { id: string; amount:
number; kind: DamageNumberKind }[]` — the live entries in spawn order.
Separate from `activeEffectIds` on purpose: five existing assertions give
`activeEffectIds` the meaning "transient 3D effects, empty under reduced
motion", and numbers are neither.

## 7. Audio: `weapon-miss`

- `CombatCue` gains `'weapon-miss'`; `ALL_COMBAT_CUES` lists it after
  `'weapon-whoosh-heavy'`; `CUE_BASE_FREQUENCY_HZ['weapon-miss'] = 600`,
  `CUE_DURATION_MS['weapon-miss'] = 170`.
- `handleEvent`: `attack-missed` and `attack-evaded` → `tryPlay('weapon-miss',
  event.id, input)`. Both fire on the contact tick, after the whoosh that
  fired on the first windup tick — so the ear gets "swing … nothing" where a
  hit gets "swing … thud". A different swing sound was rejected because the
  outcome is not known at windup (§10).
- Synthesis, stated as the exact branches of `playVoice`
  (`CombatAudio.ts` lines 546–567 today):
  - `'weapon-miss'` **is added to `NOISE_BASED_CUES`** (line 433) — it is a
    noise cue, and membership is what makes the existing oscillator
    condition at line 558, `!NOISE_BASED_CUES.has(cue) || cue === 'body-hit'`,
    evaluate to `false` for it. Line 558 is **not edited**. (The whooshes
    skip the oscillator for the same reason: they are *in* the set.)
  - A new `SWEPT_BANDPASS_CUES: ReadonlySet<CombatCue> = new Set(['weapon-miss'])`
    selects the filter *shape* inside the noise branch (line 546 onward):

    ```ts
    if (NOISE_BASED_CUES.has(cue) && this.noiseBuffer) {
      const noise = context.createBufferSource()
      noise.buffer = this.noiseBuffer
      noise.loop = true
      const filter = context.createBiquadFilter()
      if (SWEPT_BANDPASS_CUES.has(cue)) {
        filter.type = 'bandpass'
        filter.Q.setValueAtTime(1.2, now)
        filter.frequency.setValueAtTime(baseFrequency * 3, now)
        filter.frequency.exponentialRampToValueAtTime(Math.max(30, baseFrequency * 0.8), now + durationSeconds)
      } else {
        filter.type = LOWPASS_CUES.has(cue) ? 'lowpass' : 'highpass'
        filter.frequency.setValueAtTime(baseFrequency * 3, now)
      }
      noise.connect(filter)
      filter.connect(master)
      sources.push(noise)
    }
    ```

    The `else` branch is byte-for-byte today's code, so the nine existing
    cues synthesize exactly as before. `'weapon-miss'` is **not** added to
    `LOWPASS_CUES` or `DESCENDING_PITCH_CUES`.
  - Result: a swish that falls away, 1800 → 480 Hz over 170 ms, noise only,
    no sine underneath. The whooshes are a fixed highpass at 3300 Hz /
    lowpass at 1860 Hz with 130/190 ms; the miss is the only cue whose
    filter moves, which is what makes it a different *shape* rather than a
    different pitch of the same thing.
- **Not** on `SPEED_4_CUE_WHITELIST`. ×4 keeps only impacts, per the
  2026-08-16 rule; a miss is the absence of one.
- Voice cap: unchanged at eight. A miss adds at most one voice per exchange
  and never coincides with a `body-hit`/`shield-block`/`weapon-parry` of the
  same instance, so the dense-exchange budget does not get worse.
- "Audio quality requires human listening" (2026-08-16): the cue's
  distinctness from both whooshes is checked live via `?audioDebug=1` by the
  owner before merge; the unit tests check mapping and lifecycle only.

## 8. Tests, baselines and gates

### 8.1 Unit (fast, all PR-gating; new files join `fast` automatically via `slowSuites.test.ts`)

- `src/presentation/CombatAudio.test.ts` — extend: fixtures `missEvent`
  (`attack-missed`, reason `accuracy`) and `evadeEvent` (`attack-evaded`);
  `it` cases: miss → `['weapon-miss']`; evade → `['weapon-miss']`; a batch
  `[actionStarted, miss]` → `['weapon-whoosh-light', 'weapon-miss']` (both,
  in order); at `speed: 4` the batch `[miss, bodyHit]` plays exactly
  `['body-hit']`; the existing exhaustive-whoosh and x4 tests are untouched
  because none of their fixtures carry a miss. One title goes stale and is
  renamed in Task 1: line 276, `'allows all nine cue kinds at x1 and x2, up
  to eight simultaneous voices'` → `'allows all ten cue kinds …'` (its body
  is ten body hits against the eight-voice cap and does not change).
- `src/presentation/DamageNumbers.test.ts` (new) — `layoutDamageNumber`: `0`
  ms → rise 0, opacity 1; `495` ms (t = 0.55) → opacity 1; `900` → `null`;
  monotone non-decreasing rise; reduced motion → rise always 0, opacity
  identical. `classifyDamage`, the three reachable inputs (§6.2): paired
  `critical-hit` with `contactZone: 'body'` → `critical`; `contactZone:
  'shield'` unpaired → `shield`; `contactZone: 'body'` unpaired → `body`.
- `src/presentation/battleFeed.test.ts` — unchanged and must stay green.
- `src/testSupport/stateHash.test.ts` — unchanged and must stay green: the
  overlay is only built when `canvas.parentElement` exists, and no
  per-event bookkeeping is ever written onto an event or state object.
- `src/testSupport/nodeImportBoundary.test.ts` — no `process` identifier,
  no `node:` import in the new module.

### 8.2 e2e fast (PR-gating)

**Harness timing, which every assertion below is written against.** The
test surface's `advanceTicks(n)` (`src/main.ts` lines 641–645) runs
`stepBattleTick` `n` times and then calls `renderDom()` **once**;
`stepBattleTick` (lines 309–323) only appends to `pendingEvents`, and
`flushRenderBatch` (lines 495–515) hands that whole accumulation to
`ArenaView.sync` as one batch, whose `presentationMs` is the *final* tick
(`ArenaView.ts` line 856). So every effect and number whose event lies
inside one `advanceTicks` burst spawns **at age 0 at the burst's last
tick**, whatever its own tick was; only effects spawned by an *earlier*
burst have aged. (`stepBattleAndCamera`, lines 646–653, flushes per tick,
but it also advances the camera each tick, so it is not used for frozen
checkpoints.) Concretely, for the `seed=20260815` `brutus` lineup, bout 0
(`home.brutus vs away.drusus`, 1827 ticks) has these contact events before
tick 430 — replayed from the trace for this spec, and the same list
`eventsAtTick` returns in the browser:

| tick | event |
|---|---|
| 231 | `damage-dealt` 31 body (the bout's **first** `damage-dealt`) |
| 254 | `attack-blocked` + `damage-dealt` 11 shield |
| 274 | `attack-evaded` |
| 296 | `damage-dealt` 31 body |
| 337 | `damage-dealt` 31 body |
| 371 | `damage-dealt` 19 body |
| 429 | `attack-missed`, `home.brutus`, reason `geometry` (the bout's first miss) |

`tests/combat-visuals.spec.ts`, the frozen-tick test at line 519 (its
checkpoints are separate `advanceToTick` bursts: 0..232, 233..250,
251..254, then the new 255..430, then ..930):

- **tick 232** (burst 0..232 carries exactly one `damage-dealt`, t=231):
  assert `activeDamageNumbers` **equals** `[{ id: expect.any(String),
  amount: 31, kind: 'body' }]` — equality is legitimate here only because
  231 is the bout's first `damage-dealt` (table above; the fixture already
  pins `hp 389 = 420 − 31`); and that the one visible
  `[data-testid="damage-number"]` has text `'31'` and a bounding box fully
  inside `[data-testid="arena"]`'s box.
- **tick 254** (burst 251..254): the 31 spawned at pres(232) is 22 ticks
  old, under its 54-tick life, so the pool holds **both**. Assert
  `activeDamageNumbers` equals `[{ amount: 31, kind: 'body' }, { amount:
  11, kind: 'shield' }]` in spawn order (`toMatchObject` on each; `id`
  unconstrained), plus the `shield-` count of exactly 1 (line 580,
  unchanged). Not `toHaveLength(1)`, which the burst semantics make wrong.
- **tick 430, the miss checkpoint** (new; burst 255..430 carries the evade
  at 274, three body hits at 296/337/371 and the miss at 429; the 31/11
  numbers from 232/254 are 198/176 ticks old and dead): assert
  `activeEffectIds.filter(id => id.startsWith('miss-'))` has length **2**
  (the evade's puff and the miss's puff, both age 0), `activeEffectIds.filter(
  id => id.startsWith('body-'))` has length 2 (the 337 and 371 sprays on
  the two body slots), and `activeDamageNumbers.map(e => e.amount)` equals
  `[31, 31, 19]` — the number count equals the batch's `damage-dealt` count,
  which is the actual guard: a miss and an evade spawn puffs and **no**
  number. The comment records tick 429 / `home.brutus` / `geometry` in the
  style of the tick-232 note. (If a future kernel change moves the first
  miss, the checkpoint is re-located by the condition, like every other
  checkpoint in that file.)
- Line 550 (`body-` at 232) and line 710 (`weapon-` at 913) are untouched.

`tests/smoke.spec.ts`:

- Bout-start/rematch resets (lines 148, 168, 181, 252, 276): add
  `expect(snapshot.activeDamageNumbers).toEqual([])` beside each
  `activeEffectIds` assertion.
- Reduced motion (line 354; that test bursts `advanceTicks(255)` once, so
  the batch carries both 231 and 254 at age 0): keep `activeEffectIds`
  `[]`; add `activeDamageNumbers` matching `[{ amount: 31, kind: 'body' },
  { amount: 11, kind: 'shield' }]` — proving the number is the
  reduced-motion channel and that the burst spawned both.
- Alpha replay (lines 456–459): add `activeDamageNumbers` equality at both
  alphas (the 700-tick burst there fills all six slots; the exact contents
  do not matter, only that the two replays match).
- `?audioDebug=1` (line 936): the literal cue list gains `'weapon-miss'`
  after `'weapon-whoosh-heavy'`; the title becomes "all ten cues".
- Context loss (line 462; only 60 ticks in, so no number is live): before
  dispatching `webglcontextlost`, assert
  `page.locator('[data-testid="damage-number"]')` `toHaveCount(6)` (the
  pooled spans exist, hidden); after the fallback is visible,
  `toHaveCount(0)` (the overlay was removed, not merely hidden). Without
  the first assertion the second is vacuous.
- Production build (line 984): unchanged; the overlay is production UI, the
  snapshot field is DEV-only like the rest of the snapshot.

`tests/decision-panel.spec.ts`: unchanged and must stay green — the overlay
is absolutely positioned inside `.arena` and adds no flow.

`tests/legibility.spec.ts` naming test: unchanged and must stay green
(digits only).

### 8.3 Screenshot baselines

The five arena captures are **deleted and regenerated on both platforms**
(`heavy-cleave`, `fast-burst`, `technical-parry`, `combat-outcomes`,
`combat-safe-frame`), not only the ones that fail: README.md line 119
records that the 4 % ratio passed four stale arena PNGs in the 2026-08-23
slice, and the documented discipline for an intentional render change is
"delete the file so `--update-snapshots` recreates it as missing, and look at
every frame".

**The captures change how they reach their tick.** Today each capture is
one `advanceTicks(N)` burst, and under the harness semantics of §8.2 that
would stamp *every* effect of the bout so far at age 0 on the capture
tick: `technical-parry.png` at 913 of `nerva vs cassius` would show six
full-opacity numbers (the bout has eleven `damage-dealt` before 913: 586,
618, 657, 696, 735×2, 767×2, 799×2, 844), two sprays and two puffs (misses
at 314/480/580) — a frame no player can ever see, useless as a baseline of
"what ×1 looks like". So the five capture tests use a new helper:

```ts
/** Ticks of per-tick stepping before a capture: longer than the longest effect life (a number, 54 ticks), so nothing from the burst before it is still alive at the capture tick. */
const EFFECT_WINDOW_TICKS = 60

async function advanceToCaptureTick(page: Page, tick: number): Promise<void> {
  await page.evaluate(
    ([target, windowTicks]) => {
      const burst = Math.max(0, target - windowTicks)
      window.__GLADIATOR_TEST__.advanceTicks(burst)
      for (let step = burst; step < target; step += 1) window.__GLADIATOR_TEST__.advanceTicks(1)
    },
    [tick, EFFECT_WINDOW_TICKS] as const,
  )
}
```

One burst to `tick − 60` (everything in it is stamped at `tick − 60` and is
dead by `tick`, since 60 > 54 > 25.2 > 13), then sixty single-tick calls in
the same `page.evaluate` (sixty `renderDom` passes; the 700-single-tick test
in `smoke.spec.ts` line 397 already does this shape at ten times the count),
so every effect from the last sixty ticks is stamped at **its own tick** and
is drawn at its true ×1 age. The simulation state at `tick` is identical
either way (the kernel does not know about batches), `?snapshot` keeps the
runtime paused so no camera time passes during the single ticks
(`flushRenderBatch` → `advanceCameraTime: !runtime.paused`), and
`captureFrame`'s 4 s settle and alpha-1 render are unchanged — the capture
stays a pure function of the tick count. `startBoutZeroWith`/`startBoutOneWith`
and the frozen-tick checkpoints keep their bursts.

What must be visible, from the trace (bout 0 = `home.brutus vs away.drusus`,
bout 1 of `brutus/nerva/aquila` = `home.nerva vs away.cassius`; ages are
`capture tick − event tick`):

- `combat-safe-frame.png` (60): nothing — bout 0's first contact event is
  at 231. Any effect or digit here is a bug.
- `heavy-cleave.png` (420): the t=371 hit (19, body) — its number 49 ticks
  old (t = 0.91: opacity ≈ 0.20, risen ≈ 38 px), its spray dead (49 >
  25.2). The evade at 274 and the earlier hits are outside the window.
  Faint single number over `home.brutus`, no spray, no puff.
- `fast-burst.png` (890): the t=834 hit (19, body), number 56 ticks old →
  **dead** (56 > 54), spray dead; the evade at 872 → sand puff 18 ticks old
  → **dead** (18 > 13.2). So: no effect visible. (The bout's other events
  near it — 812, 872 — are all past their lives.) This is the frame the
  fixture was chosen for, a windup with a clear silhouette, and it stays
  clean.
- `technical-parry.png` (913): the weapon spark only, at age 0; **no**
  number (the last `damage-dealt`, 844, is 69 ticks old and outside the
  window) and **no** spray. If a number is visible here, the cause is the
  capture helper not stepping per tick, or a number life longer than
  `DAMAGE_NUMBER_LIFE_MS` — not the pairing logic.
- `combat-outcomes.png` (1827, the killing `heavy-cleave`): the spray at
  age 0 (scale 0.45, opacity 0.92) and the number **63** (body) over
  `away.drusus` at age 0; the miss at 1771 is 56 ticks old, its puff dead.
  The reviewer checks the 63 against the feed's last "deals N" line in the
  same capture.

The reviewer reads the trace with `eventsAtTick` over `(tick − 60, tick]`
and confirms each visible effect has its event *and* the right age before
accepting a PNG.

Windows: `node node_modules/@playwright/test/cli.js test tests/combat-visuals.spec.ts --update-snapshots`
after deleting `tests/__screenshots__/win32/{those five}.png`. Linux: delete
`tests/__screenshots__/linux/{those five}.png`, push, then
`gh workflow run update-baselines.yml --ref feature/hit-miss-feedback`, pull
the commit it pushes, and look at each PNG in the diff before the PR is
marked ready. `planning.png` and `season-board.png` must not change on
either platform (0.002 fullPage; if they move, the overlay leaked outside
`#battle-ui`).

### 8.4 Legibility gate (slow project)

`tests/legibility.spec.ts` is run once locally on the final commit
(`node node_modules/@playwright/test/cli.js test --project slow tests/legibility.spec.ts`,
budget 12–14 min). It must pass, and its reported p92 body heights and the
pairing-05 deviation must be **unchanged from the base commit's run** — the
implementer runs the same command once on the branch's base commit (or takes
the most recent nightly on `main`) and pastes both lines into the PR side by
side; the 2026-09-04 spec's 146.05–164.72 px is that slice's figure, not a
measurement of this branch's base. The reason nothing may move: the spray
and puff are scene-level meshes
with no `userData.slot`, the number is DOM, and `accumulateProjectedBounds`
traverses only `rig.fighter.root` for slotted meshes, so nothing this slice
adds can enter a measurement. A changed figure means an effect was parented
under a rig root by mistake, and the fix is the parent, not the bar.

No new pre-committed pixel bar is added for the effects themselves: what
the slice asserts structurally is presence, kind, amount and the number's
box inside the arena box (§8.2); whether the spray and puff *read* is the
human question §9 answers.

### 8.5 Check commands

`npx` does not work on this machine; call the binaries:

```bash
node node_modules/vitest/vitest.mjs run --project fast
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node node_modules/@playwright/test/cli.js test --project fast
node node_modules/@playwright/test/cli.js test --project slow tests/legibility.spec.ts   # once, final commit
```

Narrow runs while working: `node node_modules/vitest/vitest.mjs run
src/presentation/CombatAudio.test.ts`, `... run src/presentation/DamageNumbers.test.ts`,
`node node_modules/@playwright/test/cli.js test --project fast tests/combat-visuals.spec.ts`.

## 9. Human verification (not delegable to tests)

Before the PR is marked ready, the implementer attaches to the PR:

1. Three live-bout screenshots at ×1: a body hit with spray and number
   visible, a blocked hit with the ring and the tan number, a miss with the
   puff — each with the tick and the event line from the feed.
2. A paragraph on whether the spray reads as coming *from* the victim in the
   blow's direction at the shipped framing, and whether the puff reads as
   "hit nothing" rather than "a ring appeared".
3. The owner listens to `weapon-miss` against both whooshes via
   `?audioDebug=1` and says whether it is a different sound. If it is not,
   the fix is the filter sweep endpoints or duration, decided by ear, and
   noted in the PR — not a new synthesis design.

The formal two-reviewer gate (2026-08-16 spec, "Human review gate") is not
run for this slice, consistent with every slice since; the playtest report
that follows is the owner's pass plus the instrumented follow-up.

## 10. Rejected alternatives

- **Weapon-trail "flick" for a miss** (the playtest's first suggestion). The
  trail is pose-driven (`clipMapping.weaponTrailActive`) and identical for a
  hit and a miss until the outcome event arrives; making it differ after the
  fact means recolouring a six-point history retroactively, which cannot be
  done tick-deterministically after an `advanceTicks` burst (the history
  belongs to drawn frames, not ticks). The puff is a function of the tick.
- **Puff at `weaponTip`'s live position.** Same burst problem (§5.2).
- **Spray parented under the victim's `hitCenter` bone.** It would follow the
  `Hit_A` reaction, which is nice, but it puts a mesh under `rig.fighter.root`
  where one stray `userData.slot` enters the legibility measurements (which
  run post-merge, nightly), and it complicates the rig's dispose path. The
  contact point is already where the blow landed; scene-level, like today.
- **A different swing sound for a miss.** The whoosh fires on the first tick
  of windup (2026-08-16), before the outcome exists. Any miss sound must be
  post-contact.
- **Numbers as `THREE.Sprite`s with a `CanvasTexture`.** Needs
  `document.createElement('canvas')` on the render path, which
  `stateHash.test.ts` constructs `ArenaView` without; digits blur at
  non-integer scales; and it would be a second canvas in spirit. DOM digits
  are crisp and free.
- **Numbers on the HP card instead of over the arena.** The research notes
  (§6 of `2026-08-23-order-legibility-references.md`) record that attribution
  aids away from the fight pull attention off it; the HP bar already moves.
  The number belongs where the blow was.
- **Hiding numbers under reduced motion.** Then reduced-motion viewers keep
  having no hit feedback at all (spray, puff and trail are all off). A static
  fade is not motion.
- **`weapon-miss` on the ×4 whitelist.** ×4 keeps impacts only; adding the
  absence of one is the opposite of that rule.
- **Camera nudge along the hit vector / longer hitstop.** Camera effects are
  excluded by the 2026-08-16 spec; hitstop already exists as the `impact`
  phase hold (`impactTicks` 2–6) and its review warned against over-use on
  probes that fire every 28 ticks.
- **HP-bar delta animation, screen flash, vignette pulse.** HUD/post-process
  channels, not the fight; the hypothesis is about the arena alone.
- **A GPU particle system for blood.** A standalone particle system stays a
  non-goal; seven merged spheres on the existing two-slot pool are enough at
  41 px and cost nothing new.
- **Showing the number only when the hit staggers.** The problem being fixed
  is exactly the un-staggering hit that today leaves nothing but a 260 ms dot.

## 11. Implementation tasks (one agent, one commit each, in this order)

1. **`weapon-miss` cue.** `CombatAudio.ts`: union, `ALL_COMBAT_CUES`, the two
   `Record` tables, `NOISE_BASED_CUES` membership, `SWEPT_BANDPASS_CUES` and
   the filter branch of §7 (line 558 untouched), `handleEvent` branches for
   `attack-missed`/`attack-evaded`. `CombatAudio.test.ts`: the fixtures and
   four cases in §8.1, and the line-276 title rename. `smoke.spec.ts` line
   936: list + title.
   Check: `vitest run src/presentation/CombatAudio.test.ts`, `tsc --noEmit`,
   `playwright ... tests/smoke.spec.ts`.
   Commit: `feat(audio): a miss and an evade get their own cue after contact`.
2. **Blood spray on the body zone.** `ArenaView.ts`: generalise
   `ContactFlashEffects` to per-kind visuals (life, geometry, `animate`),
   build the seven-droplet geometry, add `direction` and `scaleBase` to
   `spawn`, thread `current` into `processNewEvents`, add
   `criticalInstanceIds`. No test file changes; `combat-visuals` line 550
   and `smoke` reduced-motion/alpha tests must stay green as-is. Baselines
   are **not** regenerated in this commit: the arena captures may be red
   from here until task 6 (which of the five trips the 4 % ratio depends on
   how much a full-opacity spray moves, and is not predicted), and that is
   expected.
   Commit: `feat(arena): blood spray in the blow's direction replaces the body-hit dot`.
3. **Sand puff on a miss.** `ArenaView.ts`: `'miss'` kind, `MISS_REACH`
   with the measurement procedure of §5.2 carried out and the values written
   in, spawn on `attack-missed`/`attack-evaded`. `combat-visuals.spec.ts`:
   the miss checkpoint of §8.2.
   Commit: `feat(arena): a missed swing ends in a puff of sand`.
4. **Damage numbers.** `DamageNumbers.ts` + test, `style.css` rules,
   `ArenaView.ts` wiring (constructor, `processNewEvents`, per-frame
   placement after render, `startBout`/`clearBout`/`dispose`/`contextLost`),
   `ArenaDebugSnapshot.activeDamageNumbers`. `combat-visuals.spec.ts` ticks
   232/254 assertions; `smoke.spec.ts` bout-start, reduced-motion,
   alpha-replay and context-loss additions.
   Commit: `feat(arena): floating damage numbers from damage-dealt events`.
5. **Docs.** README paragraph (§2.1); this spec's status line → "as built";
   nothing else.
   Commit: `docs(feedback): the four feedback channels and the blood amendment`.
6. **Baselines.** Add `advanceToCaptureTick` (§8.3) and switch the five
   capture tests to it; delete the five arena PNGs on both platforms,
   regenerate win32 locally, trigger `update-baselines.yml` for Linux,
   review every PNG against the §8.3 expectations, run the full fast suite,
   run the slow legibility suite once on this commit and once on the base
   commit and paste both p92 lines into the PR.
   Commit (win32): `test(e2e): regenerate the five arena baselines for the hit/miss feedback slice`;
   the Linux commit is the workflow's own.
7. **Playtest report** (after the owner's pass): `docs/reviews/2026-09-xx-hit-miss-feedback-playtest.md`
   in the style of the 2026-09-05 report — checklist verdicts, findings,
   instrumented follow-up. Not part of this PR.

## 12. Risks

- **The 4 % screenshot ratio cannot see a missing number.** A 22 px digit is
  about 300 px² of a 1,049,600 px² viewport; if the overlay silently failed
  to render, every baseline would still pass. The structural assertions in
  §8.2 (entry present, DOM text, box inside arena) are the real guard, which
  is why they are pinned at two ticks whose amounts the fixture already
  knows.
- **CI runner speed.** `smoke.spec.ts`'s 700-single-tick test already needed
  `test.slow()`; six DOM writes per frame are cheap, but if the fast e2e job
  crosses 30 s on a test, the fix is `test.slow()` on that test, not fewer
  writes.
- **Sound distinctness is a human call.** If `weapon-miss` reads as "another
  whoosh", §9.3 says what moves; the mapping does not.
- **The killing-blow number lingers through between-bouts.** Decided in §6.4
  as consistent with the flash; if the owner dislikes it in the playtest,
  the change is one line in `handleArenaPhaseChange` (clear numbers on
  `between-bouts`), recorded as a follow-up, not folded into this PR.

## 13. Review notes (2026-09-17, first review round)

Each reviewer point was checked against the code before being accepted.

**Accepted and fixed in place.** Burst semantics of `advanceTicks` (§8.2
harness paragraph, §8.3 rewritten; the trace replay for seed 20260815
reproduced the reviewer's event lists exactly, including the eleven
`damage-dealt` before 913 in `nerva vs cassius` and the bout-0 first miss at
429); the tick-254 assertion (§8.2, now a two-entry equality); the
`fast-slash` cadence (§4.2, 22 ticks per `combatStyles.ts` 137–139, claim
rewritten); the `weapon-miss` synthesis branch (§7, `NOISE_BASED_CUES`
membership plus an inner `SWEPT_BANDPASS_CUES` filter switch, line 558
untouched); `classifyDamage`'s unreachable case (§6.2, §8.1); `.arena__status`
stacking (§6.1, overlay inserted before the heading); the headless path
(§6.1, no `document.*` without `parentElement`); the puff placement
approximation (§5.2); the stale test title (§8.1, line 276); the miss
checkpoint's batch contents (§8.2, now pinned to `[31, 31, 19]` and two
`miss-` slots); Task 2's baseline wording (§11); §8.4's legibility figures
(now "unchanged from the base commit's run"); `mergeGeometries` (§4.1);
placement after `settleCameraSeconds` (§6.3); the two-part hypothesis (§1,
"watching and listening").

**Went further than suggested.** Rather than only re-describing the five
captures under burst semantics, §8.3 changes how the captures reach their
tick (one burst to `tick − 60`, then per-tick stepping), so the baselines
show effects at their true ×1 ages — a frozen frame with six full-opacity
numbers is not something a player can see and would be a baseline of the
harness, not of the game. `stepBattleAndCamera` was not used because it
advances the camera per tick and would move the framing of every capture.

**Rejected.** "README citation is line 118, not 119": in this worktree's
`README.md` the paragraph containing "Так и вышло в слайсе 2026-08-23" is
line 119 (`rg -n` confirms; 117 is the "После обновления" paragraph, 118 is
blank). The citation stands.

**Corrected in passing.** The reviewer's count of "13 `damage-dealt` before
tick 913" in `nerva vs cassius` is eleven by the replay (the tick list they
gave is right; the count is not). It changes nothing: six is the pool size
either way.
