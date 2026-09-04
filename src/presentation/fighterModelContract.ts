// The names the runtime relies on inside the shipped .glb files. Everything
// here is checked against the files by `fighterModelContract.test.ts`, so a
// rebuilt model that no longer satisfies the code fails in the fast suite.

import type { AttackActionId, DefenseActionId } from '../simulation/combatActions'
import type { Archetype } from '../simulation/fighters'

export type FighterBoneName =
  | 'root' | 'hips' | 'spine' | 'chest' | 'head'
  | 'upperarm.l' | 'lowerarm.l' | 'hand.l' | 'handslot.l'
  | 'upperarm.r' | 'lowerarm.r' | 'hand.r' | 'handslot.r'
  | 'upperleg.l' | 'lowerleg.l' | 'foot.l'
  | 'upperleg.r' | 'lowerleg.r' | 'foot.r'

export const FIGHTER_BONE_NAMES: readonly FighterBoneName[] = [
  'root', 'hips', 'spine', 'chest', 'head',
  'upperarm.l', 'lowerarm.l', 'hand.l', 'handslot.l',
  'upperarm.r', 'lowerarm.r', 'hand.r', 'handslot.r',
  'upperleg.l', 'lowerleg.l', 'foot.l',
  'upperleg.r', 'lowerleg.r', 'foot.r',
]

export type EquipmentAnchorName = 'weaponHand' | 'offHand' | 'weaponTip' | 'shieldCenter' | 'hitCenter'

/** Anchor -> node name inside the .glb. `weaponHand`/`offHand` are the pack's own hand-slot bones; the other three are empties the build script adds. */
export const ANCHOR_NODE_NAMES: Readonly<Record<EquipmentAnchorName, string>> = {
  weaponHand: 'handslot.r',
  offHand: 'handslot.l',
  weaponTip: 'weaponTip',
  shieldCenter: 'shieldCenter',
  hitCenter: 'hitCenter',
}
export const FIGHTER_ANCHOR_NAMES: readonly EquipmentAnchorName[] = ['weaponHand', 'offHand', 'weaponTip', 'shieldCenter', 'hitCenter']

/** `extras.slot` values the build script writes on every mesh node. */
export const MESH_SLOTS: ReadonlySet<string> = new Set(['body', 'helmet', 'weapon', 'shield', 'net'])

export const MODEL_FILES: Readonly<Record<Archetype, string>> = {
  heavy: 'models/heavy.glb',
  fast: 'models/fast.glb',
  technical: 'models/technical.glb',
}

export interface AttackClip { clip: string; contactAt: number }

export const ATTACK_CLIPS: Readonly<Record<AttackActionId, AttackClip>> = {
  'heavy-shield-jab': { clip: 'Block_Attack', contactAt: 0.45 },
  'heavy-cleave': { clip: '1H_Melee_Attack_Chop', contactAt: 0.5 },
  'fast-slash': { clip: '2H_Melee_Attack_Chop', contactAt: 0.45 },
  'fast-burst-lunge': { clip: '2H_Melee_Attack_Stab', contactAt: 0.5 },
  'technical-thrust': { clip: '1H_Melee_Attack_Stab', contactAt: 0.5 },
  'technical-driving-thrust': { clip: 'Spear_Drive', contactAt: 0.5 },
  'technical-parry-counter': { clip: '1H_Melee_Attack_Slice_Horizontal', contactAt: 0.45 },
}

export const DEFENSE_CLIPS: Readonly<Record<DefenseActionId, string>> = {
  'heavy-guard': 'Block',
  'fast-evade': 'Dodge_Backward',
  'technical-parry': 'Block_Attack',
}

export const BASE_CLIPS = { idle: 'Idle', walk: 'Walking_A', hit: 'Hit_A', death: 'Death_A' } as const

const ARCHETYPE_ATTACKS: Readonly<Record<Archetype, readonly AttackActionId[]>> = {
  heavy: ['heavy-shield-jab', 'heavy-cleave'],
  fast: ['fast-slash', 'fast-burst-lunge'],
  technical: ['technical-thrust', 'technical-driving-thrust', 'technical-parry-counter'],
}
const ARCHETYPE_DEFENSE: Readonly<Record<Archetype, DefenseActionId>> = {
  heavy: 'heavy-guard',
  fast: 'fast-evade',
  technical: 'technical-parry',
}

/** Every clip name the runtime may ask this archetype's file for. */
export function requiredClipsFor(archetype: Archetype): string[] {
  const names = new Set<string>(Object.values(BASE_CLIPS))
  for (const id of ARCHETYPE_ATTACKS[archetype]) names.add(ATTACK_CLIPS[id].clip)
  names.add(DEFENSE_CLIPS[ARCHETYPE_DEFENSE[archetype]])
  return [...names]
}
