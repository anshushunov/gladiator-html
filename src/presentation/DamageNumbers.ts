// Floating damage numbers (feedback spec `2026-09-17-feedback-design` §6):
// a pool of six DOM `<span>`s over the arena, one per live number, placed
// every rendered frame by projecting the hit's own contact point through the
// live camera. The number is `event.amount` verbatim and its kind is read off
// the batch's paired `attack-blocked`/`critical-hit` -- presentation
// re-derives no rule here (§2.2).
//
// Two halves, deliberately separable: the pure layout helpers
// (`layoutDamageNumber`, `classifyDamage`) and an entries-only pool that the
// DOM binding is optional for. `stateHash.test.ts` constructs `ArenaView` in
// plain Node with a canvas that has no `parentElement` and no `document`
// global at all; on that path the pool spawns, ages, expires and snapshots
// exactly as in the browser, and simply never touches an element.

import type { DamageDealtEvent } from '../simulation/encounter'

export type DamageNumberKind = 'body' | 'shield' | 'critical'

export interface DamageNumberEntry {
  /** `dmg-${serial}`. */
  id: string
  /** `event.amount`, verbatim. */
  amount: number
  kind: DamageNumberKind
  /** `event.contactPoint` -- the simulation's own contact point; the height is authored below. */
  worldX: number
  worldZ: number
  /** Presentation ms (encounter tick * 1000/60) of the frame that spawned it; never the wall clock. */
  spawnedAtPresentationMs: number
  /** Alternates by serial parity so two hits inside one life at the same spot sit 24 px apart instead of on top of each other. */
  lateral: -1 | 1
}

/** Life of a number in presentation ms (54 ticks) -- longer than any 3D effect's, so it is the last thing left of a hit. */
export const DAMAGE_NUMBER_LIFE_MS = 900
/** World units above the contact point: chest contact at 1.05, crown at ~2.0, so the number starts over the torso and rises past the head, never over the face. */
export const DAMAGE_NUMBER_HEIGHT = 1.55
/** How far the number rises over its life, in CSS px. */
export const DAMAGE_NUMBER_RISE_PX = 38
/** Sideways offset per `lateral` step, in CSS px. */
export const DAMAGE_NUMBER_LATERAL_PX = 12
/** Fraction of the life at full opacity before the linear fade. */
const DAMAGE_NUMBER_HOLD_FRACTION = 0.55
/** Six spans, created once; never more than six live; a seventh recycles the oldest (§6.1). */
export const DAMAGE_NUMBER_POOL_SIZE = 6

/**
 * Where a number of `ageMs` sits relative to its projected anchor, or `null`
 * once its life is over. `risePx` eases out (fast at first, then holding);
 * under reduced motion it stays at 0 -- the number still appears and fades
 * in place, because it is the reduced-motion hit channel (§6.4).
 */
export function layoutDamageNumber(ageMs: number, reducedMotion: boolean): { risePx: number; opacity: number } | null {
  const t = ageMs / DAMAGE_NUMBER_LIFE_MS
  if (t >= 1) return null
  const eased = 1 - (1 - t) * (1 - t)
  const risePx = reducedMotion ? 0 : DAMAGE_NUMBER_RISE_PX * eased
  const opacity = t < DAMAGE_NUMBER_HOLD_FRACTION ? 1 : (1 - t) / (1 - DAMAGE_NUMBER_HOLD_FRACTION)
  return { risePx, opacity }
}

/**
 * The number's style from the batch's own pairing: `critical` when the batch
 * carried a `critical-hit` for the same action instance, else `shield` for
 * blocked chip damage (the feed's "blocks the <attack> but takes N"), else `body`. The
 * kernel never emits both `critical-hit` and `attack-blocked` for one hit, so
 * `critical` first is a defensive ordering, not a reachable rule (§6.2).
 */
export function classifyDamage(event: DamageDealtEvent, blocked: boolean, critical: boolean): DamageNumberKind {
  if (critical) return 'critical'
  if (blocked || event.contactZone === 'shield') return 'shield'
  return 'body'
}

/** A world point in the overlay's own CSS pixels, top-left origin, `y` downward -- `ArenaView`'s canvas projection. */
export interface DamageNumberProjection {
  project(worldX: number, worldY: number, worldZ: number): { x: number; y: number }
}

interface DamageNumberSlot {
  entry: DamageNumberEntry | undefined
  serial: number
  span: HTMLSpanElement | undefined
}

/**
 * The pool. Constructed with no arguments it is entries-only; `attach`
 * builds the overlay `<div>` and its six `<span>`s -- the only place this
 * module reads `document` -- and `dispose` removes them again.
 */
