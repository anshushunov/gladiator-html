"""Builds public/models/{heavy,fast,technical}.glb from assets/kaykit/*.glb.

Run:  npm run models:build   (blender --background --python tools/blender/build_gladiators.py)

Contract (checked by src/presentation/fighterModelContract.test.ts):
  bones  root hips spine chest head upperarm.l lowerarm.l hand.l handslot.l
         upperarm.r lowerarm.r hand.r handslot.r upperleg.l lowerleg.l foot.l
         upperleg.r lowerleg.r foot.r            (all from the pack, untouched)
  empties weaponTip (child of handslot.r), shieldCenter (child of handslot.l),
         hitCenter (child of spine)
  extras.slot on every mesh: body | helmet | armour | weapon | shield | net
  clips  the KEEP_CLIPS set below plus each archetype's authored `clips`
         (Spear_Thrust and Spear_Drive on technical, gated by REACH_WINDOWS)

The shipped .glb files are generated only by this script -- never hand-edited.
Re-runnable from a clean state: every archetype starts from an empty scene.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets', 'kaykit')
OUT = os.path.join(ROOT, 'public', 'models')
# Standing height of the body silhouette (feet to crown, helmet and held props
# excluded) in world units, applied by scaling the whole rig uniformly.
# 2.0, not the 1.8 this shipped with first: at 1.8 the slow legibility harness
# measured a p92 on-screen body height of 117-124 px against a 130 px bar in
# eight of the nine pairings, and 130 / 117 = 1.11 -- the fix the spec calls for
# is the armature scale, not a wider camera or a lowered bar.
TARGET_HEIGHT = 2.0

KEEP_CLIPS = {
    'Idle', 'Walking_A', 'Hit_A', 'Death_A',
    'Block', 'Block_Attack', 'Dodge_Backward',
    '1H_Melee_Attack_Chop', '1H_Melee_Attack_Stab', '1H_Melee_Attack_Slice_Horizontal',
    '2H_Melee_Attack_Chop', '2H_Melee_Attack_Stab',
}
FPS = 24  # the exporter writes frame f at f / FPS seconds, so contactAt = strike / last

# The two clips authored here rather than taken from the pack, both by
# `author_clip`: guard (the pack's Idle at frame 0, keyed on every pose bone)
# -> windup -> strike -> hold (= strike, so the mixer's contact+impact window
# plays a held strike, not the start of the recovery) -> guard. Keys are
# degrees, XYZ Euler relative to the bind pose, keyed on `rotation_quaternion`;
# `hips:loc` is the pose bone's `location` in its own frame and source units
# (x = +X, y = up along the bone, z = forward). Windup and strike are absolute
# values, not deltas; 'Idle' keeps the guard's value at that frame. How they
# were found, so they can be re-tuned rather than re-discovered: `upperarm.r`
# Z swings the arm forward (+90 = straight ahead) and X raises it (+6 deg is
# about +0.19 of tip height on the thrust); `hand.r` Z -90 keeps the spear
# along the forearm (in the bind pose it lies across it); a chest yaw of
# -theta (left shoulder forward, thrust) or +theta (right shoulder forward,
# drive) pulls the hand back or pushes it forward by about 0.09 at 20 deg,
# with the arm's Z corrected by the opposite amount so it still points ahead;
# `upperleg.*` X negative = leg forward, positive = back; `lowerleg.l` X
# positive = knee bend; each 0.01 of `hips:loc` z moves the tip 0.009 forward.
AUTHORED_CLIPS = {
    # A short cock and a straight-arm jab off the left foot. 24 frames = 1.000 s,
    # strike at 12/24 = contactAt 0.5.
    'Spear_Thrust': {
        'frames': {'guard': 1, 'windup': 7, 'strike': 12, 'hold': 16, 'last': 24},
        'keys': {
            'chest':      ((0, -12, 0),   (0, -22, 0)),
            'upperarm.r': ((-45, 0, -10), (0, 0, 112)),
            'lowerarm.r': ((0, 0, 60),    (0, 0, 0)),
            'hand.r':     ((0, 0, -50),   (0, 0, -90)),
            'upperleg.l': ('Idle',        (-22, 0, 0)),
            'lowerleg.l': ('Idle',        (22, 0, 0)),
            'upperleg.r': ('Idle',        (14, 0, 0)),
        },
    },
    # A deeper cock, a hip-and-chest turn and a lunge. 30 frames = 1.250 s,
    # strike at 15/30 = contactAt 0.5.
    'Spear_Drive': {
        'frames': {'guard': 1, 'windup': 10, 'strike': 15, 'hold': 20, 'last': 30},
        'keys': {
            'chest':      ((-6, -14, 0),  (8, 20, 0)),
            'hips':       ((0, -8, 0),    (4, 10, 0)),
            'hips:loc':   ('Idle',        (0, 0, 0.12)),
            'upperarm.r': ((-30, 0, -30), (10, 0, 65)),
            'lowerarm.r': ((0, 0, 80),    (0, 0, 0)),
            'hand.r':     ((0, 0, -70),   (0, 0, -90)),
            'upperleg.l': ((10, 0, 0),    (-35, 0, 0)),
            'lowerleg.l': ('Idle',        (40, 0, 0)),
            'upperleg.r': ((-10, 0, 0),   (25, 0, 0)),
        },
    },
}

# Where the spear tip must be at each authored clip's strike frame, in world
# units from the fighter's origin (the armature object, which the runtime places
# at the simulation position -- not the animated `root` bone): forward is the
# model's -Y here (+Z in three.js), height is Z, lateral is X (+ = the man's
# left; his sword hand is at -X). Checked by `assert_reach` after the rig is
# scaled, before export; a re-key that drifts the tip off the man fails the
# build instead of shipping.
#
# THESE WINDOWS MIRROR THE SIMULATION CATALOGUE, NOT A PROPERTY OF THE CLIPS.
# They were read off the shipped simulation's root separation at contact
# (median 1.47 for `technical-thrust`, 1.78 for `technical-driving-thrust`,
# nine pairings x 20 seeds), which is set by each action's `contactRange` in
# `src/simulation/combatActions.ts` and by `DUEL_MINIMUM_SEPARATION` in
# `src/simulation/battle.ts`, so that the tip lands about a quarter unit past
# the opponent's root at the median contact (where the trident's does). When
# either of those two fields moves, the medians move with it and these windows
# must be re-measured and re-targeted in the same change -- otherwise the tips
# drift short again by design while this gate keeps passing. The height window
# brackets every opponent's `hitCenter` (0.89 Barbarian, 0.889 Rogue).
REACH_WINDOWS = {
    'Spear_Thrust': {'forward': (1.70, 1.85), 'height': (0.85, 1.05), 'lateral': 0.20},
    'Spear_Drive':  {'forward': (2.00, 2.20), 'height': (0.85, 1.05), 'lateral': 0.20},
}
# The pack's own stab clips, logged (not asserted) on the re-gripped spear.
LOGGED_REACH_CLIPS = ('1H_Melee_Attack_Stab', '2H_Melee_Attack_Stab')

# archetype -> source character, optional donor (a second pack file whose named
# meshes are transplanted onto the source's identical skeleton, mesh -> slot),
# the pack meshes that place the anchors (`weapon_reference` is also the axis
# a built shaft weapon runs along; `shield_reference` None means the built
# offhand prop defines `shieldCenter`), the props to build, the clips authored
# here. References are per archetype, not per source file: `heavy` measures
# its anchors off the transplanted Knight props.
BUILDS = {
    'heavy': {
        # A murmillo is a Barbarian body (tunic, belt, fur kilt) under a
        # script-built galea, manica and greave, holding the Knight's sword and
        # scutum. The Knight's plate read as a knight, not a gladiator.
        'source': 'Barbarian.glb',
        'donor': ('Knight.glb', {'1H_Sword': 'weapon', 'Rectangle_Shield': 'shield'}),
        'weapon_reference': '1H_Sword', 'shield_reference': 'Rectangle_Shield',
        'build': ['galea', 'manica', 'greave'], 'clips': [],
    },
    'fast': {
        'source': 'Barbarian.glb',  # a retiarius fights bare-headed: trident and net, no helmet
        'weapon_reference': '1H_Axe', 'shield_reference': None,
        'build': ['trident', 'net'], 'clips': [],
    },
    'technical': {
        'source': 'Rogue.glb',
        # The brief listed `Round_Shield` here, but that mesh only exists in
        # Knight.glb -- the Rogue pack ships no shield at all. Rather than drag
        # a second 1024x1024 atlas into the file, the buckler is built here,
        # like the trident/spear/net.
        'weapon_reference': 'Knife', 'shield_reference': None,
        'build': ['spear', 'buckler'], 'clips': ['Spear_Thrust', 'Spear_Drive'],
    },
}

WEAPON_BONE = 'handslot.r'
SHIELD_BONE = 'handslot.l'

# The pack's own round shields sit on `handslot.l` with their disc in the world
# XY plane (normal +Z in rest) and their centre 0.156 above the bone head.
# Built offhand props copy that placement so they hang the same way the pack's
# shields do once an animation rotates the arm.
OFFHAND_DISC_NORMAL = Vector((0.0, 0.0, 1.0))
OFFHAND_DISC_RISE = 0.156


def log(*parts):
    print('[build_gladiators]', *parts)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def sync():
    """Flush pending parenting/transform edits so matrix_world reads are true."""
    bpy.context.view_layer.update()


def import_source(name):
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name))
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    # The importer leaves an action applied; every measurement and every prop
    # placement below is done against the bind pose instead.
    arm.data.pose_position = 'REST'
    sync()
    return arm


def all_mesh_objects():
    return [o for o in bpy.data.objects if o.type == 'MESH']


def is_body_part(obj):
    # The six skinned parts carry an armature modifier; props do not.
    return any(m.type == 'ARMATURE' for m in obj.modifiers)


def delete_object(obj):
    bpy.data.objects.remove(obj, do_unlink=True)


def prune_clips(arm, authored):
    keep = KEEP_CLIPS | set(authored)
    if arm.animation_data:
        for track in list(arm.animation_data.nla_tracks):
            names = {s.action.name for s in track.strips if s.action}
            if not names & keep:
                arm.animation_data.nla_tracks.remove(track)
        # Otherwise the exporter emits the active action a second time under a
        # name of its own making, on top of the NLA track that already has it.
        arm.animation_data.action = None
    for action in list(bpy.data.actions):
        if action.name not in keep:
            bpy.data.actions.remove(action)


def world_vertices(obj):
    return [obj.matrix_world @ v.co for v in obj.data.vertices]


def standing_height():
    """Height of the skinned body in the bind pose (props excluded).

    Raises rather than returning a sentinel when nothing contributed. With the
    plain `hi - lo` this used to return `-inf` if no mesh carried an armature
    modifier (a renamed body part, an import that lost its skinning, a source
    file swapped for one whose meshes are not skinned), and the caller's
    `TARGET_HEIGHT / height` then quietly produced `-0.0`. That exported a
    zero-scale rig -- a valid .glb, every bone and clip and slot present, so
    the contract test passed -- which draws as nothing at all.
    """
    lo, hi = math.inf, -math.inf
    for obj in all_mesh_objects():
        if not is_body_part(obj):
            continue
        for point in world_vertices(obj):
            lo, hi = min(lo, point.z), max(hi, point.z)
    if lo == math.inf:
        raise RuntimeError(
            'standing_height: no skinned body mesh found (nothing carries an '
            'armature modifier) -- the rig would export at scale 0')
    height = hi - lo
    if height <= 0:
        raise RuntimeError(f'standing_height: degenerate body height {height}')
    return height


def world_bounds(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def world_centre(obj):
    lo, hi = world_bounds(obj)
    return (lo + hi) / 2


def bone_head(arm, bone_name):
    return arm.matrix_world @ arm.data.bones[bone_name].head_local


def bone_tail(arm, bone_name):
    return arm.matrix_world @ arm.data.bones[bone_name].tail_local


def parent_to_bone(obj, arm, bone_name, world):
    """Bone-parent `obj` and put it at `world` (measured in the bind pose)."""
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = bone_name
    obj.matrix_parent_inverse = Matrix.Identity(4)
    sync()
    obj.matrix_world = world
    sync()


def add_empty(name, arm, bone_name, world_position):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(empty)
    parent_to_bone(empty, arm, bone_name, Matrix.Translation(world_position))
    return empty


def solid_material(name, rgba):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = 0.8
    return mat


def new_mesh_object(name, mesh_op, material, slot, **kwargs):
    mesh_op(**kwargs)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    obj['slot'] = slot
    return obj


def aim(direction):
    """Rotation taking a primitive's local +Z onto `direction`."""
    return Vector((0, 0, 1)).rotation_difference(direction).to_matrix().to_4x4()


