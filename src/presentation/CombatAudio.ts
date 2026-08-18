// Optional, event-driven combat audio (Task 18). Presentation-only: this
// module never reads simulation randomness, never changes simulation flow,
// and a backend failure here can never mutate or stop the simulation loop --
// `CombatAudio.consume` only ever *reads* an already-emitted event batch and
// a small footstep-threshold batch a caller (`main.ts`) derives from
// `FighterCombatState.travelledDistance`, exactly the way `ArenaView`
// consumes the same event batches (design.md's "Combat audio" section).
//
// This file owns three layers, kept as separately testable units per the
// brief's code-organization note:
//   1. `AudioBackend` -- the replaceable Web Audio boundary, plus
//      `BrowserAudioBackend`, its only real (non-test) implementation.
//   2. Pure mapping/variation helpers (`classifyPlantedFoot`,
//      `computePresentationVariation`, the cue-commitment table) -- no
//      backend, no class state, trivially unit-testable.
//   3. `CombatAudio` -- the controller: gesture lifecycle, cue mapping,
//      per-batch dedupe (mirroring `ArenaView`'s event-cursor discipline),
//      the eight-voice cap, and the `x4` cue whitelist.

import { COMBAT_STYLES } from '../content/combatStyles'
import type { AttackActionDefinition, AttackActionId } from '../simulation/combatActions'
import type { CombatantId, EncounterEvent } from '../simulation/encounter'
import type { Archetype } from '../simulation/fighters'
import { STYLE_GAIT_CYCLE_DISTANCE } from './poses/combatPoses'

// ---------------------------------------------------------------------------
// Public cue vocabulary and backend contract (brief Step 2)
// ---------------------------------------------------------------------------

export type CombatCue =
  | 'footstep-light'
  | 'footstep-heavy'
  | 'weapon-whoosh-light'
  | 'weapon-whoosh-heavy'
  | 'body-hit'
  | 'shield-block'
  | 'weapon-parry'
  | 'stagger'
  | 'defeat'

/** Every cue id, in a stable order -- used by the dev-only `?audioDebug=1`
 * panel (`main.ts`) to render one trigger button per cue and by
 * `CombatAudio.test.ts` for exhaustive coverage. */
export const ALL_COMBAT_CUES: readonly CombatCue[] = [
  'footstep-light',
  'footstep-heavy',
  'weapon-whoosh-light',
  'weapon-whoosh-heavy',
  'body-hit',
  'shield-block',
  'weapon-parry',
  'stagger',
  'defeat',
]

export interface AudioBackend {
  /** Creates (lazily, on first call) and/or resumes the underlying audio
   * context. Must be safe to call from a browser gesture's own synchronous
   * call stack -- `CombatAudio.enableAfterGesture` calls this synchronously,
   * before returning, specifically so a real `AudioContext.resume()` begins
   * inside that stack even though this promise settles later. Never throws;
   * resolves `false` on any failure (missing Web Audio, rejected resume). */
  enable(): Promise<boolean>
  play(cue: CombatCue, variation: Readonly<{ pitch: number; durationScale: number }>): void
  /** Quickly fades every currently-playing voice toward silence and stops
   * scheduling -- used on entering pause, never on an ordinary mute. */
  fadeOrdinaryVoices(): void
  /** Immediately stops and releases every currently-playing voice -- used on
   * mute, bout change/rematch, and dispose. */
  stopAll(): void
  activeVoiceCount(): number
}

/** One combatant's footstep threshold for this render batch: the moment
 * `PoseController`'s own gait math (mirrored here in `classifyPlantedFoot`,
 * since `PoseController.ts` is not one of this task's owned files and stays
 * untouched) crosses into a new single-foot plant. `id` is a small
 * presentation-only counter `main.ts` mints per bout (never a simulation
 * event id, and never simulation randomness) -- `CombatAudio` dedupes it
 * with its own cursor, exactly like `EncounterEvent.id`. */
export interface FootstepThreshold {
  id: number
  combatantId: CombatantId
  archetype: Archetype
  foot: 'left' | 'right'
}

export interface CombatAudioFrame {
  events: readonly EncounterEvent[]
  footsteps?: readonly FootstepThreshold[]
  boutIndex: number
  speed: 1 | 2 | 4
  paused: boolean
}

