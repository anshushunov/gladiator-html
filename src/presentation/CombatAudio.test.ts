import { describe, expect, it } from 'vitest'
import {
  classifyPlantedFoot,
  computePresentationVariation,
  CombatAudio,
  type AudioBackend,
  type CombatAudioFrame,
  type CombatCue,
} from './CombatAudio'
import { COMBAT_STYLES } from '../content/combatStyles'
import { STYLE_GAIT_CYCLE_DISTANCE } from './gait'
import type {
  ActionStartedEvent,
  AttackBlockedEvent,
  AttackParriedEvent,
  DamageDealtEvent,
  EncounterEvent,
  FighterDefeatedEvent,
  FighterStaggeredEvent,
} from '../simulation/encounter'
import type { AttackActionId } from '../simulation/combatActions'

// ---------------------------------------------------------------------------
// Fake backend: no browser AudioContext required. Mirrors the real
// `BrowserAudioBackend`'s voice bookkeeping (an `activeVoiceCount` that grows
// on `play` and drains on `fadeOrdinaryVoices`/`stopAll`) closely enough to
// exercise the controller's voice-cap and speed-policy logic, while staying a
// plain in-memory recorder for assertions.
// ---------------------------------------------------------------------------

class FakeAudioBackend implements AudioBackend {
  readonly played: { cue: CombatCue; variation: Readonly<{ pitch: number; durationScale: number }> }[] = []
  enableResult: boolean | 'reject' = true
  enableCalls = 0
  private active = 0

  async enable(): Promise<boolean> {
    this.enableCalls += 1
    if (this.enableResult === 'reject') throw new Error('enable rejected')
    return this.enableResult
  }

  play(cue: CombatCue, variation: Readonly<{ pitch: number; durationScale: number }>): void {
    this.played.push({ cue, variation })
    this.active += 1
  }

  fadeOrdinaryVoices(): void {
    this.active = 0
  }

  stopAll(): void {
    this.active = 0
  }

  activeVoiceCount(): number {
    return this.active
  }

  /** Test-only: simulates one currently-playing voice finishing naturally, freeing a slot for the eight-voice cap tests. */
  finishOneVoice(): void {
    this.active = Math.max(0, this.active - 1)
  }
}

async function enabledAudio(backend: AudioBackend = new FakeAudioBackend()): Promise<CombatAudio> {
  const audio = new CombatAudio(backend)
  await audio.enableAfterGesture()
  return audio
}

function playedCues(backend: FakeAudioBackend): CombatCue[] {
  return backend.played.map(({ cue }) => cue)
}

function frame(events: readonly EncounterEvent[], overrides: Partial<CombatAudioFrame> = {}): CombatAudioFrame {
  return { events, boutIndex: 0, speed: 1, paused: false, ...overrides }
}

// ---------------------------------------------------------------------------
// Fixture events -- structurally typed, not drawn from a real encounter run
// (`CombatAudio` never touches simulation RNG or a real `BattleState`; it
// only maps already-emitted event shapes to cues).
// ---------------------------------------------------------------------------

const blockEvent: AttackBlockedEvent = {
  id: 1,
  tick: 10,
  type: 'attack-blocked',
  actorId: 'a',
  targetId: 'b',
  actionInstanceId: 'a:0',
  actionId: 'heavy-shield-jab',
  contactZone: 'shield',
  contactPoint: { x: 0, z: 0 },
}

const parryEvent: AttackParriedEvent = {
  id: 2,
  tick: 12,
  type: 'attack-parried',
  actorId: 'a',
  defenderId: 'b',
  actionInstanceId: 'a:1',
  actionId: 'technical-thrust',
  contactZone: 'weapon',
  contactPoint: { x: 0, z: 0 },
}

function bodyHitEvent(id: number, actionInstanceId = 'a:2'): DamageDealtEvent {
  return {
    id,
    tick: 14,
    type: 'damage-dealt',
    actorId: 'a',
    targetId: 'b',
    actionInstanceId,
    actionId: 'fast-slash',
    amount: 5,
    remainingHp: 20,
    contactZone: 'body',
    contactPoint: { x: 0, z: 0 },
  }
}

function shieldDamageEvent(id: number, actionInstanceId: string): DamageDealtEvent {
  return {
    id,
    tick: 14,
    type: 'damage-dealt',
    actorId: 'a',
    targetId: 'b',
    actionInstanceId,
    actionId: 'heavy-shield-jab',
    amount: 1,
    remainingHp: 20,
    contactZone: 'shield',
    contactPoint: { x: 0, z: 0 },
  }
}

