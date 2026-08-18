import { expect, test } from '@playwright/test'
import { preview, type PreviewServer } from 'vite'

test('plans and locks three matchups', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
  await expect(page.locator('[data-role="home-fighter"]')).toHaveCount(3)
  await expect(page.locator('[data-role="opponent-slot"]')).toHaveCount(3)
  await expect(page.getByTestId('confirm-lineup')).toBeDisabled()

  for (const [fighterId, boutIndex] of [['aquila', 0], ['nerva', 1], ['brutus', 2]] as const) {
    await page.getByTestId(`fighter-${fighterId}`).click()
    await page.getByTestId(`slot-${boutIndex}`).click()
  }

  await expect(page.getByTestId('confirm-lineup')).toBeEnabled()
  await page.getByTestId('confirm-lineup').click()
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'fighting')
})

async function finishActiveBout(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))
}

async function startSeededFirstBout(page: import('@playwright/test').Page) {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
}

test('tracks previous/current tick snapshots for render interpolation', async ({ page }) => {
  await startSeededFirstBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(10))
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState())).toMatchObject({
    previousTick: 9,
    currentTick: 10,
    paused: true,
  })
})

test('resets render snapshot ticks to zero when the next bout starts', async ({ page }) => {
  await startSeededFirstBout(page)
  await finishActiveBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState())).toMatchObject({
    previousTick: 0,
    currentTick: 0,
  })
})

test('clears render snapshots and combatant data on rematch, with no leak from the prior bout', async ({ page }) => {
  await startSeededFirstBout(page)
  for (let bout = 0; bout < 3; bout += 1) {
    await finishActiveBout(page)
    if (bout < 2) await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  }
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveBattleTraceHash())).not.toBeNull()
  await page.evaluate(() => window.__GLADIATOR_TEST__.rematch())
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState())).toMatchObject({
    previousTick: null,
    currentTick: null,
  })
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveBattleTraceHash())).toBeNull()
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveCombatantPositions())).toEqual({})
})

test('resets arena presentation for the second bout', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  await finishActiveBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(600))
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-active-bout-index', '1')
  await expect.poll(async () => Number(await canvas.getAttribute('data-last-event-id'))).toBeGreaterThan(0)
})

test('renders movement-rich encounter combat', async ({ page }) => {
  await startSeededFirstBout(page)
  const before = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveCombatantPositions())
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(600))
  const after = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveCombatantPositions())
  expect(after).not.toEqual(before)
  await expect(page.locator('canvas')).toHaveAttribute('data-rendered-combatants', '2')
})

test('carries events from every tick in a multi-tick batch to the arena, not just the last', async ({ page }) => {
  await startSeededFirstBout(page)
  // A single large `advanceTicks` burst mirrors what happens at x2/x4 speed
  // (or any render that falls behind): many `stepBattleTick()` calls run
  // before the one `syncArena()` call that follows. Every event from every
  // one of those ticks -- not only the final tick's -- must still reach
  // `ArenaView`'s cursor; a per-tick delta (this task's own self-caught
  // regression) would silently drop everything but the last tick's slice.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(700))

  const { maxEventId, contactEventCount } = await page.evaluate(() => {
    const contactTypes = new Set(['damage-dealt', 'attack-blocked', 'attack-parried'])
    const events = window.__GLADIATOR_TEST__.getState().activeBattle!.events
    return {
      maxEventId: Math.max(...events.map((event) => event.id)),
      contactEventCount: events.filter((event) => contactTypes.has(event.type)).length,
    }
  })
  // Sanity: this seeded run must contain more than one contact-producing
  // event spread across the batch (not all concentrated on the final tick),
  // or the assertion below would pass vacuously.
  expect(contactEventCount).toBeGreaterThan(1)

  const lastEventId = Number(await page.locator('canvas').getAttribute('data-last-event-id'))
  expect(lastEventId).toBe(maxEventId)
})

