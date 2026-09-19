# `MISS_REACH` is an authored presentation table in `ArenaView.ts`: the
# horizontal distance from the root at which each archetype's `weaponTip` sits
# on the strike frame of its attack clips, per-archetype median across that
# archetype's attacks (feedback spec section 5.2). It is the ceiling on how far
# from the attacker a miss puff can be placed.
#
# It is measured off the SHIPPED `.glb`, so any change to a rig's weapon or its
# authored clips invalidates the row. This prints the rows.
#
# Run: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --python tools/blender/probe_miss_reach.py

import bpy

# archetype -> (file, [(clip, contactAt), ...]) from `fighterModelContract.ts`'s
# ATTACK_CLIPS, restricted to each archetype's own attacks.
ATTACKS = {
    'heavy': ('public/models/heavy.glb', [('Block_Attack', 0.45), ('1H_Melee_Attack_Chop', 0.5)]),
    'fast': ('public/models/fast.glb', [('2H_Melee_Attack_Chop', 0.45), ('2H_Melee_Attack_Stab', 0.5)]),
    'technical': ('public/models/technical.glb', [
        ('Spear_Thrust', 0.5), ('Spear_Drive', 0.5), ('1H_Melee_Attack_Slice_Horizontal', 0.45),
    ]),
}


def median(values):
    ordered = sorted(values)
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


for archetype, (path, clips) in ATTACKS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    tip = bpy.data.objects['weaponTip']
    reaches = []
    for name, contact_at in clips:
        action = bpy.data.actions.get(name)
        if action is None:
            print(f'[miss] {archetype} {name} MISSING')
            continue
        first, last = action.frame_range
        frame = round(first + (last - first) * contact_at)
        if arm.animation_data is None:
            arm.animation_data_create()
        arm.animation_data.action = action
        bpy.context.scene.frame_set(int(frame))
        bpy.context.view_layer.update()
        delta = tip.matrix_world.translation - arm.matrix_world.translation
        horizontal = (delta.x ** 2 + delta.y ** 2) ** 0.5
        reaches.append(horizontal)
        print(f'[miss] {archetype} {name} contactAt {contact_at} frame {int(frame)} horizontal {horizontal:.3f}')
    if reaches:
        m = median(reaches)
        print(f'[miss] {archetype} MEDIAN {m:.3f} -> rounded to 0.05: {round(m * 20) / 20}')