def weapon_axis(reference, arm):
    """(butt, tip, direction) of the pack weapon `reference` in world space.

    Only the *reach* comes from the reference: how far its longest world-axis
    span runs, and in which direction. The other two coordinates are the hand's,
    so the line runs through the grip. Neither a bbox corner nor the bbox centre
    would do -- an axe's head skews both a fifth of a metre off to one side, and
    a shaft built on them misses the hand by that much.
    """
    lo, hi = world_bounds(reference)
    axis = max(range(3), key=lambda i: hi[i] - lo[i])
    hand = bone_head(arm, WEAPON_BONE)
    ends = []
    for value in (lo[axis], hi[axis]):
        end = hand.copy()
        end[axis] = value
        ends.append(end)
    butt, tip = sorted(ends, key=lambda p: (p - hand).length)
    # Sanity: the tip must point away from the man. Sorting by distance from
    # the hand alone would happily call the near end of a weapon whose bbox
    # straddles the fist "the butt" and aim the shaft (and `weaponTip`) back
    # into the fighter's own chest.
    spine = bone_head(arm, 'spine')
    if (tip - spine).length <= (butt - spine).length:
        raise RuntimeError(
            f'weapon_axis({reference.name}): tip {tuple(round(v, 3) for v in tip)} is not farther '
            f'from spine than butt {tuple(round(v, 3) for v in butt)} -- the axis points into the body')
    return butt, tip, (tip - butt).normalized()


