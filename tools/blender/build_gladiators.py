"""Builds public/models/{heavy,fast,technical}.glb from assets/kaykit/*.glb.

Run:  npm run models:build   (blender --background --python tools/blender/build_gladiators.py)

Contract (checked by src/presentation/fighterModelContract.test.ts):
  bones  root hips spine chest head upperarm.l lowerarm.l hand.l handslot.l
         upperarm.r lowerarm.r hand.r handslot.r upperleg.l lowerleg.l foot.l
         upperleg.r lowerleg.r foot.r            (all from the pack, untouched)
  empties weaponTip (child of handslot.r), shieldCenter (child of handslot.l),
         hitCenter (child of spine)
  extras.slot on every mesh: body | helmet | weapon | shield | net
  clips  the KEEP_CLIPS set below plus Spear_Drive on technical

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
TARGET_HEIGHT = 1.8

KEEP_CLIPS = {
    'Idle', 'Walking_A', 'Hit_A', 'Death_A',
    'Block', 'Block_Attack', 'Dodge_Backward',
    '1H_Melee_Attack_Chop', '1H_Melee_Attack_Stab', '1H_Melee_Attack_Slice_Horizontal',
    '2H_Melee_Attack_Chop', '2H_Melee_Attack_Stab',
}
AUTHORED_CLIP = 'Spear_Drive'

# archetype -> (source character, kept pack meshes -> slot, props to build)
BUILDS = {
    'heavy': {
        'source': 'Knight.glb',
        'keep': {'1H_Sword': 'weapon', 'Rectangle_Shield': 'shield', 'Knight_Helmet': 'helmet'},
        'build': [],
    },
    'fast': {
        'source': 'Barbarian.glb',
        'keep': {},  # a retiarius fights bare-headed: trident and net, no helmet
        'build': ['trident', 'net'],
    },
    'technical': {
        'source': 'Rogue.glb',
        # The brief listed `Round_Shield` here, but that mesh only exists in
        # Knight.glb -- the Rogue pack ships no shield at all. Rather than drag
        # a second 1024x1024 atlas into the file, the buckler is built here,
        # like the trident/spear/net.
        'keep': {},
        'build': ['spear', 'buckler'],
    },
}

# Pack meshes that serve as the placement reference for built props.
WEAPON_REFERENCE = {'Knight.glb': '1H_Sword', 'Barbarian.glb': '1H_Axe', 'Rogue.glb': 'Knife'}
SHIELD_REFERENCE = {'Knight.glb': 'Rectangle_Shield', 'Barbarian.glb': 'Barbarian_Round_Shield', 'Rogue.glb': 'Knife_Offhand'}

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


def prune_clips(arm):
    keep = KEEP_CLIPS | {AUTHORED_CLIP}
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
    """Height of the skinned body in the bind pose (props excluded)."""
    lo, hi = math.inf, -math.inf
    for obj in all_mesh_objects():
        if not is_body_part(obj):
            continue
        for point in world_vertices(obj):
            lo, hi = min(lo, point.z), max(hi, point.z)
    return hi - lo


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
    return build_offhand_disc('net', arm, rope, 'net', radius=0.42, depth=0.02, vertices=24)


def build_buckler(arm):
    board = solid_material('buckler_board', (0.42, 0.28, 0.16, 1))
    return build_offhand_disc('buckler', arm, board, 'shield', radius=0.34, depth=0.06, vertices=16)


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

    weapon_ref = bpy.data.objects[WEAPON_REFERENCE[spec['source']]]
    shield_ref = bpy.data.objects[SHIELD_REFERENCE[spec['source']]]

    # Tag body parts before anything is deleted or added.
    for obj in all_mesh_objects():
        if is_body_part(obj):
            obj['slot'] = 'body'

    # Anchor positions read off the reference props while they still exist.
    _butt, weapon_tip, _dir = weapon_axis(weapon_ref, arm)
    shield_centre = world_centre(shield_ref)

    keep = spec['keep']
    referenced = {weapon_ref.name, shield_ref.name}
    for obj in list(all_mesh_objects()):
        if is_body_part(obj):
            continue
        if obj.name in keep:
            obj['slot'] = keep[obj.name]
        elif obj.name in referenced and spec['build']:
            continue  # still needed as a placement reference; deleted below
        else:
            delete_object(obj)

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

    for obj in (weapon_ref, shield_ref):
        if obj.name not in keep and obj.name in bpy.data.objects:
            delete_object(obj)

    add_empty('weaponTip', arm, WEAPON_BONE, weapon_tip)
    add_empty('shieldCenter', arm, SHIELD_BONE, shield_centre)
    add_empty('hitCenter', arm, 'spine', bone_tail(arm, 'spine'))
    log(archetype, 'anchors',
        'weaponTip', tuple(round(v, 3) for v in weapon_tip),
        'shieldCenter', tuple(round(v, 3) for v in shield_centre),
        'hitCenter', tuple(round(v, 3) for v in bone_tail(arm, 'spine')))

    if archetype == 'technical':
        author_spear_drive(arm)

    prune_clips(arm)

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
    bpy.ops.export_scene.gltf(
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