const staggerEvent: FighterStaggeredEvent = {
  id: 3,
  tick: 16,
  type: 'fighter-staggered',
  combatantId: 'b',
  sourceId: 'a',
  actionInstanceId: 'a:3',
  durationTicks: 12,
  direction: { x: 0, z: 1 },
}

const defeatEvent: FighterDefeatedEvent = {
  id: 4,
  tick: 900,
  type: 'fighter-defeated',
  defeatedId: 'b',
  sourceId: 'a',
}

function actionStartedEvent(id: number, actionId: AttackActionId): ActionStartedEvent {
  return {
    id,
    tick: 5,
    type: 'action-started',
    actorId: 'a',
    targetId: 'b',
    actionInstanceId: `a:${id}`,
    actionId,
    expectedContactTick: 20,
  }
}

// ---------------------------------------------------------------------------
// Step 1: cue mapping, dedupe, and speed policy
// ---------------------------------------------------------------------------

describe('CombatAudio cue mapping', () => {
  it('maps a block to shield-block and never replays the same event id', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)

    audio.consume(frame([blockEvent]))
    audio.consume(frame([blockEvent]))

    expect(playedCues(backend)).toEqual(['shield-block'])
  })

  it('maps a parry to weapon-parry', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([parryEvent]))
    expect(playedCues(backend)).toEqual(['weapon-parry'])
  })

  it('maps an unblocked body-zone hit to body-hit', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([bodyHitEvent(5)]))
    expect(playedCues(backend)).toEqual(['body-hit'])
  })

  it('does not double up body-hit for the damage-dealt paired with an attack-blocked on the same instance', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    const blocked: AttackBlockedEvent = { ...blockEvent, id: 10, actionInstanceId: 'pair:0' }
    const paired = shieldDamageEvent(11, 'pair:0')
    audio.consume(frame([blocked, paired]))
    expect(playedCues(backend)).toEqual(['shield-block'])
  })

  it('maps fighter-staggered to stagger and fighter-defeated to defeat', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([staggerEvent, defeatEvent]))
    expect(playedCues(backend)).toEqual(['stagger', 'defeat'])
  })

  it('maps action-started to weapon-whoosh-light for a probe action and weapon-whoosh-heavy for a committed action', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([actionStartedEvent(20, 'heavy-shield-jab'), actionStartedEvent(21, 'heavy-cleave')]))
    expect(playedCues(backend)).toEqual(['weapon-whoosh-light', 'weapon-whoosh-heavy'])
  })

  it('maps the forced counter action to weapon-whoosh-heavy, matching committed action weight rather than style name', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([actionStartedEvent(22, 'technical-parry-counter')]))
    expect(playedCues(backend)).toEqual(['weapon-whoosh-heavy'])
  })

  it('maps every probe attack action to the light whoosh and every committed/counter action to the heavy whoosh (semantic, not per-style)', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    let id = 100
    for (const [actionId, definition] of Object.entries(COMBAT_STYLES.attacks)) {
      audio.consume(frame([actionStartedEvent(id, actionId as never)]))
      const tags = definition.tags as readonly string[]
      const expectedCue = tags.includes('committed') || tags.includes('counter')
        ? 'weapon-whoosh-heavy'
        : 'weapon-whoosh-light'
      expect(backend.played.at(-1)?.cue, actionId).toBe(expectedCue)
      id += 1
    }
  })

  it('maps footstep thresholds to footstep-heavy for a heavy fighter and footstep-light for a fast/technical fighter', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([], {
      footsteps: [
        { id: 1, combatantId: 'a', archetype: 'heavy', foot: 'left' },
        { id: 2, combatantId: 'b', archetype: 'fast', foot: 'right' },
        { id: 3, combatantId: 'c', archetype: 'technical', foot: 'left' },
      ],
    }))
    expect(playedCues(backend)).toEqual(['footstep-heavy', 'footstep-light', 'footstep-light'])
  })

  it('never plays a footstep for a threshold id already seen, even across separate consume calls', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    const footstep = { id: 1, combatantId: 'a', archetype: 'heavy' as const, foot: 'left' as const }
    audio.consume(frame([], { footsteps: [footstep] }))
    audio.consume(frame([], { footsteps: [footstep] }))
    expect(playedCues(backend)).toEqual(['footstep-heavy'])
  })
})

// ---------------------------------------------------------------------------
// Speed policy: eight-voice cap and the x4 whitelist
// ---------------------------------------------------------------------------