def build_shaft_weapon(name, reference, arm, length, radius, tip_builder, slot='weapon', grip_behind=None):
    """A cylinder shaft along the reference weapon's long axis, plus a tip.

    The shaft starts at the reference weapon's butt -- or, with `grip_behind`
    (source units), that far behind the hand along the same line, so the
    weapon is gripped mid-shaft with the rest of it crossing the fist. `None`
    keeps the butt grip (the trident is built that way, byte for byte).

    Returns the shaft and the world point of the weapon's *sharp end* -- the
    apex of the tip geometry, not the end of the shaft, because that point is
    what `weaponTip` anchors the runtime's reach to.
    """
    butt, _tip, direction = weapon_axis(reference, arm)
    if grip_behind is not None:
        butt = bone_head(arm, WEAPON_BONE) - direction * grip_behind
    wood = solid_material(f'{name}_wood', (0.45, 0.3, 0.15, 1))
    iron = solid_material(f'{name}_iron', (0.55, 0.55, 0.6, 1))
    shaft = new_mesh_object(name, bpy.ops.mesh.primitive_cylinder_add, wood, slot,
                            radius=radius, depth=length, vertices=10)
    shaft.matrix_world = Matrix.Translation(butt + direction * (length / 2)) @ aim(direction)
    shaft_end = butt + direction * length
    children, reach = tip_builder(shaft_end, direction, iron)
    for child in children:
        child['slot'] = slot
        child.parent = shaft
        child.matrix_parent_inverse = shaft.matrix_world.inverted()
    parent_to_bone(shaft, arm, reference.parent_bone or WEAPON_BONE, shaft.matrix_world.copy())
    return shaft, shaft_end + direction * reach


