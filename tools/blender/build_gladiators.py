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
         (Spear_Drive on technical)

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
AUTHORED_CLIP = 'Spear_Drive'

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
        'build': ['spear', 'buckler'], 'clips': [AUTHORED_CLIP],
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


def build_shaft_weapon(name, reference, arm, length, radius, tip_builder, slot='weapon'):
    """A cylinder shaft along the reference weapon's long axis, plus a tip.

    Returns the shaft and the world point of the weapon's *sharp end* -- the
    apex of the tip geometry, not the end of the shaft, because that point is
    what `weaponTip` anchors the runtime's reach to.
    """
    butt, _tip, direction = weapon_axis(reference, arm)
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


def author_spear_drive(arm):
    """The one clip authored here rather than taken from the pack: a lunge with
    the spear driven forward. Frames at 24 fps; strike at frame 15 of 30 (50%)."""
    action = bpy.data.actions.new(AUTHORED_CLIP)
    action.use_fake_user = True
    if not arm.animation_data:
        arm.animation_data_create()
    previous, arm.animation_data.action = arm.animation_data.action, action

    def key(frame, bone, rot_deg):
        # Quaternions, not Euler: the pack animates every bone on
        # `rotation_quaternion`, and flipping a bone's `rotation_mode` to 'XYZ'
        # to key Euler makes Blender evaluate the Euler channels *instead*. The
        # pack's own quaternion curves for that bone are then silently ignored,
        # and the bone stops moving in all twelve imported clips as well.
        pbone = arm.pose.bones[bone]
        pbone.rotation_quaternion = Euler([math.radians(d) for d in rot_deg], 'XYZ').to_quaternion()
        pbone.keyframe_insert(data_path='rotation_quaternion', frame=frame)

    # frame: 1 guard, 10 windup (arm back, torso coiled), 15 strike (arm out, torso forward), 30 back to guard
    for bone, guard, windup, strike in (
        ('chest',      (0, 0, 0),    (-8, 0, 20),   (18, 0, -12)),
        ('hips',       (0, 0, 0),    (0, 0, 8),     (6, 0, -6)),
        ('upperarm.r', (0, 0, 0),    (-25, 0, 35),  (70, 0, -20)),
        ('lowerarm.r', (0, 0, 0),    (-60, 0, 0),   (-5, 0, 0)),
        ('upperleg.l', (0, 0, 0),    (10, 0, 0),    (-35, 0, 0)),
        ('upperleg.r', (0, 0, 0),    (-10, 0, 0),   (25, 0, 0)),
    ):
        key(1, bone, guard)
        key(10, bone, windup)
        key(15, bone, strike)
        key(30, bone, guard)

    slot = arm.animation_data.action_slot
    arm.animation_data.action = previous
    track = arm.animation_data.nla_tracks.new()
    track.name = AUTHORED_CLIP
    strip = track.strips.new(AUTHORED_CLIP, 1, action)
    strip.name = AUTHORED_CLIP
    if slot is not None:
        strip.action_slot = slot
    # Leave the pose the pack shipped: the keyframes above moved live bones.
    for pbone in arm.pose.bones:
        pbone.matrix_basis = Matrix.Identity(4)
    sync()
    return action


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
        _, weapon_tip = build_shaft_weapon('spear', weapon_ref, arm, length=1.9, radius=0.026,
                                           tip_builder=spear_tip)
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

    if AUTHORED_CLIP in spec['clips']:
        author_spear_drive(arm)

    prune_clips(arm, spec['clips'])

    scale = TARGET_HEIGHT / height
    arm.scale = (scale, scale, scale)
    sync()
    log(archetype, 'scale', round(scale, 4),
        'meshes', sorted(f'{o.name}:{o["slot"]}' for o in all_mesh_objects()),
        'clips', sorted(a.name for a in bpy.data.actions))

    # The exporter samples animation off the evaluated pose, so put the rig back
    # on its animation channels now that every measurement is taken.
    arm.data.pose_position = 'POSE'
    sync()

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