// ---------------------------------------------------------------------------
// Pure helper: footstep threshold classification
//
// Deliberately duplicates the small slice of `PoseController`'s private
// `computeGaitPhase`/`classifyGaitPhase` math it needs (travelled-distance
// modulo the style's own gait cycle distance, then which half/how close to
// a double-support boundary) rather than importing anything from
// `PoseController.ts` or `ArenaView.ts` -- neither file is in this task's
// owned set, and `PoseController` exposes no public seam for this anyway
// (its gait phase helpers are module-private, folded into `apply()`'s
// single per-fighter pose sample). Both copies are driven by the same
// authored `STYLE_GAIT_CYCLE_DISTANCE` table, so they can never disagree on
// *when* a foot plants, only whether that moment gets a cosmetic joint pose
// (`PoseController`) or a cue (`CombatAudio`).
// ---------------------------------------------------------------------------

/** Fraction of each gait half-cycle, on either side of its boundary, treated
 * as a "both feet planted" double-support window -- matches
 * `PoseController.ts`'s own `DOUBLE_SUPPORT_FRACTION` exactly. */
const DOUBLE_SUPPORT_FRACTION = 0.12

export function classifyPlantedFoot(travelledDistance: number, archetype: Archetype): 'left' | 'right' | 'both' {
  const cycleDistance = STYLE_GAIT_CYCLE_DISTANCE[archetype]
  if (!(cycleDistance > 0)) return 'both'
  const wrapped = travelledDistance % cycleDistance
  const normalized = wrapped < 0 ? wrapped + cycleDistance : wrapped
  const phase = normalized / cycleDistance
  const inFirstHalf = phase < 0.5
  const u = inFirstHalf ? phase / 0.5 : (phase - 0.5) / 0.5
  const nearBoundary = u <= DOUBLE_SUPPORT_FRACTION || u >= 1 - DOUBLE_SUPPORT_FRACTION
  if (nearBoundary) return 'both'
  return inFirstHalf ? 'right' : 'left'
}

function footstepCueForArchetype(archetype: Archetype): CombatCue {
  return archetype === 'heavy' ? 'footstep-heavy' : 'footstep-light'
}

// ---------------------------------------------------------------------------
// Pure helper: cosmetic pitch/duration variation
//
// A small deterministic integer mix, purely a function of `(boutIndex,
// eventId)` -- NOT `src/simulation/random.ts`'s labelled streams. This never
// reads, advances, or otherwise touches simulation randomness; replaying the
// exact same bout always reproduces the exact same cosmetic variation for
// the exact same event, same as every other presentation-only derived value
// in this codebase (camera damping, gait phase, IK).
// ---------------------------------------------------------------------------

const PITCH_VARIATION_MIN = 0.94
const PITCH_VARIATION_MAX = 1.06
const DURATION_VARIATION_MIN = 0.92
const DURATION_VARIATION_MAX = 1.08

/** Integer bit-mixing hash (Squirrel-noise-style constants), never
 * `Math.random` and never a simulation random stream -- see this section's
 * header comment. */
function mixToUnitInterval(a: number, b: number): number {
  let h = (Math.trunc(a) * 374761393 + Math.trunc(b) * 668265263) | 0
  h = (h ^ (h >>> 13)) | 0
  h = (h * 1274126177) | 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 0xffffffff
}

export function computePresentationVariation(boutIndex: number, eventId: number): Readonly<{ pitch: number; durationScale: number }> {
  const pitchUnit = mixToUnitInterval(boutIndex, eventId)
  const durationUnit = mixToUnitInterval(eventId, boutIndex + 1) // distinct mix: pitch/duration must not co-vary in lockstep
  return {
    pitch: PITCH_VARIATION_MIN + pitchUnit * (PITCH_VARIATION_MAX - PITCH_VARIATION_MIN),
    durationScale: DURATION_VARIATION_MIN + durationUnit * (DURATION_VARIATION_MAX - DURATION_VARIATION_MIN),
  }
}

// ---------------------------------------------------------------------------
// Pure helper: semantic event -> cue mapping
// ---------------------------------------------------------------------------