def trident_tip(shaft_end, direction, iron):
    """Three prongs on a crossbar. Returns (objects, reach past `shaft_end`)."""
    objs = []
    side = direction.orthogonal().normalized()
    prong_depth = 0.3
    for k in (-1, 0, 1):
        bpy.ops.mesh.primitive_cone_add(radius1=0.03, radius2=0.0, depth=prong_depth, vertices=8)
        prong = bpy.context.active_object
        prong.name = f'trident_prong_{k + 1}'
        prong.data.materials.append(iron)
        prong.matrix_world = (Matrix.Translation(shaft_end + side * (k * 0.1) + direction * (prong_depth / 2))
                              @ aim(direction))
        objs.append(prong)
    bpy.ops.mesh.primitive_cube_add(size=1)
    bar = bpy.context.active_object
    bar.name = 'trident_bar'
    bar.data.materials.append(iron)
    bar.matrix_world = (Matrix.Translation(shaft_end)
                        @ Vector((1, 0, 0)).rotation_difference(side).to_matrix().to_4x4()
                        @ Matrix.Diagonal((0.28, 0.05, 0.05, 1)))
    objs.append(bar)
    return objs, prong_depth


def spear_tip(shaft_end, direction, iron):
    """A leaf-shaped head. Returns (objects, reach past `shaft_end`)."""
    depth = 0.32
    bpy.ops.mesh.primitive_cone_add(radius1=0.05, radius2=0.0, depth=depth, vertices=8)
    head = bpy.context.active_object
    head.name = 'spear_head'
    head.data.materials.append(iron)
    head.matrix_world = Matrix.Translation(shaft_end + direction * (depth / 2)) @ aim(direction)
    return [head], depth


def build_offhand_disc(name, arm, material, slot, radius, depth, vertices):
    """A disc on `handslot.l`, placed the way the pack's own round shields are."""
    disc = new_mesh_object(name, bpy.ops.mesh.primitive_cylinder_add, material, slot,
                           radius=radius, depth=depth, vertices=vertices)
    centre = bone_head(arm, SHIELD_BONE) + OFFHAND_DISC_NORMAL * OFFHAND_DISC_RISE
    parent_to_bone(disc, arm, SHIELD_BONE,
                   Matrix.Translation(centre) @ aim(OFFHAND_DISC_NORMAL))
    return disc


def build_net(arm):
    rope = solid_material('net_rope', (0.6, 0.55, 0.4, 1))
    # 0.30, not 0.42: at the larger radius the net disc -- which is worn on the
    # offhand and so is NOT exempt from the legibility harness's safe-area
    # inset, unlike a polearm -- poked outside the 5 % inset at 1024x768.
    return build_offhand_disc('net', arm, rope, 'net', radius=0.30, depth=0.02, vertices=24)