describe('CombatAudio speed policy', () => {
  it('allows all nine cue kinds at x1 and x2, up to eight simultaneous voices', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    const events = Array.from({ length: 10 }, (_, i) => bodyHitEvent(i + 1, `inst:${i}`))
    audio.consume(frame(events, { speed: 2 }))
    // Only the first eight play; the ninth/tenth are dropped by the cap, and
    // their event ids are still marked consumed (asserted separately below).
    expect(backend.played).toHaveLength(8)
  })

  it('never replays an event dropped by the eight-voice cap once a voice frees up', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    const events = Array.from({ length: 9 }, (_, i) => bodyHitEvent(i + 1, `inst:${i}`))
    audio.consume(frame(events))
    expect(backend.played).toHaveLength(8)
    backend.finishOneVoice()
    // Re-consuming the exact same (already-processed) batch must not replay
    // the ninth event just because a voice slot freed up -- the cursor
    // already advanced past every id in this batch.
    audio.consume(frame(events))
    expect(backend.played).toHaveLength(8)
  })

  it('drops a whoosh at x4 but still plays body-hit at x4', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([actionStartedEvent(1, 'fast-slash'), bodyHitEvent(2)], { speed: 4 }))
    expect(playedCues(backend)).not.toContain('weapon-whoosh-light')
    expect(playedCues(backend)).toContain('body-hit')
  })

  it('allows only body hit, block, parry, stagger, and defeat at x4', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    // Ids must be strictly increasing in the order the batch is handed over
    // (as they always are within a real encounter batch) -- otherwise the
    // event cursor's own dedupe would (correctly) skip an out-of-order id.
    audio.consume(frame([
      { ...blockEvent, id: 1 },
      { ...parryEvent, id: 2 },
      bodyHitEvent(3),
      { ...staggerEvent, id: 4 },
      { ...defeatEvent, id: 5 },
    ], { speed: 4 }))
    expect(playedCues(backend).sort()).toEqual(['body-hit', 'defeat', 'shield-block', 'stagger', 'weapon-parry'].sort())
  })

  it('suppresses footsteps at x4', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([], { speed: 4, footsteps: [{ id: 1, combatantId: 'a', archetype: 'heavy', foot: 'left' }] }))
    expect(backend.played).toHaveLength(0)
  })

  it('does not replay a whoosh suppressed at x4 once speed later drops back to x1', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    const started = actionStartedEvent(1, 'fast-slash')
    audio.consume(frame([started], { speed: 4 }))
    expect(playedCues(backend)).toEqual([])
    // The event id has already been consumed once, at x4 -- re-handing the
    // same batch at x1 must not resurrect it (design.md: "the same
    // event/pose threshold cannot play twice after re-render").
    audio.consume(frame([started], { speed: 1 }))
    expect(playedCues(backend)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Pause / resume, bout reset, and mute
// ---------------------------------------------------------------------------

describe('CombatAudio lifecycle', () => {
  it('fades ordinary voices on entering pause and stops scheduling new cues while paused', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([bodyHitEvent(1)]))
    expect(backend.activeVoiceCount()).toBe(1)
    audio.consume(frame([staggerEvent], { paused: true }))
    expect(backend.activeVoiceCount()).toBe(0) // fadeOrdinaryVoices cleared it
    expect(playedCues(backend)).toEqual(['body-hit']) // stagger was not scheduled while paused
  })

  it('resumes playing only new events after pause, never replaying what was missed', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([bodyHitEvent(1)], { paused: true }))
    expect(playedCues(backend)).toEqual([])
    audio.consume(frame([bodyHitEvent(1)], { paused: false })) // same id resurfacing must still not replay
    expect(playedCues(backend)).toEqual([])
    audio.consume(frame([staggerEvent], { paused: false }))
    expect(playedCues(backend)).toEqual(['stagger'])
  })

  it('resetBout stops all voices and lets the same event id play again for a new bout', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([bodyHitEvent(1)]))
    expect(playedCues(backend)).toEqual(['body-hit'])
    audio.resetBout()
    expect(backend.activeVoiceCount()).toBe(0)
    audio.consume(frame([bodyHitEvent(1)]))
    expect(playedCues(backend)).toEqual(['body-hit', 'body-hit'])
  })

  it('mutes immediately via setSoundEnabled(false), stopping voices and playing no new cues', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([bodyHitEvent(1)]))
    expect(backend.activeVoiceCount()).toBe(1)
    await audio.setSoundEnabled(false)
    expect(backend.activeVoiceCount()).toBe(0)
    audio.consume(frame([staggerEvent]))
    expect(playedCues(backend)).toEqual(['body-hit'])
  })

  it('does not replay events consumed while muted once unmuted', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    await audio.setSoundEnabled(false)
    audio.consume(frame([bodyHitEvent(1)]))
    expect(playedCues(backend)).toEqual([])
    await audio.setSoundEnabled(true)
    audio.consume(frame([bodyHitEvent(1)]))
    expect(playedCues(backend)).toEqual([]) // id 1 was already consumed while muted
    audio.consume(frame([staggerEvent]))
    expect(playedCues(backend)).toEqual(['stagger'])
  })

  it('dispose stops all voices and makes further consume calls inert', async () => {
    const backend = new FakeAudioBackend()
    const audio = await enabledAudio(backend)
    audio.consume(frame([bodyHitEvent(1)]))
    audio.dispose()
    expect(backend.activeVoiceCount()).toBe(0)
    audio.consume(frame([staggerEvent]))
    expect(playedCues(backend)).toEqual(['body-hit'])
  })
})