test('replays no new effects when the same tick pair is re-rendered at a different alpha', async ({ page }) => {
  await startSeededFirstBout(page)
  // Advance enough ticks that at least one contact-producing event (and
  // therefore an active contact flash) is essentially guaranteed for this
  // seeded lineup -- the same tick count used above, and empirically
  // verified to already contain several by then.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(700))

  const result = await page.evaluate(() => {
    const getSnapshot = window.__GLADIATOR_TEST__.getArenaDebugSnapshot
    const renderAtAlpha = window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha
    if (!getSnapshot || !renderAtAlpha) throw new Error('dev-only arena test API is unavailable')

    const before = getSnapshot()!
    // Re-render the exact same immutable previous/current pair at two
    // different alphas -- presentation-only, must never reprocess events.
    renderAtAlpha(0.1)
    const afterAlphaLow = getSnapshot()!
    renderAtAlpha(0.9)
    const afterAlphaHigh = getSnapshot()!
    return {
      eventCursor: before.eventCursor,
      activeEffectIds: before.activeEffectIds,
      afterAlphaLow: { eventCursor: afterAlphaLow.eventCursor, activeEffectIds: afterAlphaLow.activeEffectIds },
      afterAlphaHigh: { eventCursor: afterAlphaHigh.eventCursor, activeEffectIds: afterAlphaHigh.activeEffectIds },
    }
  })

  // Sanity: a real flash must actually be active, or "no new flash" would
  // hold vacuously for both an empty array before and after.
  expect(result.eventCursor).toBeGreaterThan(0)
  expect(result.activeEffectIds.length).toBeGreaterThan(0)

  // Same event cursor and the exact same set of active flash IDs (not just
  // the same count) at both alphas: no event was reprocessed by either
  // replay, regardless of which alpha it re-rendered at.
  expect(result.afterAlphaLow.eventCursor).toBe(result.eventCursor)
  expect(result.afterAlphaLow.activeEffectIds).toEqual(result.activeEffectIds)
  expect(result.afterAlphaHigh.eventCursor).toBe(result.eventCursor)
  expect(result.afterAlphaHigh.activeEffectIds).toEqual(result.activeEffectIds)
})

test('shows a readable fallback and keeps the series running after WebGL context loss', async ({ page }) => {
  await startSeededFirstBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(60))

  const tickBefore = await page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.encounter.tick)
  expect(tickBefore).toEqual(expect.any(Number))

  await page.evaluate(() => {
    document.querySelector('canvas')!.dispatchEvent(new Event('webglcontextlost'))
  })

  await expect(page.locator('.arena__webgl-fallback')).toBeVisible()
  await expect(page.locator('canvas')).toBeHidden()

  // The series and runtime continue after the presentation failure: ticks
  // still advance, and the fallback stays up rather than crashing the page.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(60))
  const tickAfter = await page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.encounter.tick)
  expect(tickAfter).toBeGreaterThan(tickBefore as number)
  await expect(page.locator('.arena__webgl-fallback')).toBeVisible()

  // A later bout boundary must not silently re-show the disposed canvas or
  // rebuild rigs against it -- the fallback owns the arena for the rest of
  // the session (no context-loss recovery is attempted).
  await finishActiveBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  await expect(page.locator('.arena__webgl-fallback')).toBeVisible()
  await expect(page.locator('canvas')).toBeHidden()
})

