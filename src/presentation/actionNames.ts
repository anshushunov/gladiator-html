// What the battle feed calls each attack.
//
// The feed used to render "Brutus deals 12" and "Drusus evades" -- it never
// said what was DONE, for any action in the game, which the 2026-09-20
// playtest caught. Every attack event already carries `actionId`
// (`encounter.ts`'s `AttackMissedEvent` through `DamageDealtEvent`); only the
// words were missing.
//
// `Record<AttackActionId, ...>` is a compile-time proof of exhaustiveness: a
// new attack cannot be added to the union without being named here.

import type { AttackActionId } from '../simulation/combatActions'

/** `verb` is third-person present and completes "<name> ___" ("Brutus cleaves"). `noun` is bare and completes "the ___" ("blocks the cleave"). */
export interface AttackPhrase { verb: string; noun: string }

export const ATTACK_PHRASES: Readonly<Record<AttackActionId, AttackPhrase>> = {
  'heavy-shield-jab': { verb: 'jabs with the shield', noun: 'shield jab' },
  'heavy-cleave': { verb: 'cleaves', noun: 'cleave' },
  'fast-slash': { verb: 'slashes', noun: 'slash' },
  'fast-burst-lunge': { verb: 'lunges', noun: 'lunge' },
  'technical-thrust': { verb: 'thrusts', noun: 'thrust' },
  'technical-driving-thrust': { verb: 'drives the spear in', noun: 'driving thrust' },
  'technical-parry-counter': { verb: 'counters', noun: 'counter' },
}