export class DamageNumberPool {
  private readonly slots: DamageNumberSlot[] = []
  private overlay: HTMLElement | undefined
  private nextSerial = 0

  constructor() {
    for (let i = 0; i < DAMAGE_NUMBER_POOL_SIZE; i += 1) this.slots.push({ entry: undefined, serial: -1, span: undefined })
  }

  /**
   * Builds `<div class="arena__numbers">` with the six pooled spans and
   * inserts it into `parent` directly after `canvas` -- before the status
   * heading `index.html` places after the canvas, so a digit rising under
   * the heading paints beneath its text (§6.1). Idempotent.
   */
  attach(parent: HTMLElement, canvas: HTMLCanvasElement): void {
    if (this.overlay) return
    const overlay = document.createElement('div')
    overlay.className = 'arena__numbers'
    overlay.setAttribute('aria-hidden', 'true')
    for (const slot of this.slots) {
      const span = document.createElement('span')
      span.className = 'arena__damage'
      span.dataset.testid = 'damage-number'
      span.hidden = true
      overlay.appendChild(span)
      slot.span = span
    }
    parent.insertBefore(overlay, canvas.nextSibling)
    this.overlay = overlay
  }

  /** Takes a free slot, or the oldest live one when all six are taken, and shows the number at age 0. */
  spawn(event: DamageDealtEvent, kind: DamageNumberKind, presentationMs: number): void {
    let slot = this.slots.find((candidate) => candidate.entry === undefined)
    if (!slot) {
      slot = this.slots[0]
      for (const candidate of this.slots) if (candidate.serial < slot.serial) slot = candidate
    }
    const serial = this.nextSerial
    this.nextSerial += 1
    slot.serial = serial
    slot.entry = {
      id: `dmg-${serial}`,
      amount: event.amount,
      kind,
      worldX: event.contactPoint.x,
      worldZ: event.contactPoint.z,
      spawnedAtPresentationMs: presentationMs,
      lateral: serial % 2 === 0 ? -1 : 1,
    }
    if (slot.span) {
      slot.span.textContent = String(event.amount)
      slot.span.dataset.kind = kind
    }
  }

  /**
   * Ages every live entry on the encounter clock, hiding the ones past their
   * life, and -- when a projection is given and the DOM is bound -- places
   * the rest: the contact point at `DAMAGE_NUMBER_HEIGHT` through the camera,
   * then `lateral * 12` px sideways and `risePx` up. Called after every
   * direct render, so the camera's matrices are the ones just drawn (§6.3).
   */
  update(presentationMs: number, reducedMotion: boolean, projection?: DamageNumberProjection): void {
    for (const slot of this.slots) {
      const entry = slot.entry
      if (!entry) continue
      const layout = layoutDamageNumber(presentationMs - entry.spawnedAtPresentationMs, reducedMotion)
      if (!layout) {
        slot.entry = undefined
        if (slot.span) slot.span.hidden = true
        continue
      }
      if (!slot.span || !projection) continue
      const anchor = projection.project(entry.worldX, DAMAGE_NUMBER_HEIGHT, entry.worldZ)
      const left = anchor.x + entry.lateral * DAMAGE_NUMBER_LATERAL_PX
      const top = anchor.y - layout.risePx
      slot.span.style.transform = `translate(-50%, -50%) translate(${left}px, ${top}px)`
      slot.span.style.opacity = String(layout.opacity)
      slot.span.hidden = false
    }
  }

  /** Drops every number at once -- bout start and bout clear, never an ordinary fade. */
  clear(): void {
    for (const slot of this.slots) {
      slot.entry = undefined
      if (slot.span) slot.span.hidden = true
    }
  }

  /** Removes the overlay element (a dead arena must not keep floating numbers) and every entry. */
  dispose(): void {
    this.clear()
    if (this.overlay) {
      this.overlay.remove()
      this.overlay = undefined
    }
    for (const slot of this.slots) slot.span = undefined
  }

  /** The live entries in spawn order. */
  entries(): DamageNumberEntry[] {
    return this.slots
      .filter((slot): slot is DamageNumberSlot & { entry: DamageNumberEntry } => slot.entry !== undefined)
      .sort((a, b) => a.serial - b.serial)
      .map((slot) => slot.entry)
  }

  /** `ArenaDebugSnapshot.activeDamageNumbers`: id, amount and kind of each live entry, in spawn order. */
  snapshot(): { id: string; amount: number; kind: DamageNumberKind }[] {
    return this.entries().map(({ id, amount, kind }) => ({ id, amount, kind }))
  }
}