def build_buckler(arm):
    board = solid_material('buckler_board', (0.42, 0.28, 0.16, 1))
    return build_offhand_disc('buckler', arm, board, 'shield', radius=0.34, depth=0.06, vertices=16)


def transplant_donor(arm, donor_file, meshes):
    """Import `donor_file` into the scene and move the named meshes (name -> slot)
    onto `arm`, at the world placement they had on the donor's skeleton.

    The three packs share one skeleton (bone for bone, head and tail), so a prop
    that hung off the donor's `handslot.r` hangs off ours at the same place.
    Everything else the second import added -- armature, body meshes, the other
    props, helper empties -- is deleted; its actions come in suffixed
    (`Idle.001`, ...) and fall to `prune_clips`. The transplanted meshes keep
    the donor's material and atlas.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, donor_file))
    added = [o for o in bpy.data.objects if o not in before]
    donor_arm = next(o for o in added if o.type == 'ARMATURE')
    donor_arm.data.pose_position = 'REST'
    sync()

    kept = {}
    for obj in added:
        if obj.name not in meshes:
            continue
        if obj.parent is not donor_arm or obj.parent_type != 'BONE':
            raise RuntimeError(f'transplant_donor: {obj.name} in {donor_file} is not bone-parented')
        parent_to_bone(obj, arm, obj.parent_bone, obj.matrix_world.copy())
        obj['slot'] = meshes[obj.name]
        kept[obj.name] = obj
    missing = set(meshes) - set(kept)
    if missing:
        raise RuntimeError(f'transplant_donor: {donor_file} has no {sorted(missing)}')

    # Meshes first, the armature last: an armature deleted under a still-parented
    # mesh leaves that mesh's transform to whatever Blender salvages.
    for obj in sorted(added, key=lambda o: o.type == 'ARMATURE'):
        if obj.name not in kept:
            delete_object(obj)
    sync()
    return kept


def bone_axis(arm, bone_name):
    """(head, tail, unit direction head -> tail) of a bone in world space."""
    head, tail = bone_head(arm, bone_name), bone_tail(arm, bone_name)
    return head, tail, (tail - head).normalized()


def build_sleeve(name, arm, bone_name, material, slot, radius, depth, along=None):
    """A rigid cylinder on a bone, axis along the bone, centred at the bone's
    midpoint -- or `along` source units past its head when given."""
    head, tail, direction = bone_axis(arm, bone_name)
    centre = (head + tail) / 2 if along is None else head + direction * along
    sleeve = new_mesh_object(name, bpy.ops.mesh.primitive_cylinder_add, material, slot,
                             radius=radius, depth=depth, vertices=12)
    parent_to_bone(sleeve, arm, bone_name, Matrix.Translation(centre) @ aim(direction))
    return sleeve


def build_galea(arm, head_mesh):
    """The murmillo's crested, brimmed helmet: a bronze dome under a cone cap on a
    wide brim, a dark comb on top. Four pieces on `head`, all slot `helmet`.

    Sizes and placements are off the Barbarian head's measured bounds in the
    bind pose (`crown` is read here, not hard-coded, so the helmet sits on
    whatever head the pack ships). Source units, z up; the head faces -Y, so
    the small -Y offsets pull the helmet a touch over the face. The dome's 0.62
    radius holds the head's rounded blob (its box half-diagonal is 0.73, but
    the mesh is not a box); the 1.72 brim is the murmillo's signature at any
    distance, wider than the torso, as the Pompeii helmets are.

    Returns the shared bronze material so the manica and greave use the same
    one: `solid_material` makes a new material per call, and the file is meant
    to carry exactly four (body atlas, knight_texture, kit_bronze, galea_crest).
    """
    _lo, hi = world_bounds(head_mesh)
    crown = hi.z
    log('galea crown (max z of', head_mesh.name, 'in the bind pose)', round(crown, 4))
    bronze = solid_material('kit_bronze', (0.72, 0.50, 0.20, 1))
    # Dark, not red or blue: the HUD already owns those, and the crest is the
    # one part of him that sits against open floor.
    crest_material = solid_material('galea_crest', (0.12, 0.10, 0.09, 1))

    dome = new_mesh_object('galea_dome', bpy.ops.mesh.primitive_cylinder_add, bronze, 'helmet',
                           radius=0.62, depth=0.47, vertices=16)
    parent_to_bone(dome, arm, 'head', Matrix.Translation((0, -0.03, crown - 0.12)))
    cap = new_mesh_object('galea_cap', bpy.ops.mesh.primitive_cone_add, bronze, 'helmet',
                          radius1=0.62, radius2=0.30, depth=0.22, vertices=16)
    parent_to_bone(cap, arm, 'head', Matrix.Translation((0, -0.03, crown + 0.23)))
    brim = new_mesh_object('galea_brim', bpy.ops.mesh.primitive_cylinder_add, bronze, 'helmet',
                           radius=0.86, depth=0.05, vertices=16)
    parent_to_bone(brim, arm, 'head', Matrix.Translation((0, -0.06, crown - 0.34)))
    crest = new_mesh_object('galea_crest', bpy.ops.mesh.primitive_cube_add, crest_material, 'helmet',
                            size=1)
    parent_to_bone(crest, arm, 'head',
                   Matrix.Translation((0, -0.05, crown + 0.36)) @ Matrix.Diagonal((0.07, 0.72, 0.26, 1)))
    return bronze


def build_manica(arm, bronze):
    """Two rigid bronze sleeves on the sword arm, one per bone, so the manica
    bends at the elbow like the arm does (the inside of the bend intersects,
    the outside opens; invisible at this size -- laminated rings would need
    sub-pixel gaps). Radius 0.20 clears the arm mesh's box corners (0.19); the
    lower sleeve, 0.20 on a 0.26 bone, stops 0.03 short of the wrist so it does
    not fight the Barbarian's own bracer."""
    upper = build_sleeve('manica_upper', arm, 'upperarm.r', bronze, 'armour', radius=0.20, depth=0.20)
    lower = build_sleeve('manica_lower', arm, 'lowerarm.r', bronze, 'armour', radius=0.185, depth=0.20)
    return upper, lower


