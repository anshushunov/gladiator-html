# Murmillo kit and spear thrust — Design

**Status:** design, 2026-09-17. Items 4 and 5 of the proposed next slice in
`docs/reviews/2026-09-05-skinned-gladiators-playtest.md`. Amends
`docs/superpowers/specs/2026-09-04-skinned-gladiators-design.md` §2.2 (the
archetype mapping and the build-script steps) and closes its §10 follow-up
"`Spear_Drive` reach at contact".

**Decisions already taken by the design owner (playtest, 2026-09-05):**

- The murmillo is rebuilt from the Barbarian body; the Knight's plate goes.
  He gets a script-built crested brimmed helmet, a manica on the sword arm,
  one greave on the left leg, and keeps the rectangle shield and sword.
- `technical-thrust` gets its own authored clip, `Spear_Thrust`, with the reach
  of a two-handed stab; `Spear_Drive`'s reach at contact is fixed. Both in the
  build script. Neither item touches a frozen number.

**Every number below was measured on this worktree before it was written
down**, with Blender 5.2 on `assets/kaykit/*.glb` and `public/models/*.glb`
(bone axes, mesh bounds, the weapon tip through every frame of the shipped
clips, and 28 candidate strike poses) and with the shipped simulation (root
separation at every contact of every attack, nine pairings × 20 seeds). The
measurement scripts were throw-away; the figures they produced are in §4.

---

## 1. Hypothesis

**Track.** A viewer names all three types from the kit alone, and sees the
hoplomachus' thrusts land, once the murmillo wears a murmillo's kit and the
spear clips put the tip on the opponent at the contact tick — with the bout
itself unchanged.

The track ships as **two PRs**, each with one hypothesis (AGENTS.md):

- **PR-1, murmillo kit.** *A murmillo in bronze galea, manica and greave behind
  a scutum reads as a gladiator, not a knight.* That is the one thing the eye
  judges, on the re-captured arena frames (§5.2) and the live-bout screenshots
  (§5.5). The legibility harness (§5.3) is the non-regression gate under it:
  the murmillo must stay as legible by silhouette (p92 height, inset) as the
  plate was. The harness measures size and cropping, not "reads as a
  gladiator"; it cannot pass the hypothesis, only fail the PR.
- **PR-2, spear clips.** *A spear thrust reads as a spear thrust when the tip
  lands on the man on the contact tick instead of a hand's width short or a
  body's length through him.* Measured in the build script itself (the reach
  assertion, §4.2.5), judged by eye on `technical-parry.png` and a live bout.

## 2. What changes and what does not

**Changes** (all presentation and pipeline):

- `tools/blender/build_gladiators.py`, and therefore `public/models/heavy.glb`
  and `public/models/technical.glb`. `fast.glb` is rebuilt by the same run and
  must come out with the same meshes, anchors and clips as before (§5.4).
- `src/presentation/fighterModelContract.ts`: one new mesh slot, one clip name
  in `ATTACK_CLIPS`.
- `src/presentation/ArenaView.ts`: the new slot joins `BODY_SILHOUETTE_SLOTS`.
- `src/presentation/ArenaCamera.ts`: `WIDEST_EQUIPMENT_RADIUS` (a MEASURED
  constant, refreshed because the rig it quotes changed — the class distinction
  in `cameraTraces.ts`), and **one new constant, `FLAT_REGION_EDGE_FLOOR_EXTENT
  = 7.531226122787968`**, so that the flat region keeps ending where it ends
  today when the widest radius goes *down* (§4.2.6 — measured: without it the
  retiarius pairing chatters).
- The tests and fixtures that mirror those numbers (§5), five arena PNG
  baselines on both platforms, README §"rig", the equipment bible.

**Does not change:**

- **`src/simulation/**` — nothing.** `contactRange`, `DUEL_MINIMUM_SEPARATION`,
  every catalogue number, every frozen hash and every recorded `ticks` count
  stay exactly where they are. The playtest's items 1 and 2 are a different
  slice.
- **Presentation re-derives no rule.** The clips are chosen by `clipMapping`
  from action phase and `contactAt`, as today. The reach the clips are
  authored to is *read off* the simulation's contact distribution (§4.2.2) and
  written into the build script as a target; the runtime never computes it.
- `contactAt` for either spear action (both stay `0.5`; the fix is in the keys,
  as the 2026-09-04 spec §10 required).
- `FLAT_DISTANCE` and `EASE_WIDTH_EXTENT` (the SWEPT pair). Not touched. Nor
  does the extent the flat region ends at (7.531226122787968): it stays there
  by the floor in §4.2.6, so the eased region, the zoom-rate margin, the
  camera-side dead-zone literals in `ArenaCamera.test.ts` and every framing
  the PNG baselines and the slow harness were measured under are the same
  after PR-2 as before it. What PR-2 changes in the camera is the *input*
  (the hoplomachus' radius), not the mapping.
- The 130 px floor, the 5 % inset, `BODY_FLOOR_PERCENTILE`, the polearm
  exemption list, the trident, the net, the buckler, `TARGET_HEIGHT`.
- `KEEP_CLIPS`. `1H_Melee_Attack_Stab` stays in every file even though nothing
  selects it on `technical` any more (12 KB; one shared set is simpler than
  three).

## 3. Facts the design rests on

Measured on this worktree; the numbers the rest of the document uses.

**Source packs (Blender Z-up, rest pose, source units; the model faces −Y,
which is glTF/three.js +Z).** Skeleton identical in all three packs.

| bone | head → tail | local axes (x, y, z in world) |
|---|---|---|
| `hips` | (0, 0, 0.406) → (0, 0, 0.598) | x = +X, y = up, z = forward |
| `chest` | (0, 0, 0.973) → (0, 0, 1.224) | x = +X, y = up, z = forward |
| `head` | (0, 0, 1.241) → (0, 0, 1.492) | x = +X, y = up, z = forward |
| `upperarm.r` | (−0.212, 0, 1.107) → (−0.454, 0.014, 1.107), 0.242 | x = back, y = along arm (−X), z = up |
| `lowerarm.r` | → (−0.713, 0, 1.107), 0.260 | same |
| `hand.r` | (−0.787, 0, 1.107) → (−0.899, 0, 1.107) | same |
| `handslot.r` | (−0.883, 0, 1.049) | — |
| `upperleg.l` | (0.171, 0, 0.519) → (0.171, −0.008, 0.292), 0.227 | x = +X, y = down, z = back |
| `lowerleg.l` | → (0.171, 0.019, 0.145), 0.149 | x = +X, y = down-forward, z = up-forward |

So on an arm bone **a rotation about local Z (world up) swings the arm in the
horizontal plane** (+90° on `upperarm.r` points it straight forward) and **a
rotation about local X (world front–back) raises it** (+ = up). The shipped
`Spear_Drive` strike key `upperarm.r (70, 0, −20)` is therefore *arm raised 70°
in the frontal plane and swung 20° back* — which is exactly what the shipped
file shows: at frame 15 the spear tip sits 1.07 units out to the fighter's
right, 1.10 high and only 1.78 forward, less than in `Idle` (1.91). And its
guard keys `(0, 0, 0)` on six bones are the pack's *T-pose*, so the clip
starts and ends with the arms out sideways. Both are authoring errors, not
tuning.

**Barbarian body** (bind pose): height 2.186 → rig scale `2.0 / 2.186 =
0.9149`. Head mesh x ±0.543, y −0.526..0.460, z 1.135..**2.186** (crown).
Right arm mesh cross-section ≈ 0.26 × 0.27 (box corners at 0.19 from the bone).
Left leg mesh x 0.049..0.288, z 0..0.529 (boot included). The rendered
Barbarian wears a blue sleeveless tunic, **a brown belt with a round buckle,
and a fur kilt**; fur bracers on both wrists.

**Knight props** (rest pose, world): `1H_Sword` under `handslot.r`, bbox x
−1.135..−0.631, y −1.443..0.332 → farthest corner 1.836 from the vertical axis.
`Rectangle_Shield` under `handslot.l` at local t (0, −0.095, 0.156), bbox
0.883 × 1.193 × 0.301. `Knight_Helmet` under `head`, z 1.111..2.467.
**The Knight's atlas is 14,172 bytes** (a palette PNG; the Barbarian's is
15,089) — the 2026-09-04 spec's "second 1024×1024 atlas" is real but costs
14 KB, not hundreds.