/** Whether an attack action's own authored commitment (`combatActions.ts`'s
 * `probe`/`committed`/`counter` tags -- the same classification
 * `combatDecision.ts`'s opening-bonus weighting and threat sort already use)
 * reads as the light or heavy whoosh. Built once from the authored catalog,
 * never from the action id's own string (brief resolution #10: "follows the
 * action's commitment, not its style"). */
const ATTACK_ACTION_COMMITMENT: Readonly<Record<AttackActionId, 'light' | 'heavy'>> = Object.fromEntries(
  (Object.entries(COMBAT_STYLES.attacks) as [AttackActionId, AttackActionDefinition][]).map(([id, definition]) => {
    const tags = definition.tags as readonly string[]
    const heavy = tags.includes('committed') || tags.includes('counter')
    return [id, heavy ? 'heavy' : 'light'] as const
  }),
) as Record<AttackActionId, 'light' | 'heavy'>

function whooshCueForAction(actionId: AttackActionId): CombatCue {
  return ATTACK_ACTION_COMMITMENT[actionId] === 'heavy' ? 'weapon-whoosh-heavy' : 'weapon-whoosh-light'
}

const SPEED_4_CUE_WHITELIST: ReadonlySet<CombatCue> = new Set(['body-hit', 'shield-block', 'weapon-parry', 'stagger', 'defeat'])

function isCueAllowedAtSpeed(cue: CombatCue, speed: 1 | 2 | 4): boolean {
  return speed !== 4 || SPEED_4_CUE_WHITELIST.has(cue)
}

const MAX_SIMULTANEOUS_VOICES = 8

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * One combat audio controller per running series (the caller, `main.ts`,
 * owns a single instance for the whole session -- unlike `ArenaView`'s
 * per-rig `PoseController`s, voices are shared across both fighters, so a
 * single cursor pair and voice cap are the right scope).
 *
 * `backend` may be `undefined` (brief resolution: "missing backend" -- e.g.
 * a browser with no Web Audio support at all). Every public method stays a
 * safe no-op in that case; nothing here ever throws regardless of backend
 * presence or behavior.
 */
export class CombatAudio {
  private soundEnabled = false
  private disposed = false
  private wasPaused = false
  private eventCursor = -1
  private footstepCursor = -1
  /** Invalidates a still-in-flight `enableAfterGesture` attempt's eventual
   * `.then` write -- without this, an explicit `setSoundEnabled(false)` racing
   * ahead of a slow `backend.enable()` resolution could have that resolution
   * silently flip sound back on afterward. */
  private enableGeneration = 0

  /** Dev-only test/debug surface (brief resolution #9), assigned only under
   * `import.meta.env.DEV` in the constructor -- see `ArenaView.ts`'s
   * identical `declare`d-field pattern and its own doc comment for why this
   * is what lets a production build's bundler drop it entirely, including
   * the closure body, not just the assignment. */
  declare debugPlayCue?: (cue: CombatCue) => void
  declare getDebugPlayedCues?: () => readonly CombatCue[]

  constructor(private readonly backend: AudioBackend | undefined) {
    if (import.meta.env.DEV) {
      const debugLog: CombatCue[] = []
      this.debugPlayCue = (cue: CombatCue): void => {
        const target = this.backend
        if (!target) return
        debugLog.push(cue)
        void target.enable().then((ok) => {
          if (ok) target.play(cue, { pitch: 1, durationScale: 1 })
        }).catch(() => {})
      }
      this.getDebugPlayedCues = (): readonly CombatCue[] => debugLog.slice()
    }
  }

  isSoundEnabled(): boolean {
    return this.soundEnabled
  }

  /** Creates/resumes the backend's audio context. Must be called
   * synchronously, without `await`, as the first statement of a browser
   * gesture handler (lineup-confirm click, or an explicit "Sound on" click)
   * -- see this class's own header comment and `AudioBackend.enable`'s. */
  enableAfterGesture(): Promise<void> {
    if (this.disposed || !this.backend) return Promise.resolve()
    if (this.soundEnabled) return Promise.resolve()
    const backend = this.backend
    const generation = ++this.enableGeneration
    return backend.enable()
      .then((ok) => {
        if (this.disposed || generation !== this.enableGeneration) return
        this.soundEnabled = ok
      })
      .catch(() => {
        if (this.disposed || generation !== this.enableGeneration) return
        this.soundEnabled = false
      })
  }