def build_greave(arm, bronze):
    """One bronze greave on the left (leading) leg, `lowerleg.l`, running from
    just above the boot to over the knee: the lower leg is 0.149 long with a
    boot below it, and a band on the shin alone is invisible."""
    return build_sleeve('greave', arm, 'lowerleg.l', bronze, 'armour', radius=0.175, depth=0.24, along=0.01)


def idle_pose(arm):
    """Every pose bone's (`rotation_quaternion`, `location`) at frame 0 of the
    pack's `Idle` -- the guard every authored clip starts and ends in, so the
    buckler arm and the legs stay where Idle leaves them on the bones a clip
    does not key, and the switch back to Idle is a pose the mixer already
    knows. (The old guard was `(0, 0, 0)` on six bones: the pack's T-pose.)
    On this pack Idle keys `hips.location = (0, -0.0136, 0)`: the pelvis sits
    1.4 cm below bind in the idle."""
    restore = evaluate_action(arm, bpy.data.actions['Idle'], 0)
    pose = {pbone.name: (pbone.rotation_quaternion.copy(), pbone.location.copy())
            for pbone in arm.pose.bones}
    restore()
    hips_rotation, hips_location = pose['hips']
    log('idle guard: hips location', tuple(round(v, 4) for v in hips_location),
        'rotation', tuple(round(v, 4) for v in hips_rotation), 'over', len(pose), 'pose bones')
    return pose