// ---------------------------------------------------------------------------
// Gesture lifecycle: enable, rejection, missing backend
// ---------------------------------------------------------------------------

describe('CombatAudio gesture lifecycle', () => {
  it('defaults to disabled and never plays before enableAfterGesture resolves', async () => {
    const backend = new FakeAudioBackend()
    const audio = new CombatAudio(backend)
    expect(audio.isSoundEnabled()).toBe(false)
    audio.consume(frame([bodyHitEvent(1)]))
    expect(playedCues(backend)).toEqual([])
  })

  it('defaults sound on after the first successful eligible gesture', async () => {
    const backend = new FakeAudioBackend()
    const audio = new CombatAudio(backend)
    await audio.enableAfterGesture()
    expect(audio.isSoundEnabled()).toBe(true)
  })

  it('stays silently disabled when the backend rejects enable()', async () => {
    const backend = new FakeAudioBackend()
    backend.enableResult = 'reject'
    const audio = new CombatAudio(backend)
    await expect(audio.enableAfterGesture()).resolves.toBeUndefined()
    expect(audio.isSoundEnabled()).toBe(false)
    audio.consume(frame([bodyHitEvent(1)]))
    expect(playedCues(backend)).toEqual([])
  })

  it('stays silently disabled when the backend resolves enable() to false', async () => {
    const backend = new FakeAudioBackend()
    backend.enableResult = false
    const audio = new CombatAudio(backend)
    await audio.enableAfterGesture()
    expect(audio.isSoundEnabled()).toBe(false)
  })

  it('never throws and never plays with a missing (undefined) backend', async () => {
    const audio = new CombatAudio(undefined)
    await expect(audio.enableAfterGesture()).resolves.toBeUndefined()
    expect(audio.isSoundEnabled()).toBe(false)
    expect(() => audio.consume(frame([bodyHitEvent(1)]))).not.toThrow()
    expect(() => audio.resetBout()).not.toThrow()
    expect(() => audio.dispose()).not.toThrow()
    await expect(audio.setSoundEnabled(true)).resolves.toBeUndefined()
  })

  it('setSoundEnabled(true) performs the same gesture-eligible enable as enableAfterGesture when not yet enabled', async () => {
    const backend = new FakeAudioBackend()
    const audio = new CombatAudio(backend)
    await audio.setSoundEnabled(true)
    expect(audio.isSoundEnabled()).toBe(true)
    expect(backend.enableCalls).toBe(1)
  })

  // The exact ordering contract main.ts's lineup-confirm click handler
  // depends on: `void combatAudio.enableAfterGesture()` must invoke
  // `backend.enable()` synchronously, before the caller's very next
  // statement runs -- even though the returned promise only settles later
  // (browsers only honour `AudioContext.resume()` inside a gesture's own
  // synchronous call stack; anything deferred past a microtask boundary
  // loses that privilege). This fixture proves `CombatAudio` upholds that
  // contract regardless of what main.ts does around it.
  it('handler-order fixture: invokes backend.enable() synchronously before a subsequent synchronous command runs, settling only later', async () => {
    const calls: string[] = []
    const backend = new FakeAudioBackend()
    const originalEnable = backend.enable.bind(backend)
    backend.enable = (): Promise<boolean> => {
      calls.push('backend.enable() called')
      return originalEnable().then((ok) => {
        calls.push('backend.enable() settled')
        return ok
      })
    }
    const audio = new CombatAudio(backend)

    function runConfirmLineupCommand(): void {
      calls.push('confirm-lineup command ran')
    }

    // Exactly main.ts's `applyIntent` 'confirm' case: `enableAfterGesture()`
    // fired without `await` as the very first statement, then the
    // synchronous series command runs immediately regardless of audio.
    function handleLineupConfirmClick(): void {
      void audio.enableAfterGesture()
      runConfirmLineupCommand()
    }

    handleLineupConfirmClick()

    // Both the backend call and the synchronous command have already
    // happened -- entirely before the enable promise's `.then` has run.
    expect(calls).toEqual(['backend.enable() called', 'confirm-lineup command ran'])

    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(['backend.enable() called', 'confirm-lineup command ran', 'backend.enable() settled'])
    expect(audio.isSoundEnabled()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Step 2: pure helper units -- footstep classification and cosmetic variation
// ---------------------------------------------------------------------------

describe('classifyPlantedFoot', () => {
  it('starts in the double-support window at zero travelled distance for every archetype', () => {
    expect(classifyPlantedFoot(0, 'heavy')).toBe('both')
    expect(classifyPlantedFoot(0, 'fast')).toBe('both')
    expect(classifyPlantedFoot(0, 'technical')).toBe('both')
  })

  it('alternates left/right/both across a full gait cycle, matching PoseController.classifyGaitPhase\'s envelope', () => {
    const cycle = STYLE_GAIT_CYCLE_DISTANCE.heavy
    const sequence = [0, 0.05, 0.3, 0.5, 0.55, 0.8, 0.999].map((fraction) => classifyPlantedFoot(fraction * cycle, 'heavy'))
    // Near each boundary (0, 0.5, 1.0) both feet are planted; the midpoints
    // of each half alternate right (first half) then left (second half).
    expect(sequence[0]).toBe('both')
    expect(sequence[2]).toBe('right') // fraction 0.3: first half, clear of both boundaries
    expect(sequence[5]).toBe('left') // fraction 0.8: second half, the same relative distance from its boundaries as 0.3 is from the first half's
  })

  it('is deterministic and pure: the same inputs always classify the same way', () => {
    expect(classifyPlantedFoot(1.37, 'fast')).toBe(classifyPlantedFoot(1.37, 'fast'))
  })
})

describe('computePresentationVariation', () => {
  it('is a deterministic pure function of bout index and event id, never simulation randomness', () => {
    const a = computePresentationVariation(2, 41)
    const b = computePresentationVariation(2, 41)
    expect(a).toEqual(b)
  })

  it('varies with event id so repeated cues of the same type do not sound identical', () => {
    const a = computePresentationVariation(0, 1)
    const b = computePresentationVariation(0, 2)
    expect(a).not.toEqual(b)
  })

  it('varies with bout index so the same event id across bouts is not identical', () => {
    const a = computePresentationVariation(0, 1)
    const b = computePresentationVariation(1, 1)
    expect(a).not.toEqual(b)
  })

  it('stays within the exact authored range around unity (pitch 0.94..1.06, duration 0.92..1.08)', () => {
    // Tightened from a 0.85..1.15 band (final-review fix #6): that band was
    // roughly 2.5x wider than the implementation's actual
    // `PITCH_VARIATION_MIN/MAX`/`DURATION_VARIATION_MIN/MAX` constants, so it
    // would also have passed for a mixer that authored ~2.5x more wobble
    // than intended, or for one that broke and always returned exactly
    // `1.0`. Both bounds are asserted, and variation itself is checked
    // separately below.
    let sawPitchBelowUnity = false
    let sawPitchAboveUnity = false
    let sawDurationBelowUnity = false
    let sawDurationAboveUnity = false
    for (let id = 0; id < 50; id += 1) {
      const { pitch, durationScale } = computePresentationVariation(0, id)
      expect(pitch).toBeGreaterThanOrEqual(0.94)
      expect(pitch).toBeLessThanOrEqual(1.06)
      expect(durationScale).toBeGreaterThanOrEqual(0.92)
      expect(durationScale).toBeLessThanOrEqual(1.08)
      if (pitch < 1) sawPitchBelowUnity = true
      if (pitch > 1) sawPitchAboveUnity = true
      if (durationScale < 1) sawDurationBelowUnity = true
      if (durationScale > 1) sawDurationAboveUnity = true
    }
    // The values actually vary on both sides of unity across this run, not
    // just staying within bounds -- rules out a constant-1.0 (or any other
    // constant) mixer passing the range assertions above vacuously.
    expect(sawPitchBelowUnity).toBe(true)
    expect(sawPitchAboveUnity).toBe(true)
    expect(sawDurationBelowUnity).toBe(true)
    expect(sawDurationAboveUnity).toBe(true)
  })
})