  /** Backs the visible `Sound on`/`Sound off` control. Turning sound on when
   * it has never yet been enabled performs the same gesture-eligible enable
   * as `enableAfterGesture` (design.md: "an explicit `Sound on` click" is
   * itself an eligible enabling gesture). Turning sound off mutes
   * immediately -- a hard stop, not pause's fade. */
  setSoundEnabled(enabled: boolean): Promise<void> {
    if (this.disposed || !this.backend) return Promise.resolve()
    if (!enabled) {
      this.enableGeneration += 1
      this.soundEnabled = false
      this.backend.stopAll()
      return Promise.resolve()
    }
    if (this.soundEnabled) return Promise.resolve()
    return this.enableAfterGesture()
  }

  /**
   * Processes one render batch. Every event/footstep `id` past this
   * instance's own cursor is handled exactly once and the cursor advances
   * unconditionally -- mirroring `ArenaView.processNewEvents`'s discipline
   * precisely, so a dev-only re-render of the same tick pair, a duplicate
   * `consume` call with the same batch, or a batch that arrives while muted
   * or paused can never replay a cue for an id already seen.
   */
  consume(input: CombatAudioFrame): void {
    if (this.disposed) return

    if (input.paused) {
      if (!this.wasPaused) this.backend?.fadeOrdinaryVoices()
      this.wasPaused = true
      this.advanceCursorsOnly(input)
      return
    }
    this.wasPaused = false

    const blockedInstanceIds = new Set<string>()
    for (const event of input.events) {
      if (event.id <= this.eventCursor) continue
      this.eventCursor = event.id
      this.handleEvent(event, input, blockedInstanceIds)
    }
    for (const foot of input.footsteps ?? []) {
      if (foot.id <= this.footstepCursor) continue
      this.footstepCursor = foot.id
      this.tryPlay(footstepCueForArchetype(foot.archetype), foot.id, input)
    }
  }

  /** Bout change and rematch (brief resolution #8, design.md: "Arena reset
   * clears pose, trails, flashes, audio voices, event cursors... at each new
   * bout and on rematch") -- stops every voice and resets both cursors so
   * the next bout's event/footstep ids (which restart from the same low
   * numbers) are treated as genuinely new, not a replay. Sound enablement
   * itself is a session-level concern and is deliberately left untouched. */
  resetBout(): void {
    this.eventCursor = -1
    this.footstepCursor = -1
    this.wasPaused = false
    this.backend?.stopAll()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.backend?.stopAll()
  }

  // -- Internal -----------------------------------------------------------

  private advanceCursorsOnly(input: CombatAudioFrame): void {
    for (const event of input.events) if (event.id > this.eventCursor) this.eventCursor = event.id
    for (const foot of input.footsteps ?? []) if (foot.id > this.footstepCursor) this.footstepCursor = foot.id
  }

  /**
   * Maps one event to (at most) one cue, purely from its own `type` and
   * `contactZone` -- never from ad-hoc string matching on ids. `blockedInstanceIds`
   * is scoped to this single `consume` call (never persisted across calls),
   * matching `ArenaView.processNewEvents`'s identical reasoning: a
   * guard-blocked hit always emits *both* `attack-blocked` and a paired
   * `damage-dealt` (same `actionInstanceId`, same tick, same `contactZone:
   * 'shield'`) -- without this, that single exchange would double up as both
   * a `shield-block` cue and a `body-hit` cue.
   */
  private handleEvent(event: EncounterEvent, input: CombatAudioFrame, blockedInstanceIds: Set<string>): void {
    switch (event.type) {
      case 'action-started':
        // design.md: "Probe whooshes begin on the first tick of windup" --
        // `action-started` fires exactly at windup's first tick
        // (`encounter.ts`'s `startSelectedActions`).
        this.tryPlay(whooshCueForAction(event.actionId), event.id, input)
        break
      case 'attack-blocked':
        blockedInstanceIds.add(event.actionInstanceId)
        this.tryPlay('shield-block', event.id, input)
        break
      case 'attack-parried':
        this.tryPlay('weapon-parry', event.id, input)
        break
      case 'damage-dealt':
        if (event.contactZone === 'body' && !blockedInstanceIds.has(event.actionInstanceId)) {
          this.tryPlay('body-hit', event.id, input)
        }
        break
      case 'fighter-staggered':
        this.tryPlay('stagger', event.id, input)
        break
      case 'fighter-defeated':
        this.tryPlay('defeat', event.id, input)
        break
      default:
        break
    }
  }