def author_clip(arm, name, frames, keys, idle):
    """One authored clip: `idle` (from `idle_pose`) keyed on every pose bone at
    `frames['guard']` and `frames['last']`, the `keys` bones overriding it at
    windup, strike and hold (hold repeats the strike). See AUTHORED_CLIPS for
    the key format. FPS frames; the exporter writes frame f at f / FPS s."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    if not arm.animation_data:
        arm.animation_data_create()
    previous, arm.animation_data.action = arm.animation_data.action, action

    def key_rotation(frame, bone, quaternion):
        # Quaternions, not Euler: the pack animates every bone on
        # `rotation_quaternion`, and flipping a bone's `rotation_mode` to 'XYZ'
        # to key Euler makes Blender evaluate the Euler channels *instead*. The
        # pack's own quaternion curves for that bone are then silently ignored,
        # and the bone stops moving in all twelve imported clips as well.
        pbone = arm.pose.bones[bone]
        pbone.rotation_quaternion = quaternion
        pbone.keyframe_insert(data_path='rotation_quaternion', frame=frame)

    def key_location(frame, bone, location):
        pbone = arm.pose.bones[bone]
        pbone.location = location
        pbone.keyframe_insert(data_path='location', frame=frame)

    for frame in (frames['guard'], frames['last']):
        for bone, (rotation, location) in idle.items():
            key_rotation(frame, bone, rotation)
            key_location(frame, bone, location)

    for target, (windup, strike) in keys.items():
        bone, _, channel = target.partition(':')
        for frame, value in ((frames['windup'], windup), (frames['strike'], strike), (frames['hold'], strike)):
            if channel == 'loc':
                key_location(frame, bone, idle[bone][1] if value == 'Idle' else Vector(value))
            else:
                key_rotation(frame, bone, idle[bone][0] if value == 'Idle'
                             else Euler([math.radians(d) for d in value], 'XYZ').to_quaternion())

    slot = arm.animation_data.action_slot
    arm.animation_data.action = previous
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, frames['guard'], action)
    strip.name = name
    if slot is not None:
        strip.action_slot = slot
    # Leave the pose the pack shipped: the keyframes above moved live bones.
    for pbone in arm.pose.bones:
        pbone.matrix_basis = Matrix.Identity(4)
    sync()
    log('authored', name, 'frames', frames, 'duration', round(frames['last'] / FPS, 3), 's',
        'contactAt', round(frames['strike'] / frames['last'], 3))
    return action


def evaluate_action(arm, action, frame):
    """Put the rig in `action`'s pose at `frame` (POSE position, every NLA track
    muted, the action active) and flush, so matrix_world reads are of that
    pose. Returns a restore() that puts back the active action, the track mute
    flags, the pose position, the scene frame and an identity pose."""
    ad = arm.animation_data
    previous_action, previous_position = ad.action, arm.data.pose_position
    previous_frame = bpy.context.scene.frame_current
    muted = [(track, track.mute) for track in ad.nla_tracks]
    for track, _ in muted:
        track.mute = True
    arm.data.pose_position = 'POSE'
    ad.action = action
    if ad.action_slot is None and len(action.slots):
        ad.action_slot = action.slots[0]
    bpy.context.scene.frame_set(frame)
    sync()

    def restore():
        ad.action = previous_action
        for track, mute in muted:
            track.mute = mute
        for pbone in arm.pose.bones:
            pbone.matrix_basis = Matrix.Identity(4)
        arm.data.pose_position = previous_position
        bpy.context.scene.frame_set(previous_frame)
        sync()
    return restore


def tip_offset(arm, action, frame):
    """(forward, height, lateral) of `weaponTip` from the fighter's origin at
    `frame` of `action`, world units (see REACH_WINDOWS for the axes)."""
    restore = evaluate_action(arm, action, frame)
    delta = bpy.data.objects['weaponTip'].matrix_world.translation - arm.matrix_world.translation
    restore()
    return -delta.y, delta.z, delta.x


def assert_reach(arm, clips):
    """The gate an authored clip ships through: its tip at the strike frame is
    inside its REACH_WINDOWS entry, or the build raises. Logs the three numbers
    either way, plus the pack's own stab clips' peak reach for the record."""
    for name in clips:
        forward, height, lateral = tip_offset(arm, bpy.data.actions[name], AUTHORED_CLIPS[name]['frames']['strike'])
        window = REACH_WINDOWS[name]
        log('reach', name, 'strike frame', AUTHORED_CLIPS[name]['frames']['strike'],
            'tip forward', round(forward, 3), 'height', round(height, 3), 'lateral', round(lateral, 3),
            'window forward', window['forward'], 'height', window['height'], 'lateral +-', window['lateral'])
        problems = []
        if not window['forward'][0] <= forward <= window['forward'][1]:
            problems.append(f'forward {forward:.3f} outside {window["forward"]}')
        if not window['height'][0] <= height <= window['height'][1]:
            problems.append(f'height {height:.3f} outside {window["height"]}')
        if abs(lateral) > window['lateral']:
            problems.append(f'lateral {lateral:.3f} outside +-{window["lateral"]}')
        if problems:
            raise RuntimeError(f'reach {name}: ' + '; '.join(problems) + ' -- re-tune the keys, not contactAt')
    for name in LOGGED_REACH_CLIPS:
        action = bpy.data.actions.get(name)
        if action is None:
            continue
        first, last = (int(round(v)) for v in action.frame_range)
        peak = max(((tip_offset(arm, action, frame), frame) for frame in range(first, last + 1)),
                   key=lambda item: item[0][0])
        (forward, height, lateral), frame = peak
        log('reach', name, 'peak forward', round(forward, 3), 'at frame', f'{frame}/{last}',
            'height', round(height, 3), 'lateral', round(lateral, 3), '(logged, not asserted)')


def build_archetype(archetype, spec):
    reset_scene()
    arm = import_source(spec['source'])
    height = standing_height()
    log(archetype, 'imported', spec['source'], 'bind-pose height', round(height, 4))

    # Tag body parts before anything is deleted or added: a donor's skinned
    # meshes carry armature modifiers too and must not be mistaken for ours.
    body_parts = {obj.name: obj for obj in all_mesh_objects() if is_body_part(obj)}
    for obj in body_parts.values():
        obj['slot'] = 'body'

    kept = transplant_donor(arm, *spec['donor']) if 'donor' in spec else {}

    weapon_ref = bpy.data.objects[spec['weapon_reference']]
    shield_ref = bpy.data.objects[spec['shield_reference']] if spec['shield_reference'] else None

    # Anchor positions read off the reference props while they still exist.
    _butt, weapon_tip, _dir = weapon_axis(weapon_ref, arm)
    shield_centre = world_centre(shield_ref) if shield_ref else None

    referenced = {o.name for o in (weapon_ref, shield_ref) if o is not None}
    for obj in list(all_mesh_objects()):
        if obj.name in body_parts or obj.name in kept:
            continue
        if obj.name in referenced and spec['build']:
            continue  # still needed as a placement reference; deleted below
        delete_object(obj)

    if 'galea' in spec['build']:
        head_mesh = next(o for o in body_parts.values() if o.name.endswith('_Head'))
        bronze = build_galea(arm, head_mesh)
        if 'manica' in spec['build']:
            build_manica(arm, bronze)
        if 'greave' in spec['build']:
            build_greave(arm, bronze)
    elif 'manica' in spec['build'] or 'greave' in spec['build']:
        raise RuntimeError(f'{archetype}: manica/greave share the galea\'s bronze; build the galea too')
    if 'trident' in spec['build']:
        _, weapon_tip = build_shaft_weapon('trident', weapon_ref, arm, length=1.6, radius=0.03,
                                           tip_builder=trident_tip)
    if 'spear' in spec['build']:
        # Gripped 0.8 source units from the butt, not at the butt: a hasta is
        # held at its balance point, and no thrusting pose can land a
        # butt-gripped 1.83-unit spear at the thrust's median contact (1.47) --
        # the hand would have to sit behind the fighter's own root. Total length
        # unchanged (1.9 shaft + 0.32 head): 1.30 world units ahead of the hand,
        # 0.73 behind. The pack's stab clips now reach 1.9-2.0 on it, not 2.44-2.49.
        _, weapon_tip = build_shaft_weapon('spear', weapon_ref, arm, length=1.9, radius=0.026,
                                           tip_builder=spear_tip, grip_behind=0.8)
    if 'net' in spec['build']:
        shield_centre = world_centre(build_net(arm))
    if 'buckler' in spec['build']:
        shield_centre = world_centre(build_buckler(arm))

    for name in referenced:
        if name not in kept and name in bpy.data.objects:
            delete_object(bpy.data.objects[name])
    if shield_centre is None:
        raise RuntimeError(f'{archetype}: no shield reference and no built offhand prop to anchor shieldCenter')

    add_empty('weaponTip', arm, WEAPON_BONE, weapon_tip)
    add_empty('shieldCenter', arm, SHIELD_BONE, shield_centre)
    add_empty('hitCenter', arm, 'spine', bone_tail(arm, 'spine'))
    log(archetype, 'anchors',
        'weaponTip', tuple(round(v, 3) for v in weapon_tip),
        'shieldCenter', tuple(round(v, 3) for v in shield_centre),
        'hitCenter', tuple(round(v, 3) for v in bone_tail(arm, 'spine')))

    if spec['clips']:
        idle = idle_pose(arm)
        for name in spec['clips']:
            author_clip(arm, name, AUTHORED_CLIPS[name]['frames'], AUTHORED_CLIPS[name]['keys'], idle)

    prune_clips(arm, spec['clips'])

    scale = TARGET_HEIGHT / height
    arm.scale = (scale, scale, scale)
    sync()
    log(archetype, 'scale', round(scale, 4),
        'meshes', sorted(f'{o.name}:{o["slot"]}' for o in all_mesh_objects()),
        'clips', sorted(a.name for a in bpy.data.actions))

    # The exporter samples animation off the evaluated pose, so put the rig back
    # on its animation channels now that every bind-pose measurement is taken.
    arm.data.pose_position = 'POSE'
    sync()

    # Measured on the scaled rig, in world units, before anything is written.
    # Only where something was authored: posing heavy/fast for the log alone
    # would touch their otherwise untouched export (the bone nodes' static
    # transforms are written off the pose).
    if spec['clips']:
        assert_reach(arm, spec['clips'])

    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f'{archetype}.glb')
    # `bpy.ops` returns a status set rather than raising: an exporter that
    # bailed answers {'CANCELLED'} and leaves either no file or the previous
    # run's, and without this check the script would go on to log "wrote" and
    # exit 0 over a stale .glb.
    status = bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        export_extras=True,
        export_apply=False,
        export_yup=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_skins=True,
        export_def_bones=False,
        export_optimize_animation_size=True,
        export_image_format='AUTO',
        export_unused_images=False,
        export_unused_textures=False,
    )
    if status != {'FINISHED'}:
        raise RuntimeError(f'{archetype}: glTF export returned {status}, not FINISHED ({out})')
    log(archetype, 'wrote', out, os.path.getsize(out), 'bytes')


def main():
    for archetype, spec in BUILDS.items():
        build_archetype(archetype, spec)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
