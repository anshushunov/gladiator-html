# Gladiator equipment bible

**Scope.** The three types this game draws — **murmillo** (`heavy`),
**hoplomachus** (`technical`), **retiarius** (`fast`) — element by element: what
is drawn, which mesh carries it, how well the element is attested, and where
the attestation comes from.

*Which mesh* means, for the murmillo (§1, re-pointed 2026-09-17), the mesh
node in `public/models/heavy.glb` and its `extras.slot`, as
`tools/blender/build_gladiators.py` builds it and `tools/inspect-glb.mjs`
prints it. §2 and §3 still name the fields of the procedural rig's
`STYLE_SPECS` (`src/presentation/ProceduralFighter.ts`, deleted with the
2026-09-04 skinned-gladiators slice); they are re-pointed the same way when
their kits are next touched.

**Why it exists.** The design spec
(`docs/superpowers/specs/2026-08-23-readable-gladiator-types-design.md`,
"Constraints carried from the review") requires that every equipment claim carry
a confidence level and that contested details be listed as explicitly *not*
asserted. Authoring the silhouettes against this table is what stops invented
detail getting drawn and then rationalised afterwards.

**What is a claim and what is not.** *Equipment is the historical claim;
behaviour is our reading of it.* The "interpretation" column in
§5 is a gameplay reading suggested by the kit, **not an attested ancient
technique**. Nothing in this document asserts how a type actually fought.

## Confidence levels

| Level | Meaning |
|---|---|
| **attested** | Present in the surviving arms corpus and/or repeatedly and consistently shown in the iconography for this type. |
| **reconstructed** | Not directly preserved for this type, but inferred from related finds, from iconography that is consistent but sparse, or from the modern scholarly reconstruction consensus. |
| **contested** | Scholars disagree, or the claim rests on a single ambiguous source. **Contested details are not drawn and not asserted.** |

## Sources

Short keys used in the tables below. Citations are at work/corpus level, not
page-precise; a reviewer holding the volume should be able to find each claim in
the named chapter or object group.