  /** The one place voice-count/speed policy and mute/backend-availability
   * gating actually happen, so every cue (event-driven or footstep-driven)
   * goes through identical rules. */
  private tryPlay(cue: CombatCue, eventId: number, input: CombatAudioFrame): void {
    if (!this.backend || !this.soundEnabled) return
    if (!isCueAllowedAtSpeed(cue, input.speed)) return
    if (this.backend.activeVoiceCount() >= MAX_SIMULTANEOUS_VOICES) return
    this.backend.play(cue, computePresentationVariation(input.boutIndex, eventId))
  }
}

// ---------------------------------------------------------------------------
// Browser backend -- the only non-test `AudioBackend` implementation. All
// Web Audio detail (oscillator/noise/filter/gain graphs) is confined to this
// section; `CombatAudio` above never touches `AudioContext`/`AudioNode`
// directly, which is what lets `CombatAudio.test.ts` run with no browser
// audio hardware.
// ---------------------------------------------------------------------------

type AudioContextConstructor = new () => AudioContext

function resolveAudioContextConstructor(): AudioContextConstructor | undefined {
  if (typeof window === 'undefined') return undefined
  const withVendorPrefix = window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor }
  return withVendorPrefix.AudioContext ?? withVendorPrefix.webkitAudioContext
}

const CUE_BASE_FREQUENCY_HZ: Readonly<Record<CombatCue, number>> = {
  'footstep-light': 260,
  'footstep-heavy': 120,
  'weapon-whoosh-light': 1100,
  'weapon-whoosh-heavy': 620,
  'body-hit': 130,
  'shield-block': 720,
  'weapon-parry': 1500,
  stagger: 240,
  defeat: 85,
}

const CUE_DURATION_MS: Readonly<Record<CombatCue, number>> = {
  'footstep-light': 55,
  'footstep-heavy': 85,
  'weapon-whoosh-light': 130,
  'weapon-whoosh-heavy': 190,
  'body-hit': 150,
  'shield-block': 130,
  'weapon-parry': 110,
  stagger: 220,
  defeat: 520,
}

/** Percussive cues (footsteps, both whooshes, body hits) synthesize from a
 * short filtered noise burst; the rest are tonal (oscillator-only). */
const NOISE_BASED_CUES: ReadonlySet<CombatCue> = new Set(['footstep-light', 'footstep-heavy', 'weapon-whoosh-light', 'weapon-whoosh-heavy', 'body-hit'])
const LOWPASS_CUES: ReadonlySet<CombatCue> = new Set(['footstep-heavy', 'weapon-whoosh-heavy', 'body-hit', 'defeat'])
const DESCENDING_PITCH_CUES: ReadonlySet<CombatCue> = new Set(['stagger', 'defeat'])

const PEAK_GAIN = 0.22
const MIN_GAIN = 0.0001
const FADE_SECONDS = 0.08
const NOISE_BUFFER_SECONDS = 1

function createNoiseBuffer(context: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * NOISE_BUFFER_SECONDS))
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  // Synthesis-time noise texture for a local audio effect -- not simulation
  // content and not read by anything under `src/simulation/**`; unrelated to
  // (and never mixed with) the deterministic combat kernel's own labelled
  // random streams.
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}

interface ActiveVoice {
  master: GainNode
  sources: readonly AudioScheduledSourceNode[]
}

export class BrowserAudioBackend implements AudioBackend {
  private context: AudioContext | undefined
  private noiseBuffer: AudioBuffer | undefined
  private readonly activeVoices = new Set<ActiveVoice>()

  async enable(): Promise<boolean> {
    try {
      if (!this.context) {
        const Ctor = resolveAudioContextConstructor()
        if (!Ctor) return false
        this.context = new Ctor()
        this.noiseBuffer = createNoiseBuffer(this.context)
      }
      if (this.context.state === 'suspended') await this.context.resume()
      return this.context.state === 'running'
    } catch {
      return false
    }
  }