**Shipped clips, weapon tip forward of the fighter's origin, world units (2.0
rig):** `technical` rest 1.834 (the spear's hand-to-tip length), `Idle` 1.91;
`1H_Melee_Attack_Stab` peak **2.485** at frame 18/38; `2H_Melee_Attack_Stab`
**2.435** on the spear and **2.129** on the trident (same frame);
`Spear_Drive` frame 15 **1.779**, lateral −1.067.

**Root separation at contact, shipped simulation** (nine roster pairings × 20
seeds, every `damage-dealt`/`attack-blocked`/`attack-parried`/`attack-evaded`/
accuracy-`attack-missed`, read on the state before the resolving tick):

| action | n | p10 | p25 | median | p75 | p90 | `contactRange` |
|---|---:|---:|---:|---:|---:|---:|---|
| `fast-burst-lunge` | 557 | 1.60 | 1.67 | **1.89** | 2.09 | 2.27 | 1.6–2.4 |
| `technical-thrust` | 1509 | 1.21 | 1.33 | **1.47** | 1.72 | 2.18 | 1.2–2.8 |
| `technical-driving-thrust` | 320 | 1.60 | 1.60 | **1.78** | 2.35 | 2.67 | 1.6–3.1 |

The trident lunge the owner passed ("lands exactly on contact") puts its tip
**0.24 past the opponent's root** at the median contact. The pack's one-handed
stab, on the spear, puts it **1.0 past** — through the man and 0.7 out of his
back — and `Spear_Drive` **stops 0.3 short of his front surface** (torso half-
depth ≈ 0.33). Neither reads as a spear landing, for opposite reasons, and no
strike pose can fix the thrust while the hand grips the very butt of a
1.83-unit spear: at 1.47 of separation the hand would have to be 0.36 *behind*
the fighter's own root.

## 4. Design

### 4.1 Murmillo kit (PR-1)

**Source and transplant.** `heavy` is built from `Barbarian.glb`. Its sword and
shield are the Knight's meshes, transplanted: after the Barbarian is imported
and its body parts tagged, `Knight.glb` is imported into the same scene, its
`1H_Sword` and `Rectangle_Shield` are re-parented to the Barbarian armature's
`handslot.r` / `handslot.l` at the world placement they had on the Knight's
identical skeleton (`parent_to_bone(obj, arm, obj.parent_bone,
obj.matrix_world.copy())`), and every other object the second import added —
armature, six body meshes, cape, helmet, the other shields and swords, the
`Icosphere` helper — is deleted. The Knight's 76 actions come in suffixed
(`Idle.001`, …) and are removed by `prune_clips` as today. **The two meshes keep
`knight_texture`** (14 KB); the painted sword and the shield's emblem are worth
that.

**Rig scale** becomes `2.0 / 2.186 = 0.9149` (it was 0.8641 on the Knight);
the measured bind-pose body box is 1.83 world units instead of 1.73, the same
as the other two rigs.

**Built props**, all `solid_material` at roughness 0.8, all placed in the bind
pose off measured bounds, all bone-parented. Source units; z is height.

| object | primitive | size | placement | parent | slot | material |
|---|---|---|---|---|---|---|
| `galea_dome` | cylinder, 16 verts | r 0.62, depth 0.47 | centre (0, −0.03, crown − 0.12) = z 1.83..2.30 | `head` | `helmet` | `kit_bronze` |
| `galea_cap` | cone, 16 verts | r1 0.62 → r2 0.30, depth 0.22 | centre (0, −0.03, crown + 0.23) = z 2.30..2.52 | `head` | `helmet` | `kit_bronze` |
| `galea_brim` | cylinder, 16 verts | r 0.86, depth 0.05 | centre (0, −0.06, crown − 0.34) = z 1.85 | `head` | `helmet` | `kit_bronze` |
| `galea_crest` | cube, scaled | 0.07 × 0.72 × 0.26 (x, y, z) | centre (0, −0.05, crown + 0.36) = z 2.42..2.68 | `head` | `helmet` | `galea_crest` |
| `manica_upper` | cylinder, 12 verts | r 0.20, depth 0.20 | bone midpoint, axis along the bone | `upperarm.r` | `armour` | `kit_bronze` |
| `manica_lower` | cylinder, 12 verts | r 0.185, depth 0.20 | bone midpoint, axis along the bone | `lowerarm.r` | `armour` | `kit_bronze` |
| `greave` | cylinder, 12 verts | r 0.175, depth 0.24 | bone head + 0.01 along the bone (z ≈ 0.16..0.40, covering the knee) | `lowerleg.l` | `armour` | `kit_bronze` |

`crown` = max z of `Barbarian_Head` in the bind pose (2.186), read at build
time, not hard-coded, so the helmet sits on whatever head the pack ships.

- **Why these shapes.** The pack is low-poly and blocky; a 16-segment cylinder
  under a cone reads as a bronze crown at 50–90 px, and the head's rounded
  blob stays inside a 0.62 radius (its box half-diagonal is 0.73 but the mesh
  is not a box). The brim's 1.72 diameter is the murmillo's signature at any
  distance — wider than the torso, as the Pompeii helmets are. The crest is a
  plain comb, 0.26 tall, per `docs/reference/gladiator-equipment.md` §4 and §6
  ("its decoration is not recoverable"; "drawn low" so it does not compete
  with the scutum). Helmet top ends at 2.68 source = **2.45 world**, 0.32 above
  the Knight helmet's 2.13.
- **Why one sleeve per arm bone, not rings.** A laminated look needs gaps of
  ~0.015 source units, under a pixel at the shipped framing. Two rigid
  cylinders, one per bone, bend at the elbow like the arm does; the inside of
  the bend intersects and the outside opens, invisible at this size. Radius
  0.20 clears the arm mesh's box corners (0.19). The lower sleeve stops 0.03
  short of the wrist so it does not fight the Barbarian's own bracer.
- **Why the greave covers the knee.** The Barbarian's lower leg is 0.149 long
  with a boot below it; a band on the shin alone is 0.15 tall and invisible
  (the equipment bible already recorded the procedural ocrea as "drawn but
  not observable"). Running it from just above the boot to over the knee
  makes it a 0.24 band on the leading leg — 15 px at 150 px of body. Still a
  fidelity item, not a cue; nothing is built on it.
- **Colours.** `kit_bronze` (0.72, 0.50, 0.20, 1); `galea_crest` (0.12, 0.10,
  0.09, 1). Bronze because the plate was grey and this must not read as
  plate; a dark crest because the HUD already owns red (`#b34d3a` home) and
  blue (`#4383a0` away) and the crest is the one part of him that sits against
  open floor.

**Belt and loincloth: not built.** The Barbarian body already carries a belt
with a buckle and a fur kilt in its own texture (render checked); a second belt
over the first adds a band nobody can see and a second material to maintain.
The brief's "loincloth + belt" is satisfied by the body. If the owner wants the
kilt to read as a *subligaculum* specifically, that is a texture edit and a
different slice (§9).

**Slots and the contract.** `MESH_SLOTS` gains `'armour'`; `ArenaView`'s
`BODY_SILHOUETTE_SLOTS` becomes `{'body', 'helmet', 'armour'}`, so the
partition test in `fighterModelContract.test.ts` keeps holding. Worn armour is
part of the man for the scale floor (the harness's own definition: "the man
and everything he wears"), and it can never be tagged `body`: the contract
test reads the `body` slot's POSITION accessors for the 2.0 / feet-at-0
assertion, and a rigid cylinder's accessor is in its own local frame.
`heavy.glb` therefore carries **15 mesh nodes**: six `body`, four `helmet`
(`galea_dome`, `galea_cap`, `galea_brim`, `galea_crest`), three `armour`
(`manica_upper`, `manica_lower`, `greave`), `1H_Sword` = `weapon`,
`Rectangle_Shield` = `shield`. **Four materials, two images**: the Barbarian
body atlas, `knight_texture` on the two transplanted meshes, `kit_bronze` and
`galea_crest`. `solid_material` (`build_gladiators.py:202`) makes one material
per call, so `build_galea` creates `kit_bronze` **once** and hands it to
`build_manica` / `build_greave`; six bronze pieces share it. Anchors as today:
`weaponTip` at the sword's far end (from `weapon_axis` on the transplanted
sword), `shieldCenter` at the shield's bbox centre, `hitCenter` at `spine`'s
tail (y = 0.89 on the Barbarian body — `inspect-glb` on the shipped `fast.glb`,
same skeleton, same scale — where the Knight's was 0.84).

**Radius.** The sword tip is the farthest point in the rest pose, as it is
today: `1.836 × 0.9149 ≈ 1.680` (was 1.5861850532796753). Below `fast`'s
1.772876372587171, so `WIDEST_EQUIPMENT_RADIUS` does not move in PR-1; only
`RIG_EQUIPMENT_RADIUS.heavy`, `BAND_LOW` (`0.9 + 2 × heavy × 1.1 ≈ 4.595`)
and trace 01 do (§5.1). The exact value is read from
`createSkinnedFighter(...).horizontalEquipmentRadius` in the browser, the way
the plan's Task 7 did.

**Silhouette check.** Crest + brim + tall scutum + short sword (murmillo);
bare head + net + trident (retiarius); buckler + spear (hoplomachus). The three
crowns are now bronze-crested / bare / none-with-buckler; the three off-hands
slab / disc-net / small disc. Nothing new is shared between any two types.

### 4.2 Spear clips (PR-2)

#### 4.2.1 The grip

The spear is gripped **0.8 source units from its butt**, not at the butt:
`build_shaft_weapon` gains `grip_behind` (source units, `None` = today's
behaviour, so the trident is byte-for-byte unchanged), and the spear's shaft
starts at `hand − direction × 0.8`. Total length is unchanged (1.9 shaft +
0.32 head = 2.22): **1.30 world units ahead of the hand, 0.73 behind.**

Why: §3 shows no thrusting pose can land a butt-gripped 1.83-unit spear at
the thrust's median separation of 1.47. A *hasta* is held at its balance
point; the shaft crossing the fist is also the better spear silhouette in
`Idle`. The reach the pack's stab clips now produce on the spear drops from
2.44–2.49 to 1.9–2.0, which is where the contact distribution is.

`weapon_axis` gains the 2026-09-04 spec §10 sanity assertion while it is open:
the tip it returns must be farther from `spine`'s head than the butt is.

**Radius.** The spear's farthest rest-pose point is now the tip at 1.30 ahead
of the hand: ≈ `hypot(0.808 + 0.046, 1.299) ≈ 1.55` (was 2.0141936921763492).
`fast` becomes the widest rig, so **`WIDEST_EQUIPMENT_RADIUS` =
`1.772876372587171`** (already the measured `fast` value; no new measurement)
and the derived `BAND_HIGH_EXTENT` = `3.1 + 2 × 1.772876372587171 × 1.1` =
**7.000328019691777**. **The flat region does not follow it down** — it keeps
ending at 7.531226122787968 through the floor in §4.2.6, because a replay of
the camera suite with the flat region ending at 7.0003 fails the reversal
ceiling on the retiarius pairing. §5.1 lists what mirrors which number.

#### 4.2.2 Reach targets

Authored so the tip lands where the trident's does relative to the man —
about a quarter unit past his root at the median contact, inside his torso
from p25 to p75:

| clip | action | contact median | tip forward at the strike frame | tip height | tip lateral |
|---|---|---:|---|---|---|
| `Spear_Thrust` | `technical-thrust` | 1.47 | **1.70–1.85** | 0.85–1.05 | within ±0.20 |
| `Spear_Drive` | `technical-driving-thrust` | 1.78 | **2.00–2.20** | 0.85–1.05 | within ±0.20 |

World units, measured from the fighter's own origin (the wrapper `Group` the
runtime places at the simulation position — *not* the animated `root` bone),
forward = the model's +Z in three.js (−Y in Blender). The height window brackets
every opponent's `hitCenter` as shipped (`inspect-glb`: 0.84 Knight, 0.89
Barbarian, 0.889 Rogue; the rebuilt murmillo is a Barbarian, so 0.89 after
PR-1). At p90 both tips fall 0.15–0.30 short of the opponent's front — the
same shortfall the passed trident lunge has at its own p90; at p10 both pass
0.2 out of his back, as the trident does.

**These windows are a mirror of the simulation catalogue, not a property of
the clips.** They are read off today's `contactRange` and
`DUEL_MINIMUM_SEPARATION` through the distribution in §3. The playtest's
items 1 and 2 (raise `technical-thrust` / `technical-driving-thrust`
`contactRange.min` and the minimum separation) will move exactly those
medians upward, and when that slice lands the reach assertion in §4.2.5 must
be re-measured and re-targeted in the same PR — otherwise the tips drift
short again by design, and the assertion will keep passing while they do.
The build script says so in a comment beside the window literals, naming
the two catalogue fields it mirrors.

#### 4.2.3 Clip structure

Both clips are authored by one function, `author_clip(arm, name, frames,
keys)`, replacing `author_spear_drive`; `AUTHORED_CLIPS = {'Spear_Thrust',
'Spear_Drive'}` replaces the single `AUTHORED_CLIP` in `prune_clips`. 24 fps.
Rotations keyed on `rotation_quaternion` (the pack's channel; the shipped
comment about Euler silencing the pack's curves stands), `hips` additionally
on `location`.

**Guard = the pack's `Idle` at frame 0, for every pose bone.** Before keying,
the script switches the armature to `POSE`, mutes every NLA track, makes
`Idle` the active action, evaluates frame 0, records each pose bone's
`rotation_quaternion` and `location`, then clears the action and unmutes.
Those values are keyed on **all** pose bones at the first and last frame of
the new action; the authored bones below override them at the windup, strike
and hold frames. This removes the T-pose guard, keeps the buckler arm and the
legs where `Idle` leaves them on the unkeyed bones, and makes the switch back
to `Idle` a pose the mixer already knows.

| clip | frames | guard | windup | strike | hold | guard | duration | `contactAt` |
|---|---|---|---|---|---|---|---|---|
| `Spear_Thrust` | 24 | 1 | 7 | **12** | 16 | 24 | 1.000 s | 12/24 = **0.5** |
| `Spear_Drive` | 30 | 1 | 10 | **15** | 20 | 30 | 1.250 s | 15/30 = **0.5** |

The exporter writes frame *f* at *f*/24 s (the shipped `Spear_Drive` is 1.250 s
with its strike at 0.625), so `contactAt` is `strike / last`. The hold key
repeats the strike pose so `clipMapping`'s contact+impact window
(`[0.50, 0.65] × D` = frames 12–15.6 and 15–19.5) plays a held strike, not the
start of the recovery.

#### 4.2.4 Keys (degrees, XYZ, relative to the bind pose; `hips:loc` in source units, bone-local)

Measured on the shipped `technical.glb` with the mid-grip projection applied,
`Idle` frame 0 on every unkeyed bone. Windup and strike are absolute values,
not deltas — including `hips:loc`. That one is Blender's pose-bone `location`:
the offset of the bone's head from its bind position, **in the bone's own
local frame and in scene (source) units** — for `hips` (§3) x = +X, y = along
the bone = up, z = forward; the 0.9149 rig scale turns 0.01 of it into 0.009
world, which is the ratio the measurement below quotes. `Idle` frame 0 keys
`hips.location = (0, −0.0136, 0)` (measured on `Rogue.glb`: the pelvis sits
1.4 cm below bind in the pack's idle), so the strike's absolute `(0, 0, 0.12)`
means 0.12 forward *and* the 0.0136 dip removed (a 0.012 world lift, under a
pixel). Windup keeps Idle's value. Two implementers keying these literals get
the same hop.

**`Spear_Thrust`** — a short cock and a straight-arm jab off the left foot:

| bone | windup (f7) | strike (f12) = hold (f16) |
|---|---|---|
| `chest` | (0, −12, 0) | (0, −22, 0) |
| `upperarm.r` | (−45, 0, −10) | (0, 0, 112) |
| `lowerarm.r` | (0, 0, 60) | (0, 0, 0) |
| `hand.r` | (0, 0, −50) | (0, 0, −90) |
| `upperleg.l` | Idle | (−22, 0, 0) |
| `lowerleg.l` | Idle | (22, 0, 0) |
| `upperleg.r` | Idle | (14, 0, 0) |

Measured strike: tip forward **1.769**, lateral −0.116, height 0.947; hand
0.475 forward; ankles at Idle height. Windup: tip 1.42 forward, 0.79 to the
right, hand 0.16 forward — the spear drawn back and out, then driven in and
across.

**`Spear_Drive`** — a deeper cock, a hip-and-chest turn and a lunge:

| bone | windup (f10) | strike (f15) = hold (f20) |
|---|---|---|
| `chest` | (−6, −14, 0) | (8, 20, 0) |
| `hips` | (0, −8, 0) | (4, 10, 0) |
| `hips:loc` | Idle | (0, 0, 0.12) |
| `upperarm.r` | (−30, 0, −30) | (10, 0, 65) |
| `lowerarm.r` | (0, 0, 80) | (0, 0, 0) |
| `hand.r` | (0, 0, −70) | (0, 0, −90) |
| `upperleg.l` | (10, 0, 0) | (−35, 0, 0) |
| `lowerleg.l` | Idle | (40, 0, 0) |
| `upperleg.r` | (−10, 0, 0) | (25, 0, 0) |

Measured strike with `hips:loc` 0.25: tip forward 2.208, lateral −0.070, height
0.917, hand 0.915 forward; each 0.01 of `hips:loc` moves the tip 0.009, so 0.12
lands at **≈ 2.09**. **That last figure is extrapolated, not measured**: the
0.12 pose was not among the 28 evaluated, so its lateral and height are
assumed to be the 0.25 pose's (a hips translation is a rigid shift of
everything above it, so they should be, to the rounding above), and the reach
assertion in §4.2.5 is what settles it — if 0.12 lands outside the window, the
implementer re-tunes `hips:loc` in 0.01 steps, not the arm. Windup: tip 1.19
forward, 1.22 to the right, hand 0.06 forward.

How the numbers were arrived at, so the implementer can re-tune rather than
re-discover: `upperarm.r` Z swings the arm forward (+90 = straight ahead) and
X raises it (+6° ≈ +0.19 of tip height on the thrust); `hand.r` Z −90 keeps
the spear along the forearm (in the bind pose it lies across it); a chest yaw
of −θ (left shoulder forward, thrust) or +θ (right shoulder forward, drive)
pulls the hand back or pushes it forward by ≈ 0.09 at 20°, and the arm's Z is
corrected by ∓θ so it still points ahead; `upperleg.*` X negative = leg
forward, positive = back; `lowerleg.l` X positive = knee bend.

#### 4.2.5 The reach assertion — the gate PR-2 is measured by

After the armature is scaled and before export, for each authored clip the
script evaluates the strike frame (tracks muted, the clip active, `POSE`
position), reads `weaponTip.matrix_world.translation − arm.matrix_world.
translation`, and **raises** unless forward, height and lateral fall inside
§4.2.2's windows. It logs the three numbers either way. This is the "measured
against `weaponTip`'s world position at `contactAt`" the 2026-09-04 spec asked
for, and it is the reason a future re-key cannot silently drift the tip off the
man again. `1H_Melee_Attack_Stab`'s and `2H_Melee_Attack_Stab`'s peak reach on
the re-gripped spear are logged too, for the record, not asserted.

#### 4.2.6 The flat region does not follow the widest radius down

Replayed with the camera suite's own `driveCamera` logic (a copy of
`ArenaCamera.ts` with the constants parameterised; the shipped configuration
reproduces `cameraTraces.ts` bit-for-bit: 15.435311 / 15.794692 / 16.233329,
crossings 1 / 3 / 1, 0 reversals everywhere, worst zoom rate 4.197 on trace
04). PR-2 radii = heavy 1.6798, fast 1.772876372587171, technical 1.5545:

| flat region ends at | trace 04 retiarius vs retiarius | `aquila vs drusus` | worst reversals elsewhere | worst zoom rate |
|---|---|---|---|---|
| 7.0003 (= widest band edge, the naive refresh) | 23 crossings, **4 reversals** | 13 crossings, **4 reversals** | 0 | 4.496 |
| 7.1003 (+0.1) | 21, **2** | 13, **4** | 0 | 4.458 |
| 7.2003 (+0.2) | 17, **2** | 11, **2** | 0 | 4.411 |
| 7.3003 (+0.3) | 7, 0 | 5, 0 | 0 | 4.356 |
| 7.4003 (+0.4) | 5, 0 | 3, 0 | 0 | 4.292 |
| **7.5312 (today's edge)** | **3, 0** (identical to today) | **3, 0** (identical to today) | 0 | **4.197** (identical to today) |

`expectSmoothFraming` allows at most 2 reversals and is not re-baselinable.
The cause is the one `cameraTraces.ts` already records for the stale-constant
pass of Task 7: when the flat region ends *exactly* at a pairing's own band
edge, that pairing's footwork around the 3.1 separation (hold range, lunge,
disengage) straddles the decision boundary tick after tick, and the 12 %
extent dead zone only damps it, it does not remove it. Today the retiarius
pairing is protected because the hoplomachus' spear pushed the edge 0.53 past
it. Once the spear is the shorter reach, nothing does — unless the edge is
kept.

So `ArenaCamera.ts` gains one constant and one line:

```ts
/** The largest extent the flat region has been validated at: the slow harness's floor and inset numbers, the five PNG baselines and the reversal ceiling were all measured with the flat region ending here (Task 7b). Moves UP when a measured radius pushes BAND_HIGH_EXTENT past it (the safe direction: more of the fight is flat, re-validated by the replay); never down without a re-sweep of the SWEPT pair. */
const FLAT_REGION_EDGE_FLOOR_EXTENT = 7.531226122787968
const FLAT_REGION_EDGE_EXTENT = Math.max(BAND_HIGH_EXTENT, FLAT_REGION_EDGE_FLOOR_EXTENT)
```

and `extentToDistance` compares against `FLAT_REGION_EDGE_EXTENT` instead of
`BAND_HIGH_EXTENT`. `WIDEST_EQUIPMENT_RADIUS` stays MEASURED and stays true
(it *is* the widest); `BAND_HIGH_EXTENT` stays the widest pairing's band edge
and stays load-bearing (the flat region must cover it — asserted, §5.1/§5.3);
the floor is a third class, VALIDATED, and its doc comment says which
measurements validated it. The `EASE_WIDTH_EXTENT` comment's "far clamp at
7.53 + 7.00 = 14.53" stays numerically true.

The alternatives were measured or reasoned out: a slack
constant (`+0.3` clears the ceiling at 7 crossings, `+0.4` at 5; both leave
the retiarius pairing crossing more than it does today for no gain, and the
value would be reverse-engineered from today's edge anyway — the floor says
what it is); a FLAT/EASE re-sweep (a slice of its own, per `cameraTraces.ts`'s
class rule, and nothing here needs it); a grip that keeps the spear the
widest rig (a 0.52 grip instead of 0.8 would hold the radius at ≈ 1.78 — but
the band edge would then sit at 7.02, still exactly at the retiarius pairing's
own edge, so it would chatter the same way; the reach at §4.2.2's medians
would also need every pose re-measured). Keeping the edge is the one option
that changes no framing anyone has looked at.

**What PR-2 re-records, then.** Traces 01 and 04 do not move at all (their
radii and the flat edge are unchanged from PR-1); trace 07 moves in opening
distance only (16.2333 → ≈ 15.373, crossings 1 → 1, `ticks` 1261 held). The
zoom-rate margin stays 4.197 against 5, recorded in the `cameraTraces.ts`
history comment.

#### 4.2.7 Mapping

`ATTACK_CLIPS['technical-thrust']` = `{ clip: 'Spear_Thrust', contactAt: 0.5 }`.
`technical-driving-thrust` stays `Spear_Drive` at 0.5. `requiredClipsFor
('technical')` then lists both authored clips and stops listing
`1H_Melee_Attack_Stab`.

**One-handed, deliberately.** "Two-handed reach, like the trident's" is taken
as the *amplitude* — full arm, chest turn, lead step — not the grip: the
hoplomachus' off hand holds the parma, and the pack's `2H_Melee_Attack_Stab`
swings whatever is on `handslot.l` onto the shaft (the retiarius' net does
exactly that today, and the owner passed it as "not bad for this level"; a
buckler doing it would read as a mistake). The buckler arm keeps its `Idle`
pose in both clips. §10 lists this as the one interpretation the owner may
want to reverse.

### 4.3 Build-script structure

`BUILDS` becomes:

```python
'heavy':     {'source': 'Barbarian.glb',
              'donor': ('Knight.glb', {'1H_Sword': 'weapon', 'Rectangle_Shield': 'shield'}),
              'weapon_reference': '1H_Sword', 'shield_reference': 'Rectangle_Shield',
              'build': ['galea', 'manica', 'greave'], 'clips': []},
'fast':      {'source': 'Barbarian.glb', 'weapon_reference': '1H_Axe', 'shield_reference': None,
              'build': ['trident', 'net'], 'clips': []},
'technical': {'source': 'Rogue.glb', 'weapon_reference': 'Knife', 'shield_reference': None,
              'build': ['spear', 'buckler'], 'clips': ['Spear_Thrust', 'Spear_Drive']},
```

References are per archetype, not per source file: `heavy` measures its
anchors off the transplanted Knight props, `fast`/`technical` no longer name a
shield reference at all (closing the 2026-09-04 spec §10 "phantom
`SHIELD_REFERENCE`" item — the entry existed only to be kept alive and
deleted). The build log prints, per archetype, the mesh list with slots, the
clip list, the anchors, and (technical) the reach numbers.

Left open from that §10 list, on purpose: `inspect-glb.mjs --assert` and the
temp-directory export. Neither is needed to land this track and each is its
own small change.

## 5. Tests and baselines

### 5.1 Unit (fast, `npm test`)

| file | change | why |
|---|---|---|
| `src/presentation/fighterModelContract.test.ts` | no edit; passes once `'armour'` is in `MESH_SLOTS` and `BODY_SILHOUETTE_SLOTS` (partition test), once `heavy.glb` stands 2.0 from the Barbarian body, and once `technical.glb` carries `Spear_Thrust`. Update the stale comment "1.728 (heavy)" → 1.830. | the contract |
| `src/presentation/clipMapping.test.ts` | **add** a strike-frame alignment case for `technical-thrust` with `Spear_Thrust` at 1.0 s in the hand-built duration map, alongside the existing `heavy-cleave` one | the new mapping row has no unit coverage today |
| `src/presentation/ArenaCamera.test.ts` | `RIG_EQUIPMENT_RADIUS.heavy` (PR-1) and `.technical` (PR-2) to the browser-measured values; `BAND_LOW` recomputed (PR-1). **`BAND_HIGH` stays `7.531226122787968`**: it is the flat region's edge, which §4.2.6 keeps; its comment is rewritten to say the widest *band* edge is now `3.1 + 2 × 1.772876372587171 × 1.1 = 7.000328019691777` and sits 0.53 inside the flat region by the floor. **The dead-zone straddle literals `insideDeadZone = 0.89` / `outsideDeadZone = 0.91` (lines 425/441) and the `0.12 × 7.531226122787968 = 0.9037` comment therefore do not move**; an implementer who "refreshes" them to 0.84 has moved the wrong constant. **Add** one case under "framing distance over real bouts": `extentToDistance(3.1 + 2.2 × max(RIG_EQUIPMENT_RADIUS))` equals `FLAT_DISTANCE` — the fast-suite mirror of the slow pin, so a stale floor or a rig that grows past it fails in `npm test`, not twelve minutes later | mirrors of MEASURED constants; the flat edge is VALIDATED (§4.2.6) |
| `src/testSupport/frozenFixtures/cameraTraces.ts` | re-record `openingDistance` and `crossings` for trace 01 (PR-1: heavy radius; replay predicts 15.4353 → ≈ 15.6175, crossings 1 → 1) and for trace 07 only (PR-2: technical radius; 16.2333 → ≈ 15.373, crossings 1 → 1). Traces 04 (PR-1, PR-2) and 01 (PR-2) are predicted not to move; if they do, something other than the radius changed. **`ticks` must not move** (1827 / 1705 / 1261); if one does, stop — the simulation changed. Reason stated in the commit, per the file's own rule; the history comment records the zoom-rate margin (4.197 against 5, unchanged) | the recorded class distinction |
| `src/presentation/ArenaCamera.ts` | PR-2: `WIDEST_EQUIPMENT_RADIUS = 1.772876372587171` with the history comment extended; **`FLAT_REGION_EDGE_FLOOR_EXTENT` and `FLAT_REGION_EDGE_EXTENT` added** and `extentToDistance` switched to the latter (§4.2.6). Nothing else | MEASURED, plus one VALIDATED floor; the SWEPT pair untouched |
| `src/presentation/ArenaView.ts` | `BODY_SILHOUETTE_SLOTS` + `'armour'`; the rig-scale comment (0.8641 heavy → 0.9149; "about 1.73 for the murmillo" → 1.83) | slot partition; stale numbers |

### 5.2 e2e (fast, `npm run test:e2e`)

- `tests/combat-visuals.spec.ts`: **extend** the `freezes technical
  measure/parry/counter` test at tick 908 with
  `expectClip(…, 'away.cassius', 'technical', ATTACK_CLIPS['technical-thrust'].clip, 't908 thrust windup')`
  — Cassius is mid `technical-thrust` windup there (his contact is 913), so
  this is the frozen tick that proves `Spear_Thrust` is selected and played
  inside its GLB duration. Everything else in the file reads the contract
  tables and survives both PRs unchanged. The nested-bounds test's `home.nerva`
  overhang (> 5 px) still holds with the shaft crossing the fist.
- **Screenshot baselines.** In **each** PR delete all five arena PNGs on both
  platforms (`tests/__screenshots__/{win32,linux}/{heavy-cleave,fast-burst,
  technical-parry,combat-outcomes,combat-safe-frame}.png`), regenerate win32
  locally, Linux via `gh workflow run update-baselines.yml --ref <branch>`,
  and look at every regenerated frame before committing. Why all five, twice:
  four captures field the murmillo (PR-1); in PR-2 the camera mapping is
  unchanged (§4.2.6) but its *input* is — every frame with a hoplomachus in it
  is centred on a group box 0.5 narrower on his side, and two hoplomachi hold
  re-gripped spears in `technical-parry.png`. The three `brutus vs drusus`
  captures are expected to come back pixel-identical in PR-2; regenerating
  them is how that expectation is checked rather than assumed (the commit
  body says which files did not change). `updateSnapshots: 'none'` never rewrites a passing file and the
  4 % ratio passed stale rig baselines at 2.06–3.48 % — deleting is the only
  guard (README, `playwright.config.ts`). `planning.png` and `season-board.png`
  must not move.

### 5.3 e2e (slow, `npm run test:e2e:slow`) — the legibility gate

Run once per PR, numbers pasted into the PR body. What must hold, unchanged
from the harness as written:

- band-edge pin (group 0, `legibility.spec.ts:681-708`): today it asserts
  `flatRegionEdgeExtent` **equals** the widest pairing's band edge to three
  decimals, which PR-2 makes false by design (§4.2.6: 7.5312 vs 7.0003). Task 9
  rewrites it as two assertions: `flatRegionEdgeExtent ≥ widestBandHigh − 5e-4`
  (the identity the file's "in band" rests on — every pairing's band is inside
  the flat region — is now an inequality, and this is the line that catches
  a stale `WIDEST_EQUIPMENT_RADIUS` when a rig grows) and
  `flatRegionEdgeExtent` close to `max(widestBandHigh, 7.531226122787968)` to
  three decimals (the floor, mirrored as a literal with the same comment the
  file carries today for the old literal). The bisect that finds the edge from
  `extentToDistance` stays; it is what makes this a measurement of the mapping
  rather than of a constant. Unchanged by PR-1 (the murmillo is not the widest
  rig).
- p92 body height ≥ 130 px in all nine pairings at 1280×820. Expected
  direction: up for the **five** pairings that field a murmillo — 01
  `brutus vs drusus`, 02 `brutus vs cassius`, 03 `brutus vs magnus`, 06
  `aquila vs magnus`, 09 `nerva vs magnus` (body box 1.73 → 1.83 plus a taller
  helmet); flat for the other four. If any pairing drops below 130, the fix is
  `TARGET_HEIGHT` or `FLAT_DISTANCE` reported with the measurement, never the
  bar.
- 5 % inset, 27 cells: zero violations everywhere except `05 aquila vs cassius
  @1024x768`, which stays asserted against its recorded bound (≤ 12 ticks,
  ≥ −18 px). The murmillo's gladius, shield, helmet and armour are *not*
  exempt and must stay inside on every tick of the five murmillo pairings; the
  brim (1.72 wide) and the crest (2.45 high) are the two new things that could
  touch an edge. Pairing 05 after PR-2: the camera mapping is unchanged
  (§4.2.6), but Cassius' equipment half-width shrinks by ≈ 0.5 extent, so the
  group box the camera centres on is narrower on his side (the frame
  re-centres ≈ 0.25 units toward Aquila, whose own body is the recorded
  offender) and the eased region starts ≈ 0.5 of separation later. Which way
  that moves the 12 ticks is for the slow run to say. If it measures **zero**
  violations, remove its `KNOWN_SAFE_AREA_DEVIATIONS` entry in that PR with
  the measurement in the commit; a deviation entry that no longer measures
  anything is stale. If it exceeds the bound, stop and report; do not widen it.

### 5.4 The build itself

- `node tools/inspect-glb.mjs public/models/*.glb` before and after: `fast.glb`
  must list the same meshes, slots, anchors and clips (the run rebuilds it; its
  code path is untouched, so its bytes are expected to be identical — commit
  it if they are not, the content is the same).
- `heavy.glb`: **15** mesh nodes with the slots in §4.1 (6 + 4 + 3 + 1 + 1),
  **4 materials + 2 images** (§4.1; today's file lists `materials 1 images 1`,
  the Knight atlas alone), 12 clips, under 2 MiB (expected ≈ 0.75 MB). A build
  that lists 5 materials has created `kit_bronze` twice; 3 has merged the
  crest into the bronze.
- `technical.glb`: 14 clips (12 pack + 2 authored), `Spear_Thrust` 1.000 s,
  `Spear_Drive` 1.250 s; the build log's reach lines inside §4.2.2's windows.

### 5.5 Manual

One screenshot of a live bout per pairing that fields the murmillo (PR-1) and
one of `nerva vs cassius` at a thrust contact and a driving-thrust contact
(PR-2), attached to the PR, with a sentence each on whether the tip reads as
landing. Plus the AGENTS.md Playwright screenshot.

## 6. Check commands

```bash
# build (Blender 5.2 headless; runs through cmd exactly as package.json writes it)
npm run models:build
node tools/inspect-glb.mjs public/models/heavy.glb public/models/fast.glb public/models/technical.glb

# unit
node node_modules/vitest/vitest.mjs run --project fast src/presentation/fighterModelContract.test.ts
node node_modules/vitest/vitest.mjs run --project fast src/presentation/clipMapping.test.ts
node node_modules/vitest/vitest.mjs run --project fast src/presentation/ArenaCamera.test.ts
node node_modules/vitest/vitest.mjs run --project fast
node node_modules/typescript/bin/tsc --noEmit

# e2e fast (after deleting the five PNGs; first run fails with "snapshot missing", then:)
node node_modules/@playwright/test/cli.js test tests/combat-visuals.spec.ts --update-snapshots
node node_modules/@playwright/test/cli.js test --project fast
gh workflow run update-baselines.yml --ref <branch>      # Linux set

# e2e slow (12+ min; the gate in §5.3)
node node_modules/@playwright/test/cli.js test --project slow

# before handoff
npm run check
```

## 7. Implementation tasks

Each task is one agent and one commit; each leaves `npm test` green.
Conventional-commit types as the history uses them.

**PR-1 — `feature/murmillo-kit`**

1. **`feat(arena): armour slot for worn kit`** — `MESH_SLOTS` + `'armour'`,
   `BODY_SILHOUETTE_SLOTS` + `'armour'`, partition test green, the two comment
   blocks that explain the slot sets updated. No-op for the shipped files.
2. **`feat(models): murmillo from the Barbarian body with galea, manica and greave`**
   — build script: per-archetype references (§4.3), donor transplant,
   `build_galea` / `build_manica` / `build_greave` with §4.1's numbers,
   `weapon_axis` sanity assertion; rebuild; commit `heavy.glb` (and `fast.glb`
   / `technical.glb` only if their bytes moved with identical inspect output).
   Contract test green; inspect output in the commit body.
3. **`test(camera): refresh the murmillo's measured radius`** — read the heavy
   radius in the browser, update `RIG_EQUIPMENT_RADIUS.heavy`, `BAND_LOW`,
   re-record trace 01 (`ticks` 1827 held; traces 04 and 07 predicted
   unchanged), extend the history comments in `ArenaCamera.ts`,
   `ArenaCamera.test.ts`, `cameraTraces.ts`. `WIDEST_EQUIPMENT_RADIUS` does not
   move (the spear is still the widest).
4. **`test(e2e): re-capture the arena baselines for the murmillo kit`** —
   delete the five PNGs on both platforms, regenerate win32, run the workflow
   for Linux, review each frame; the commit body names what changed in each.
5. **`docs(kit): the murmillo as built`** — README §rig paragraph (line 32),
   `docs/reference/gladiator-equipment.md` §1 rows re-pointed from
   `STYLE_SPECS` fields to the built mesh names (manica now drawn), the
   2026-09-04 spec's mapping table marked superseded by this document,
   `ArenaView.ts` / `fighterModelContract.test.ts` stale scale numbers. The
   rig scale is quoted in three places (`ArenaView.ts:134`, the 2026-09-04
   spec §7, this document) and today's `ArenaView.ts` writes the Barbarian's
   as `0.9148` where `2 / 2.186` rounds to `0.9149`; the build log prints the
   scale it applied to full precision — quote *that* value, rounded to four
   decimals, in all three, so the comments agree after the edit.
6. **Slow legibility run** (no commit unless a number in the harness must
   move): the §5.3 lines pasted into the PR body.

**PR-2 — `feature/spear-thrust`** (branch from PR-1's merge)

7. **`feat(models): grip the spear mid-shaft and author Spear_Thrust`** —
   `grip_behind=0.8` on the spear, `author_clip` with the Idle-frame-0 guard,
   §4.2.4's keys for both clips, the reach assertion (§4.2.5),
   `AUTHORED_CLIPS`; rebuild; commit `technical.glb`. The build log's reach
   lines go in the commit body. Contract test still green (`Spear_Thrust` is
   simply an extra clip until task 8).
8. **`feat(arena): technical-thrust plays Spear_Thrust`** — `ATTACK_CLIPS`
   row, `clipMapping.test.ts` case, the tick-908 `expectClip` in
   `combat-visuals.spec.ts`.
9. **`test(camera): the retiarius is the widest rig; the flat region keeps its edge`**
   — `WIDEST_EQUIPMENT_RADIUS` → `1.772876372587171`;
   `FLAT_REGION_EDGE_FLOOR_EXTENT = 7.531226122787968` and
   `FLAT_REGION_EDGE_EXTENT` added, `extentToDistance` switched to it
   (§4.2.6); `RIG_EQUIPMENT_RADIUS.technical` from the browser; `BAND_HIGH`
   in the test **left at 7.531226122787968** with its comment rewritten, the
   dead-zone literals 0.89/0.91 left alone, the new fast-suite band-coverage
   case added (§5.1); trace 07 re-recorded (`ticks` 1261 held; 01 and 04
   predicted unchanged), the `cameraTraces.ts` history comment carrying the
   §4.2.6 table's headline (23 crossings / 4 reversals at the naive edge, 0
   at the kept one, zoom rate 4.197 unchanged); the `legibility.spec.ts` pin
   rewritten as §5.3's two assertions with its comment (lines 694–702)
   extended. `npm test` green is the gate for this task and the replay says
   it will be; if `expectSmoothFraming` fails anyway, stop and report — do
   not touch the ceiling.
10. **`test(e2e): re-capture the arena baselines for the spear clips`** — as
    task 4.
11. **`docs(kit): the spear as built`** — README (two authored clips, the
    grip), equipment bible §2 (grip note), the 2026-09-04 spec §10 item marked
    closed with a pointer here; slow legibility run with the §5.3 lines in the
    PR body, and the pairing-05 deviation entry removed if it measured zero.

## 8. Rejected alternatives

- **Keep the Knight and only swap the helmet.** The finding is the plate, not
  the helm; a galea on plate is still a knight.
- **Solid-colour sword and shield (drop the Knight atlas).** The atlas is
  14 KB and carries the blade/hilt contrast and the shield's emblem; building
  a scutum from primitives would lose the pack's curved slab for nothing.
- **Tag the manica and greave `helmet` (no new slot).** Reuses a name for a
  thing it is not; the partition test exists precisely so a new worn slot is a
  deliberate act. `body` is impossible (§4.1).
- **Six laminated rings per arm.** Sub-pixel gaps; six objects for the look of
  two.
- **A built belt and loincloth over the Barbarian's own.** Invisible
  duplication (§4.1).
- **Fix `Spear_Drive` by re-keying only, grip unchanged.** At the driving
  thrust's median (1.78) the hand would sit 0.05 *behind* the origin with the
  spear pointed straight ahead — an arm hanging at the side, not a thrust. At
  the thrust's median it is impossible outright (§3).
- **Shorten the spear to ~1.3 units instead of moving the grip.** Same camera
  ripple, and a spear two-thirds of the man's height reads as a javelin; the
  spear line is one of the three positive cues.
- **Map `technical-thrust` to the pack's `2H_Melee_Attack_Stab`.** Zero Blender
  work, but it is the retiarius' signature lunge, it puts the buckler hand on
  the shaft, and on the butt grip it reaches 2.44 at a 1.47 median.
- **Change `contactAt` instead of the keys.** Forbidden by the 2026-09-04 spec
  §10, and it would not move the tip: the strike frame is wherever the pose
  is.
- **Raise the thrust's `contactRange.min` so the clip fits.** Simulation; the
  playtest's item 1, a balance slice with its own baselines.
- **Both hands on the shaft for `Spear_Thrust`.** The parma leaves the hand
  for the clip's duration or rides onto the shaft; either is a visible
  mistake on the one type defined by spear-plus-small-shield (§4.2.7).
- **Delete only the PNGs "that should move".** Judgement the 4 % ratio has
  already been shown not to make for us; a workflow run costs minutes.

## 9. Risks

- **The crest and brim against the top and side insets at 1024×768.** The
  helmet top rises 0.32 world units and the brim is 1.72 wide; both are worn,
  not exempt. The slow run decides; the fallback is a lower crest (0.18) or a
  narrower brim (0.76), not a rule change — the murmillo has never had a
  deviation and must not acquire one for a hat.
- **The heavy's `bodyHeightPx` now includes 0.45 units of helmet above the
  crown**, so the floor is easier for the five murmillo pairings than the
  drawn man alone would make it. That is by design, not an accident of this
  slice: `ArenaView.ts` defines `BODY_SILHOUETTE_SLOTS` as "the man and what
  he wears" (line 254) and the `bodyHeightPx` field doc says "helmet and crest
  included" (lines 113–115); the 2026-09-04 spec §7 records only the separate
  bind-pose-box caveat. The `armour` slot joins that set for the same reason.
  The binding pairings for the floor remain 04/05/07/08, which field no
  murmillo.
- **Two atlases in `heavy.glb`.** 14 KB, one extra draw call per murmillo.
- **The transplant's world placement assumes the Knight's and Barbarian's
  `handslot` bones coincide** — they do (identical skeleton, §3), and the
  contract test's anchor check plus `inspect-glb` catch a misplaced sword.
- **Rigid sleeves and a knee-covering greave on a skinned limb** clip at the
  joints in extreme poses (`Death_A`). Accepted at this size.
- **Camera re-records twice in two PRs.** Mechanical for the *radii* (Task
  7/7b precedent; `ticks` holding is the tell that nothing else moved) — but
  the first draft of this document treated the band edge the same way and
  the replay said no (§4.2.6): the flat region's edge is a validated quantity
  the radius refresh must not drag down. The residual risk is the replay
  itself being a lookalike of the browser camera; it is not (it reproduces
  the three recorded traces to the last printed digit), and the slow run's
  pin is the second opinion.
- **The recovery half of each authored clip is a plain ease back to Idle**
  (no key between hold and guard). If it reads as a slide, one intermediate
  key at 70 % of the clip is the fix; not pre-authored because it cannot be
  measured, only watched.

## 10. Open questions for the design owner

1. **"Two-handed reach" — amplitude or grip?** This document reads it as
   amplitude and keeps the parma in the left hand (§4.2.7). If you meant both
   hands on the shaft, say so and the buckler arm gets keys of its own in
   task 7 (and the buckler will visibly ride the shaft, as the net does).
2. **The Barbarian's fur kilt stands in for the subligaculum and his own belt
   for the balteus (§4.1).** If you want a bare-legged loincloth look, that is a
   texture edit on a copy of the Barbarian atlas — a separate slice, not
   primitives.

## Review notes (2026-09-17, after the first review)

Every point was checked against the worktree before it was accepted or
rejected. The camera claims were replayed, not reasoned about: a copy of
`ArenaCamera.ts` with its constants parameterised, driven by the test's own
`driveCamera` over the three recorded traces and the nine standalone
pairings; the shipped configuration reproduces `cameraTraces.ts` to the last
printed digit (§4.2.6).

**Accepted, blocking.**

- *Task 9 cannot leave `npm test` green.* Confirmed exactly: flat region at
  7.0003 gives trace 04 23 crossings / 4 reversals and `aquila vs drusus`
  13 / 4 against a ceiling of 2. Resolved by keeping the flat region's edge
  through `FLAT_REGION_EDGE_FLOOR_EXTENT` (§4.2.6), with the slow pin relaxed
  to `≥` plus a pin on the floor (§5.3) and a fast-suite mirror (§5.1). The
  slack and re-grip alternatives were measured or reasoned out in §4.2.6.
- *The dead-zone straddle literals.* Confirmed arithmetically (0.89 > 0.12 ×
  7.0003 = 0.8400). Moot under the chosen resolution — `BAND_HIGH` in the test
  stays 7.5312 — but §5.1 now says so explicitly so nobody "refreshes" them.
- *14 vs 15 mesh nodes; 2 vs 4 materials.* Confirmed: the list sums to 15,
  and `solid_material` makes one material per call, so Barbarian +
  `knight_texture` + `kit_bronze` + `galea_crest` = 4 (shipped `technical.glb`
  lists 4 for the same reason). §4.1 and §5.4 corrected, with the
  share-one-`kit_bronze` requirement stated.

**Accepted, suggestions.**

- Five murmillo pairings, not six (03 was counted twice): §5.3 and §9.
- `hitCenter` is 0.84 / 0.89 / 0.889 as shipped, not 0.92: §4.1 and §4.2.2.
- The helmet-in-the-floor citation is `ArenaView.ts` (`BODY_SILHOUETTE_SLOTS`,
  line 254; field doc lines 113–115), not the 2026-09-04 spec §7: §9.
- `hips:loc` frame, units and the Idle baseline — measured in Blender
  (`Idle` frame 0 keys `hips.location = (0, −0.0136, 0)`) and stated; the 0.12
  extrapolation is now labelled as such: §4.2.4.
- The reach windows mirror the catalogue and must be re-measured with the
  playtest's items 1–2: §4.2.2, and a comment in the build script.
- PR-1 hypothesis split into the eye's claim and the harness's gate: §1.
- `0.9148` vs `0.9149`: the build log's printed scale is the source, quoted
  the same way in all three places: task 5.
- Zoom-rate headroom: 4.197 against 5, unchanged, because the flat edge is
  unchanged; recorded in §4.2.6 and the `cameraTraces.ts` history comment.

**Rejected.** None. One correction to the review's own numbers, for the
record: the review replayed with only `WIDEST_EQUIPMENT_RADIUS` changed and
the shipped radii; with PR-2's actual radii (heavy 1.6798, technical 1.5545)
the retiarius pairing's figures are identical (23 / 4 and 13 / 4 — that
pairing's radii do not change), and trace 07's regression in the review's
variant (13 / 4) does not occur (3 / 0), because the hoplomachus' band edge
moves down with his spear. The conclusion stands either way.
