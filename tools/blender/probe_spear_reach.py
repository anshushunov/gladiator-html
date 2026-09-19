# Throwaway probe: how far forward of the fighter's origin can the spear tip
# physically get, per grip point?
#
# The 2026-09-05 fighting-room slice translated every separation outward, so the
# contact medians `REACH_WINDOWS` mirror moved with them (thrust 1.48 -> 1.89,
# driving thrust 1.75 -> 2.30, measured by `scripts/measure-contact-separation.ts`).
# Re-targeting the windows is only possible if the rig can reach them at all,
# and that ceiling is set by the arm chain, not by the keys: with the whole
# chain pointed straight forward the grip sits at
#
#   shoulder_forward + |handslot.r.head - upperarm.r.head|
#
# and the tip that much plus the shaft in front of the fist. No pose can beat
# that, so it is an upper bound on any re-key, measured rather than guessed.
#
# Run: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --python tools/blender/probe_spear_reach.py

import bpy
from mathutils import Vector

MODEL = 'public/models/technical.glb'


def log(*parts):
    print('[probe]', *(str(p) for p in parts))


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=MODEL)

arm = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
origin = arm.matrix_world.translation
bones = arm.data.bones


def head(name):
    return arm.matrix_world @ bones[name].head_local


shoulder = head('upperarm.r')
elbow = head('lowerarm.r')
grip = head('handslot.r')

# Chain lengths are pose-invariant; the forward ceiling is the chain laid out
# along the model's forward axis (-Y in Blender here, +Z in three.js).
upper = (elbow - shoulder).length
fore = (grip - elbow).length
chain = upper + fore
shoulder_forward = -(shoulder - origin).y

log('rig scale check: standing height', round(max((arm.matrix_world @ v.co).z for o in bpy.data.objects
                                                  if o.type == 'MESH' for v in o.data.vertices), 4))
log('shoulder', [round(v, 4) for v in (shoulder - origin)])
log('elbow    ', [round(v, 4) for v in (elbow - origin)])
log('grip     ', [round(v, 4) for v in (grip - origin)])
log('upperarm length', round(upper, 4), 'forearm+hand length', round(fore, 4), 'chain', round(chain, 4))
log('shoulder forward of origin', round(shoulder_forward, 4))
log('MAX fist forward (chain straight ahead)', round(shoulder_forward + chain, 4))

# The spear as shipped: `weaponTip` relative to the grip, so the part of the
# shaft in front of the fist is grip-independent given `grip_behind`.
tip = bpy.data.objects.get('weaponTip')
if tip is not None:
    ahead = (tip.matrix_world.translation - grip).length
    log('spear ahead of the fist (shipped grip_behind=0.8)', round(ahead, 4))
    log('MAX tip forward at this grip', round(shoulder_forward + chain + ahead, 4))
    # Moving the grip toward the butt adds `grip_behind * rig_scale` to `ahead`.
    scale = arm.matrix_world.to_scale().x
    log('rig scale', round(scale, 6))
    for grip_behind in (0.8, 0.6, 0.4, 0.2, 0.0):
        added = (0.8 - grip_behind) * scale
        log('  grip_behind', grip_behind, 'ahead of fist', round(ahead + added, 4),
            'MAX tip forward', round(shoulder_forward + chain + ahead + added, 4))
else:
    log('weaponTip missing -- cannot report the shaft in front of the fist')