  play(cue: CombatCue, variation: Readonly<{ pitch: number; durationScale: number }>): void {
    const context = this.context
    if (!context || context.state !== 'running') return
    try {
      this.playVoice(context, cue, variation)
    } catch {
      // A synthesis failure here is a presentation-only concern; never let
      // it propagate into the caller's simulation/render loop.
    }
  }

  fadeOrdinaryVoices(): void {
    const context = this.context
    if (!context) return
    const now = context.currentTime
    for (const voice of this.activeVoices) {
      try {
        voice.master.gain.cancelScheduledValues(now)
        voice.master.gain.setValueAtTime(Math.max(voice.master.gain.value, MIN_GAIN), now)
        voice.master.gain.exponentialRampToValueAtTime(MIN_GAIN, now + FADE_SECONDS)
        for (const source of voice.sources) source.stop(now + FADE_SECONDS + 0.01)
      } catch {
        // Already stopped/ended -- nothing left to fade.
      }
    }
  }

  stopAll(): void {
    for (const voice of Array.from(this.activeVoices)) this.releaseVoice(voice)
    this.activeVoices.clear()
  }

  activeVoiceCount(): number {
    return this.activeVoices.size
  }

  private playVoice(context: AudioContext, cue: CombatCue, variation: Readonly<{ pitch: number; durationScale: number }>): void {
    const now = context.currentTime
    const durationSeconds = Math.max(0.02, (CUE_DURATION_MS[cue] / 1000) * variation.durationScale)
    const baseFrequency = Math.max(20, CUE_BASE_FREQUENCY_HZ[cue] * variation.pitch)

    const master = context.createGain()
    master.gain.setValueAtTime(MIN_GAIN, now)
    master.gain.exponentialRampToValueAtTime(PEAK_GAIN, now + Math.min(0.012, durationSeconds * 0.25))
    master.gain.exponentialRampToValueAtTime(MIN_GAIN, now + durationSeconds)
    master.connect(context.destination)

    const sources: AudioScheduledSourceNode[] = []

    if (NOISE_BASED_CUES.has(cue) && this.noiseBuffer) {
      const noise = context.createBufferSource()
      noise.buffer = this.noiseBuffer
      noise.loop = true
      const filter = context.createBiquadFilter()
      filter.type = LOWPASS_CUES.has(cue) ? 'lowpass' : 'highpass'
      filter.frequency.setValueAtTime(baseFrequency * 3, now)
      noise.connect(filter)
      filter.connect(master)
      sources.push(noise)
    }

    if (!NOISE_BASED_CUES.has(cue) || cue === 'body-hit') {
      const oscillator = context.createOscillator()
      oscillator.type = cue === 'weapon-parry' ? 'triangle' : cue === 'shield-block' ? 'square' : 'sine'
      oscillator.frequency.setValueAtTime(baseFrequency, now)
      if (DESCENDING_PITCH_CUES.has(cue)) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, baseFrequency * 0.4), now + durationSeconds)
      }
      oscillator.connect(master)
      sources.push(oscillator)
    }

    const voice: ActiveVoice = { master, sources }
    this.activeVoices.add(voice)
    const stopAt = now + durationSeconds + 0.02
    for (const source of sources) {
      source.start(now)
      source.stop(stopAt)
    }
    const cleanup = (): void => this.releaseVoice(voice)
    const last = sources[sources.length - 1]
    if (last) last.onended = cleanup
    else cleanup()
  }

  private releaseVoice(voice: ActiveVoice): void {
    this.activeVoices.delete(voice)
    try {
      for (const source of voice.sources) source.stop()
    } catch {
      // Already stopped.
    }
    for (const source of voice.sources) source.disconnect()
    voice.master.disconnect()
  }
}

/** `undefined` whenever this environment has no usable Web Audio
 * (brief resolution: "missing backend") -- `main.ts` passes this straight
 * into `new CombatAudio(...)`, which degrades to a safe no-op throughout. */
export function createBrowserAudioBackend(): AudioBackend | undefined {
  return resolveAudioContextConstructor() ? new BrowserAudioBackend() : undefined
}
