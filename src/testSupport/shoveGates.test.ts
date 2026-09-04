import { describe, expect, it } from 'vitest'
import {
  checkShoveGateW,
  type ShoveRunSummary,
  W_MAX_DECISION_SHARE,
  W_MIN_BOUT_SHARE,
  W_MIN_SHOVE_CONTACTS,
  W_MIN_SHOVE_STARTS,
} from './shoveGates'

// Spec §4, gate W's own numbers: 400 shove starts, 220 resolved contacts,
// 90/200 bouts touched, a 13.3% share of the murmillo's attack decisions, and
// a recovery window that costs the murmillo more than his jab's does. Every
// one of the four checks reads green here, so this is the summary every
// failing test perturbs by exactly the field its check reads.
const green: ShoveRunSummary = {
  shoveStarts: 400, shoveContacts: 220, boutsWithAShove: 90, bouts: 200,
  murmilloAttackDecisions: 3000, shoveDecisions: 400,
  recoveryWindowContactsPerShove: 0.31, recoveryWindowContactsPerJab: 0.22, jabContacts: 900,
}

it('passes a run where the shove is used, is not the moveset, and is punished', () => {
  expect(checkShoveGateW(green)).toEqual({ pass: true })
})

it('FAILS a run with no shoves at all, rather than passing the ceiling vacuously', () => {
  const verdict = checkShoveGateW({ ...green, shoveStarts: 0, shoveContacts: 0, boutsWithAShove: 0, shoveDecisions: 0 })
  expect(verdict.pass).toBe(false)
  expect(verdict.pass === false && verdict.failures.join(' ')).toMatch(/coverage/i)
})

it('fails a run where the shove is more than a fifth of the murmillo\'s attacks', () => {
  const verdict = checkShoveGateW({ ...green, shoveDecisions: 700 })   // 700/3000 = 23.3%
  expect(verdict.pass).toBe(false)
  expect(verdict.pass === false && verdict.failures.join(' ')).toMatch(/frequency/i)
})

it('fails a run where the long recovery costs the murmillo nothing', () => {
  const verdict = checkShoveGateW({ ...green, recoveryWindowContactsPerShove: 0.10 })
  expect(verdict.pass).toBe(false)
  expect(verdict.pass === false && verdict.failures.join(' ')).toMatch(/punish/i)
})

it('fails when a compared population is empty, instead of dividing by zero', () => {
  const verdict = checkShoveGateW({ ...green, jabContacts: 0 })
  expect(verdict.pass).toBe(false)
  expect(verdict.pass === false && verdict.failures.join(' ')).toMatch(/population/i)
})

describe('failure messages carry the measured numbers, not just a verdict', () => {
  it('reports the frequency share and the raw counts it was computed from', () => {
    const verdict = checkShoveGateW({ ...green, shoveDecisions: 700 })
    expect(verdict.pass).toBe(false)
    const message = verdict.pass === false ? verdict.failures.join(' ') : ''
    expect(message).toContain('700')
    expect(message).toContain('3000')
    expect(message).toMatch(/23\.3/)
  })

  it('reports both recovery-window rates on a punishability failure', () => {
    const verdict = checkShoveGateW({ ...green, recoveryWindowContactsPerShove: 0.10 })
    expect(verdict.pass).toBe(false)
    const message = verdict.pass === false ? verdict.failures.join(' ') : ''
    expect(message).toContain('0.10')
    expect(message).toContain('0.22')
  })

  it('reports the coverage counts and the floors they missed', () => {
    const verdict = checkShoveGateW({ ...green, shoveStarts: 10, shoveContacts: 5, boutsWithAShove: 0 })
    expect(verdict.pass).toBe(false)
    const message = verdict.pass === false ? verdict.failures.join(' ') : ''
    expect(message).toContain('10')
    expect(message).toContain(String(W_MIN_SHOVE_STARTS))
    expect(message).toContain('5')
    expect(message).toContain(String(W_MIN_SHOVE_CONTACTS))
  })
})

describe('the four checks are independent and accumulate', () => {
  it('reports coverage, frequency, punishability and population together when all four fail', () => {
    const verdict = checkShoveGateW({
      shoveStarts: 0, shoveContacts: 0, boutsWithAShove: 0, bouts: 200,
      murmilloAttackDecisions: 100, shoveDecisions: 100,
      recoveryWindowContactsPerShove: 0, recoveryWindowContactsPerJab: 0.5, jabContacts: 0,
    })
    expect(verdict.pass).toBe(false)
    const failures = verdict.pass === false ? verdict.failures : []
    expect(failures.length).toBeGreaterThanOrEqual(4)
    const joined = failures.join(' ')
    expect(joined).toMatch(/coverage/i)
    expect(joined).toMatch(/frequency/i)
    expect(joined).toMatch(/punish/i)
    expect(joined).toMatch(/population/i)
  })

  it('does not let one failing check hide another: bout-share floor fails on its own', () => {
    // Starts and contacts clear their floors; only the bout-share clause of
    // coverage is under the line. This is the sub-check a ceiling-only
    // implementation has no way to express at all.
    const verdict = checkShoveGateW({ ...green, boutsWithAShove: 10 }) // 10/200 = 5%, below W_MIN_BOUT_SHARE
    expect(verdict.pass).toBe(false)
    const message = verdict.pass === false ? verdict.failures.join(' ') : ''
    expect(message).toMatch(/coverage/i)
    expect(message).toContain(`${W_MIN_BOUT_SHARE * 100}`)
  })
})

it('passes exactly at the frequency ceiling, W_MAX_DECISION_SHARE is inclusive', () => {
  const atCeiling: ShoveRunSummary = { ...green, shoveDecisions: green.murmilloAttackDecisions * W_MAX_DECISION_SHARE }
  const verdict = checkShoveGateW(atCeiling)
  expect(verdict).toEqual({ pass: true })
})