test('plays three bouts, reports a 2–1 win, and rematches the same seed', async ({ page }) => {
  // A stats-led ordering, deliberately NOT the all-counter one. Under Task 13's
  // final balance the all-counter lineup (Brutus->Drusus, Aquila->Cassius,
  // Nerva->Magnus) actually loses 1-2, which is the design's golden scenario
  // working as intended: the visible counter triangle is useful but is not a
  // mechanical answer to stronger individual opponents. See series.test.ts's
  // golden-scenario block for the full six-lineup table.
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('brutus', 1)
    window.__GLADIATOR_TEST__.assign('nerva', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  for (let bout = 0; bout < 3; bout += 1) {
    await finishActiveBout(page)
    if (bout < 2) await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  }
  await expect(page.getByRole('heading', { name: 'School victory' })).toBeFocused()
  await expect(page.getByTestId('series-score')).toHaveText('2–1')
  await expect(page.getByTestId('bout-result')).toHaveCount(3)
  await expect(page.getByTestId('bout-result').first()).toContainText('%')
  await page.getByTestId('rematch').click()
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeFocused()
  await expect(page.getByTestId('confirm-lineup')).toBeDisabled()
  expect(new URL(page.url()).searchParams.get('seed')).toBe('20260815')
})

test('reports school defeat in the summary heading for a losing lineup', async ({ page }) => {
  // Task 11 swapped this test off the all-counter ordering because that lineup
  // had started sweeping 3-0, and left a note to revisit "once the golden
  // lineup loses again". Under Task 13's final calibration it does lose -- the
  // all-counter lineup `brutus/aquila/nerva` finishes 1-2 -- so the note's
  // condition is met, but that makes it a candidate for THIS test rather than
  // for the victory test above, which now plays `aquila/brutus/nerva`.
  //
  // `nerva/aquila/brutus` is used here instead simply to keep the two tests on
  // different orderings. This test's job is the "School defeat" heading and
  // score rendering, so which losing lineup it uses is incidental -- but it is
  // chosen from the final measured balance rather than to dodge it. See
  // series.test.ts's golden-scenario block for the full six-lineup table.
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('nerva', 0)
    window.__GLADIATOR_TEST__.assign('aquila', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  for (let bout = 0; bout < 3; bout += 1) {
    await finishActiveBout(page)
    if (bout < 2) await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  }
  await expect(page.getByRole('heading', { name: 'School defeat' })).toBeFocused()
  await expect(page.getByTestId('series-score')).toHaveText('1–2')
})

test('supports keyboard planning and deterministic focus', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  const aquila = page.getByTestId('fighter-aquila')
  await aquila.focus()
  await page.keyboard.press('Enter')
  await expect(aquila).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(aquila).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Enter')
  await page.getByTestId('slot-0').focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('slot-0')).toContainText('Aquila')
  await expect(page.getByTestId('fighter-brutus')).toBeFocused()
})

test('normalizes an invalid URL seed', async ({ page }) => {
  await page.goto('/?seed=invalid&snapshot')
  const seed = new URL(page.url()).searchParams.get('seed')
  expect(seed).toMatch(/^\d+$/)
  expect(Number(seed)).toBeGreaterThanOrEqual(0)
  expect(Number(seed)).toBeLessThanOrEqual(0xffff_ffff)
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'planning')
})

test('changes speed without advancing while paused', async ({ page }) => {
  await page.goto('/?seed=20260815')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  await page.getByTestId('speed-4').click()
  await expect(page.getByTestId('speed-4')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.encounter.tick ?? 0)).toBeGreaterThan(0)
  await page.getByTestId('toggle-pause').click()
  const before = await page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.encounter.tick)
  expect(before).toEqual(expect.any(Number))
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.encounter.tick)
  expect(after).toBe(before)
})

test('shows both interstitials with result and next matchup context', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
    window.__GLADIATOR_TEST__.advanceTicks(3600)
  })
  await expect(page.getByTestId('bout-result-summary')).toContainText(/wins.*defeat|wins.*time limit/i)
  await expect(page.getByTestId('next-matchup')).toContainText('Nerva')
  await expect(page.getByTestId('next-matchup')).toContainText('Cassius')
  await expect(page.getByTestId('next-matchup')).toContainText('neutral')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextBout()
    window.__GLADIATOR_TEST__.advanceTicks(3600)
  })
  await expect(page.getByTestId('next-matchup')).toContainText('Brutus')
  await expect(page.getByTestId('next-matchup')).toContainText('Magnus')
  await expect(page.getByTestId('next-matchup')).toContainText('neutral')
})

test('matches the stable planning snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
  await expect(page.locator('canvas')).toBeHidden()
  await expect(page).toHaveScreenshot('planning.png', { fullPage: true })
})

// ---------------------------------------------------------------------------
// Task 18: optional event-driven combat audio
// ---------------------------------------------------------------------------