| Key | Source |
|---|---|
| `Junkelmann-2000` | Marcus Junkelmann, "Familia Gladiatoria: The Heroes of the Amphitheatre", in E. Köhne & C. Ewigleben (eds), *Gladiators and Caesars: The Power of Spectacle in Ancient Rome*, British Museum Press, 2000, ch. 3 (pp. 31–74). The standard type-by-type typology; built directly on the Pompeii finds. |
| `Junkelmann-2008` | Marcus Junkelmann, *Gladiatoren: Das Spiel mit dem Tod*, Philipp von Zabern, 2008. Extended treatment, including experimental reconstruction. |
| `Pompeii-arms` | The gladiatorial arms recovered from the Quadriporticus of the Theatres (Regio VIII), Pompeii, now Museo Archeologico Nazionale di Napoli: bronze helmets, greaves, a *galerus*, shield fittings. The single largest corpus of real gladiatorial equipment, and the reason helmet and greave forms are unusually well grounded. |
| `Zliten` | The Zliten mosaic, Villa of Dar Buc Ammera, Libya, c. AD 100–200 (Tripoli). Types in action, including retiarius, hoplomachus and murmillo. |
| `Borghese` | The Torrenova ("Borghese") gladiator mosaic, c. AD 320, Galleria Borghese, Rome. Fighters shown with name labels. |
| `Nennig` | The Nennig villa mosaic, Germany, 2nd–3rd c. AD. |
| `Juvenal-8` | Juvenal, *Satires* 8.199–210 — the retiarius fights bare-faced, with net and trident; the *retiarius tunicatus* as a scandalous variant. |
| `Suetonius-Cal-30` | Suetonius, *Caligula* 30 — retiarii fighting in tunics, without helmet. |
| `Festus` | Festus, *De verborum significatu*, s.v. the murmillo/*mormylos* fish etymology and the murmillo–retiarius pairing. |
| `Nossov-2009` | Konstantin Nossov, *Gladiator: Rome's Bloody Spectacle*, Osprey, 2009. Popular synthesis; used only where it agrees with `Junkelmann-2000`. |

---

## 1. Murmillo — archetype `heavy`

As built on 2026-09-17 (`docs/superpowers/specs/2026-09-17-kit-design.md`
§4.1): the Barbarian body from the KayKit pack, the Knight's sword and shield
transplanted onto its identical skeleton, and the bronze pieces built by the
script from primitives. Before that he was the Knight entire, in plate, and
read as a knight.

| Element | Shape as drawn | Mesh in `heavy.glb` (slot) | Confidence | Source |
|---|---|---|---|---|
| Curved rectangular **scutum** | Tall slab, bowed forward about a vertical axis; chord clearly narrower than its height; carried on the off (left) arm | `Rectangle_Shield` (`shield`) — the Knight's mesh under `handslot.l`, with its `knight_texture` emblem | **attested** | `Junkelmann-2000`, `Zliten`, `Nennig` |
| **Gladius** | Short straight blade with a crossguard, held point-forward-and-down | `1H_Sword` (`weapon`) — the Knight's mesh under `handslot.r`; `weaponTip` sits at its far end | **attested** | `Junkelmann-2000`, `Pompeii-arms`, `Borghese` |
| Broad-**brimmed helmet** with face guard | Bronze 16-segment dome under a cone, over a flat brim 1.72 source units across — wider than the torso, the murmillo's signature at any distance; worn on the `head` bone | `galea_dome`, `galea_cap`, `galea_brim` (`helmet`), all in the shared `kit_bronze` material | **attested** | `Pompeii-arms`, `Junkelmann-2000` |
| **Crest** (*crista*) | Plain dark comb 0.26 source units tall, running front to back on top of the cap | `galea_crest` (`helmet`), material `galea_crest` | **attested** *(the crest; see §4 for its decoration, and §6 for why it is drawn low)* | `Pompeii-arms`, `Junkelmann-2000` |
| **Manica** on the sword (right) arm | Two rigid bronze sleeves, one per arm bone, bending at the elbow with the arm; the lower one stops short of the wrist so it does not fight the Barbarian's own fur bracer | `manica_upper` on `upperarm.r`, `manica_lower` on `lowerarm.r` (`armour`) | **attested** | `Junkelmann-2000`, `Pompeii-arms` |
| One **ocrea** on the lead (left) leg | Bronze band on the lower leg running from just above the boot to over the knee. **Drawn but still not observable**: the 2026-09-17 re-capture of the arena baselines shows it in none of the four murmillo frames (the camera views him from behind and above, and the band sits under the kilt hem and the boot cuff), so it is a fidelity item, not a working cue, and nothing is built on it | `greave` on `lowerleg.l` (`armour`) | **attested** | `Junkelmann-2000`, `Pompeii-arms`, `Zliten` |
| No shoulder guard | — (nothing built) | — | **attested** (the *galerus* is the retiarius' piece) | `Junkelmann-2000` |
| No torso armour | The Barbarian's own six skinned meshes as the pack paints them: a sleeveless tunic, a belt with a round buckle and a fur kilt; no armour mesh over them. The pack's belt and kilt stand in for the *balteus* and *subligaculum* (a second belt built over the first would be invisible) | `Barbarian_Body`, `Barbarian_Head`, `Barbarian_ArmLeft/Right`, `Barbarian_LegLeft/Right` (`body`) | **attested** (the absence of torso armour) | `Junkelmann-2000`, `Zliten`, `Nennig` |
| Type colour | Bronze kit (`kit_bronze` 0.72, 0.50, 0.20) on a body the pack paints; bronze because the plate was grey and this must not read as plate, and a dark crest because the HUD already owns red and blue. The procedural rig's per-type cloth colour is gone with it | `kit_bronze`, `galea_crest` materials | **not a historical claim** — a legibility choice, see §6 | — |

The manica, recorded in this section as "attested but deliberately not drawn"
while the procedural rig had no arm-armour builder, is drawn since 2026-09-17.
The two sleeves are the rigid-cylinder-on-a-bone form the pack's scale allows: a
laminated look needs gaps under a pixel at the shipped framing.

## 2. Hoplomachus — archetype `technical`

| Element | Shape as drawn | `STYLE_SPECS` field | Confidence | Source |
|---|---|---|---|---|
| Thrusting **spear** (*hasta*) | Long wooden shaft with a bronze conical head, held out along the hand→tip line | `weaponKind: 'spear'`, `weaponLength`, `weaponWidth`, `weaponThickness`, `weaponForwardBias` | **attested** | `Junkelmann-2000`, `Zliten` |
| Small round **parma** | Flat bronze disc, markedly smaller than the murmillo's scutum | `shieldKind: 'parma'`, `shieldWidth`, `shieldHeight`, `shieldThickness`, `shieldForwardOffset` | **attested** | `Junkelmann-2000`, `Pompeii-arms`, `Zliten` |
| Broad-**brimmed helmet** | Bronze dome plus a wide flaring brim, no crest block | `helmetKind: 'brimmed'` | **attested** | `Pompeii-arms`, `Junkelmann-2000` |
| Two high padded **greaves** | Box greaves on both legs, growing from the ankle to near the knee | `greaves: 'two-high'` | **attested** — the tall pair is this type's most distinctive leg signature | `Pompeii-arms`, `Junkelmann-2000`, `Zliten` |
| No shoulder guard | — (nothing drawn) | `shoulderGuard: false` | **attested** | `Junkelmann-2000` |
| Bare torso | No armour mesh | `hasLightArmor: false` | **attested** | `Junkelmann-2000`, `Zliten` |
| Type colour | Mid olive-green on the loincloth and legs | `clothColor` | **not a historical claim** — see §6 | — |

**Attested but deliberately not drawn:**

- The helmet's **crest tube and side plume tubes**. Hoplomachus helmets in the
  Pompeii corpus carry a crest holder and a feather tube at each temple
  (`Pompeii-arms`, `Junkelmann-2000`). The rig can draw one crest block
  (`helmetKind: 'brimmed-crested'`) but not plume tubes, and giving the
  hoplomachus the same crest block as the murmillo would spend the one crown
  cue the rig has on making two types look alike. `'brimmed'` is therefore a
  deliberate legibility omission, not a claim that the helmet was crestless.
- The **secondary short blade**. Attested for this type, but the engine has a
  single weapon stream, so a second weapon would be inert scenery. Not drawn,
  and no field carries it.

## 3. Retiarius — archetype `fast`

| Element | Shape as drawn | `STYLE_SPECS` field | Confidence | Source |
|---|---|---|---|---|
| **Net** (*rete*) | A gathered head gripped in the off (left) fist plus a fall of four cords of unequal length, hanging under the fist. `shieldWidth` is the spread, `shieldHeight` the longest cord, `shieldThickness` a cord's cross-section | `offhandProp: 'net'`, `shieldWidth`, `shieldHeight`, `shieldThickness` (these size the off-hand prop when `shieldKind` is `'none'`) | **attested** *(the net; the gathered-and-falling form is a rendering choice — see §6)* | `Juvenal-8`, `Zliten`, `Junkelmann-2000` |
| **Trident** (*fuscina*) | Long shaft with three bronze prongs on a spread head | `weaponKind: 'trident'`, `weaponLength`, `weaponWidth`, `weaponThickness`, `weaponForwardBias` | **attested** | `Juvenal-8`, `Zliten`, `Borghese`, `Junkelmann-2000` |
| **No shield** | Nothing under `shieldCenter` | `shieldKind: 'none'` | **attested** — the absence is the attestation, not an inference | `Juvenal-8`, `Suetonius-Cal-30`, `Junkelmann-2000` |
| **No helmet** | Bare head; only the shared visor slot of §6 | `helmetKind: 'none'` | **attested** — the one type that fought bare-faced | `Juvenal-8`, `Suetonius-Cal-30`, `Zliten` |
| **Galerus** on the off (left) shoulder | Bronze plate over the left shoulder, narrow across the shoulders and long fore-and-aft, tucked inboard of the shoulder joint and stopping below the head (see §6) | `shoulderGuard: true` | **attested** — a galerus is in the Pompeii corpus and is this type's diagnostic piece | `Pompeii-arms`, `Junkelmann-2000`, `Zliten` |
| No greaves | — (nothing drawn) | `greaves: 'none'` | **attested** — the least-armoured type; the legs are unprotected | `Junkelmann-2000`, `Zliten` |
| Bare torso | No armour mesh | `hasLightArmor: false` | **attested** — the retiarius' defining characteristic is minimal armour: loincloth, belt, arm and shoulder only | `Juvenal-8`, `Junkelmann-2000` |
| Type colour | Pale bone / undyed linen on the loincloth and legs | `clothColor` | **not a historical claim** — see §6 | — |

**Attested but deliberately not drawn:** the left-arm **manica** that the
galerus sits above. No field carries it; the form it would take is the
murmillo's right-arm manica of §1 (two rigid sleeves in the `armour` slot),
built since 2026-09-17 and not yet applied here.

## 4. Explicitly **not** asserted

These are drawn as *nothing*, or drawn in a deliberately generic form. Nothing
in the rig or in this document claims them.

| Detail | Why not asserted |
|---|---|
| The **figure or device on the murmillo's crest** | The crest itself is attested; its decoration is not recoverable per type. The popular fish-crest reading rests on the *mormylos* etymology in `Festus`, which is a name derivation, not a description of the helmet — the Pompeii helmets do not bear it out. The crest is drawn as a plain block. |
| A **specific hoplomachus crest figure** | Figural crest ornaments exist in the corpus — the griffin head is the well-known case and belongs to the *thraex* — but no particular figure is securely attributed to the hoplomachus. Named in the design spec as the example of what not to claim. No crest is drawn (§2). |
| The **blade form of the retiarius' pugio** | A secondary dagger appears in the iconography, but its form varies and the engine draws one weapon per fighter. Not drawn. |
| The **hoplomachus' secondary short blade** | Attested, but a second weapon is inert in a single-weapon-stream engine. Not drawn (§2). |
| **Exact dimensions** of any piece | The values in `STYLE_SPECS` are authored for legibility at 50–90 px, not measured from finds. See §6. |
| **How each type actually fought** | Behaviour is our interpretation (§5), never a claim. |

## 5. Interpretation — a gameplay reading, not an ancient technique

The right-hand column below is what the kit *suggests to a player*. It is the
reading the existing (unchanged) combat content already happens to express. It
is **not attested**, and none of the sources above is offered for it.

| Type | Kit | Interpretation the kit suggests | What the content already does (unchanged by this slice) |
|---|---|---|---|
| Murmillo | Big curved shield, short sword, one greave, heavy helmet | Closes and works inside, behind the shield | `preferredRange` 1.2–1.7, retreat weight 0, slowest advance |
| Hoplomachus | Long spear, small shield, tall greaves, brimmed helmet | Holds long range and thrusts from outside | `preferredRange` 2.1–2.8, attacks reach 3.1, `hold-range` + `backstep` weighted 12 each |
| Retiarius | Net, trident, nothing else | Fights at reach, gives ground, closes only to strike | `preferredRange` 2.4–3.0 (longest), backward 2.7, burst 4.0 |

A **disengaging fighter never turns their back** — a constraint carried from the
review. It is the one behavioural norm the sources do support, and it is an
animation constraint, not part of the interpretation above.

## 6. Elements that are engine convention, not historical claims

Every fighter carries these regardless of type. They exist because the fight is
rendered at 50–90 px in a 1280×820 frame and a coarse silhouette is all that
survives; none of them is an equipment claim.

| Element | Mesh slot | Carried by | Purpose |
|---|---|---|---|
| Limb capsules, hands, feet | `limb` | `BodyProportions` | The body. Untouched by this slice — the complaint was identity, not anatomy. |
| Loincloth and leg masses | `cloth` | `clothColor`, `BodyProportions` | The type's largest colour area; the value block of the cue hierarchy. |
| Head sphere, neck | `skin` | `BodyProportions` | The body. |
| Rim outline | `rim` | fixed `OUTLINE_COLOR`, `RIM_SCALE` | Separates the silhouette from the floor without a post-processing pass. |
| Visor slot | `visor` | `BodyProportions.headRadius` | Gives the head a *front*, so a back view is not mistaken for a face-on view. Drawn on bare-headed types too — it is a facing cue, not a helmet. |
| Breastplate / backplate | `breastplate`, `backplate` | `clothColor` (lightened / darkened) | Front-versus-back value contrast inside the fighter's own hue. |
| Forward-biased foot box | `limb` | `BodyProportions.footLength` | Same reason as the visor: an asymmetric footprint reads as a facing. |

### Deliberate departures from real scale, for legibility

Listed here so they are not mistaken for historical claims:

- **The spear and trident shafts are drawn far thicker than a real shaft.** A
  historically-scaled shaft (~3 cm) lands at roughly two pixels at the shipped
  framing and disappears. `weaponWidth` is authored for a visible line.
- **Weapon length is hand-to-tip only.** The builder draws no butt behind the
  grip, so a polearm's drawn length is the part in front of the fist, not the
  weapon's real overall length.
- **The galerus and the greaves are sized and placed by the builder**, from
  `BodyProportions`, not by an authored dimension; `STYLE_SPECS` can only turn
  them on or off.
- **The galerus is sized against the camera, not against the body.** The arena
  camera is a fixed ~34° depression (`CAMERA_ELEVATION_RATIO`), so a point's
  height *on screen* is `y·cos(d) + depth·sin(d)`: on the facing where the
  guarded shoulder is the far one, **every centimetre outboard buys screen
  height**. On the retiarius' own bout that is *every* frame, because he is the
  home fighter and always turned the same way. Two versions of this piece
  silhouetted above his bare crown — a tall one by 0.138, then a lower but
  wider one by 0.142 — and read as a squared-off hat on the one type defined by
  wearing no helmet. It is therefore drawn narrow across the shoulders and
  tucked inboard of the shoulder joint, long fore-and-aft (the axis that costs
  nothing on that facing), and lower and flatter than the ~30 cm Pompeii piece.
  A drawing constraint, not a claim about the object.
- **The murmillo's crest is drawn low.** It is a semicircular comb bedded into
  the dome rather than a tall fin. Attested crests are taller; drawn tall here,
  it became the most rectangle-shaped object on the fighter and competed with
  the scutum for the cue the scutum has to carry. The crest is a claim; its
  height is a drawing decision.
- **The shield and the net do not inherit the hand's rotation.** Everything
  else held in a hand does, and the combat poses swing the shield forearm
  through roughly 75°, which drew the murmillo's upright slab lying along the
  forearm — a plank jutting forward at shoulder height, covering none of the
  body. `shieldCenter` and the net's hanging point are therefore *body-oriented*
  attachments (`createBodyOrientedAttachment`): they travel with the fist but
  take their orientation from the fighter's own facing. A shield authored
  upright is drawn upright and bows around the body; the net falls under the
  fist instead of swinging up into the position a shield occupies.
- **The net is cords, not a solid.** Two solid-box versions (flat, then
  near-cubic) both read as a shield on screen — on the one type whose diagnostic
  is that he carries none. Only a broken outline, with gaps between the cords
  and an uneven hem, reads as a net at 50–90 px. The real *rete* was a single
  weighted mesh; the cords are a rendering of "gathered net", not a claim about
  its construction.
- **The type palette** (`clothColor`) is chosen to stay clear of the red/blue
  that already carries the home/away distinction in the HUD
  (`.fighter-card--home` `#b34d3a`, `.fighter-card--away` `#4383a0`), and to put
  the murmillo, hoplomachus and retiarius on three distinct *values* so the
  types survive a greyscale check. It encodes nothing historical.