test('turns sound on by default after a real lineup-confirm click, and Sound off mutes without affecting the series', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  for (const [fighterId, boutIndex] of [['aquila', 0], ['nerva', 1], ['brutus', 2]] as const) {
    await page.getByTestId(`fighter-${fighterId}`).click()
    await page.getByTestId(`slot-${boutIndex}`).click()
  }
  // The gesture-eligible click itself: `combatAudio.enableAfterGesture()`
  // fires synchronously inside this click's handler (see main.ts's
  // `applyIntent` 'confirm' case), so `AudioContext.resume()` begins inside
  // this real browser gesture -- the same requirement Playwright's own
  // click satisfies for autoplay policy purposes.
  await page.getByTestId('confirm-lineup').click()
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'fighting')

  // The enable promise settles asynchronously; the visible control catches
  // up once it does.
  await expect(page.getByTestId('toggle-sound')).toHaveText('Sound on')
  await expect(page.getByTestId('toggle-sound')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('toggle-sound').click()
  await expect(page.getByTestId('toggle-sound')).toHaveText('Sound off')
  await expect(page.getByTestId('toggle-sound')).toHaveAttribute('aria-pressed', 'false')

  // A presentation/audio control can never stop or mutate the simulation.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(60))
  const tick = await page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.encounter.tick)
  expect(tick).toBeGreaterThan(0)
})

test('keeps the sound control (and its audio voice/cursor reset) working across the second bout', async ({ page }) => {
  await startSeededFirstBout(page)
  await finishActiveBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  // The Sound on/off control survives a bout boundary rather than resetting
  // to its planning-phase absence -- audio enablement is a session concern,
  // not a per-bout one (design.md: "Persistence across page loads is out of
  // scope", but persistence *within* a session across bouts is expected).
  // `CombatAudio.resetBout()` itself (voices/cursors) is exercised at the
  // unit level in `CombatAudio.test.ts`; this only proves the surrounding
  // wiring still functions across a real bout boundary.
  await expect(page.getByTestId('toggle-sound')).toBeVisible()
})

test('audio debug: triggers all nine cues via the dev-only ?audioDebug=1 panel without starting a bout', async ({ page }) => {
  await page.goto('/?audioDebug=1&seed=20260815&snapshot')
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
  await expect(page.locator('[data-testid="audio-debug"]')).toBeVisible()

  const cues = [
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
  for (const cue of cues) {
    await expect(page.getByTestId(`audio-debug-${cue}`)).toBeVisible()
    await page.getByTestId(`audio-debug-${cue}`).click()
  }

  await expect.poll(() => page.evaluate(() => window.__GLADIATOR_TEST__.getAudioDebugLog?.())).toEqual(cues)
  // No bout was ever started by exercising the debug panel.
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getState().phase)).toBe('planning')
})

/**
 * Serves the already-built `dist/` output (via Vite's own `preview()` API,
 * the programmatic equivalent of `npm run preview`) on a dedicated port,
 * distinct from `tests/global-setup.ts`'s dev server on 4173 -- that global
 * server always runs with `import.meta.env.DEV` true, so it can never stand
 * in for "what does a production build actually ship". Requires `dist/` to
 * already exist (`npm run build`, which `npm run check` always runs before
 * `test:e2e`); `vite.preview()` itself throws a clear, actionable error
 * otherwise.
 */
async function withProductionPreview<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const previewPort = 4174
  const server: PreviewServer = await preview({ preview: { host: '127.0.0.1', port: previewPort, strictPort: true } })
  try {
    return await run(`http://127.0.0.1:${previewPort}`)
  } finally {
    await server.close()
  }
}

test('a production build renders no audio debug UI even with ?audioDebug=1, and exposes no debug test API', async ({ page }) => {
  await withProductionPreview(async (baseUrl) => {
    await page.goto(`${baseUrl}/?audioDebug=1&seed=20260815&snapshot`)
    await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
    await expect(page.locator('[data-testid="audio-debug"]')).toHaveCount(0)

    const debugSurface = await page.evaluate(() => ({
      triggerAudioCue: typeof window.__GLADIATOR_TEST__.triggerAudioCue,
      getAudioDebugLog: typeof window.__GLADIATOR_TEST__.getAudioDebugLog,
      renderActiveBattleAtAlpha: typeof window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha,
    }))
    expect(debugSurface).toEqual({
      triggerAudioCue: 'undefined',
      getAudioDebugLog: 'undefined',
      renderActiveBattleAtAlpha: 'undefined',
    })
  })
})