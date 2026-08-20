// Produces the material the human review gate needs
// (`docs/reviews/2026-08-16-readable-deep-combat-human-review.md`, issue #8):
// one real-time `x1` video per style pairing, three of them repeated with the
// HP cards and battle feed hidden, one full `x2` series, and the event trace
// behind every clip so a reviewer can compare their own labels against what
// actually happened.
//
//   npm run review:clips                 # everything, into docs/reviews/clips/
//   npm run review:clips -- --only=3     # just clip 3, while iterating
//   npm run review:clips -- --seed=99    # a different series seed
//
// This script only *records*. It makes no judgement, fills in no cell of the
// review document, and cannot: design.md's gate requires two humans who did
// not implement the combat, and "visual/audio acceptance cannot be delegated
// to a text-only model". What it removes is the tedium and the drift -- every
// reviewer gets the same nine bouts from the same seed, framed the same way.
//
// SOUND IS NOT IN THESE FILES. Chromium's video recording is silent, and the
// gate wants each cue in isolation as well as in a bout. Audio is reviewed
// live instead -- see `clips/README.md`, which this script writes.
//
// It drives a Vite *dev* server (like `tests/global-setup.ts`) because the
// `window.__GLADIATOR_TEST__` command surface it uses to set up a lineup is
// stripped from production builds by design.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { createServer } from 'vite'

const PORT = 4174 // deliberately not 4173: `npm run test:e2e` may be holding that
const VIEWPORT = { width: 1280, height: 820 } as const
/** A bout runs 1200-2700 ticks at 60 ticks/s, i.e. 20-45 real seconds at `x1`. This is the ceiling before the recorder gives up on one. */
const BOUT_TIMEOUT_MS = 120_000

interface Pairing {
  clip: number
  homeId: string
  homeStyle: string
  opponentId: string
  opponentStyle: string
  /** Which of the three bout slots this pairing occupies -- the opponent roster is fixed per slot, so this is not a free choice. */
  slot: 0 | 1 | 2
  /** The full three-slot lineup this pairing is reached through. */
  lineup: readonly [string, string, string]
}

// The roster exposes three home fighters against three fixed opponents, one
// opponent per slot, so a single series only ever shows three of the nine
// ordered pairings. Three lineups, each a rotation of the previous one, cover
// all nine exactly once.
const LINEUPS: readonly (readonly [string, string, string])[] = [
  ['brutus', 'aquila', 'nerva'],
  ['aquila', 'nerva', 'brutus'],
  ['nerva', 'brutus', 'aquila'],
]
const HOME_STYLE: Readonly<Record<string, string>> = { brutus: 'heavy', aquila: 'fast', nerva: 'technical' }
const OPPONENT_BY_SLOT = [
  { id: 'drusus', style: 'fast' },
  { id: 'cassius', style: 'technical' },
  { id: 'magnus', style: 'heavy' },
] as const

/** One clip per ordered pairing, numbered to match the table in the review document. */
function buildPairings(): Pairing[] {
  const pairings: Pairing[] = []
  for (const homeId of ['brutus', 'aquila', 'nerva']) {
    for (const slot of [0, 1, 2] as const) {
      const lineup = LINEUPS.find((candidate) => candidate[slot] === homeId)
      if (!lineup) throw new Error(`No lineup puts ${homeId} in slot ${slot}`)
      pairings.push({
        clip: pairings.length + 1,
        homeId,
        homeStyle: HOME_STYLE[homeId],
        opponentId: OPPONENT_BY_SLOT[slot].id,
        opponentStyle: OPPONENT_BY_SLOT[slot].style,
        slot,
        lineup,
      })
    }
  }
  return pairings
}

/** One representative pairing per home style, re-recorded with the HP cards and battle feed hidden -- the clips design.md's gate is actually scored on. */
const HUD_HIDDEN_CLIPS = [1, 4, 7]

const HIDE_HUD_CSS = `
  [data-testid="active-home"], [data-testid="active-away"], [data-testid="battle-feed"] { visibility: hidden !important; }
`

interface Args {
  seed: number
  outDir: string
  only?: number
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string) => argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]
  const only = get('only')
  return {
    seed: Number(get('seed') ?? 20260815),
    outDir: resolve(get('out') ?? 'docs/reviews/clips'),
    only: only === undefined ? undefined : Number(only),
  }
}

// The dev-only command surface this script drives, narrowed to what it uses.
// Declared locally rather than merged into `main.ts`'s own `Window`
// declaration: `scripts/` is outside the tsconfig program (no `@types/node`
// here), and a second global merge would clash with the real one anyway.
interface TestApi {
  getActiveSeriesState: () => { phase: string; activeBoutIndex: number | null; activeBattle?: { events: readonly unknown[]; encounter: { tick: number } } } | null
  assign: (fighterId: string, slot: number) => void
  confirm: () => void
  advanceTicks: (ticks: number) => void
  startNextBout: () => void
}

async function openSeries(context: BrowserContext, seed: number, lineup: readonly [string, string, string], hideHud: boolean): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${PORT}/?seed=${seed}`)
  await page.waitForFunction(() => Boolean((window as unknown as { __GLADIATOR_TEST__?: unknown }).__GLADIATOR_TEST__))
  if (hideHud) await page.addStyleTag({ content: HIDE_HUD_CSS })
  // No `api.startNextSeries()` call here (fix round 1, Task 7 review): the
  // season (Task 7) auto-opens series 0 on boot -- `main.ts` runs it through
  // `autoAdvanceSeason` once at module init -- so `season.phase` is already
  // `'series'` by the time this page finishes loading, and the call would
  // always fail `no-series-pending` and be discarded.
  await page.evaluate((assignments) => {
    const api = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
    assignments.forEach((fighterId, slot) => api.assign(fighterId, slot))
    api.confirm()
  }, [...lineup])
  return page
}

/** Runs the bouts before `slot` to completion instantly (they are not what this clip is for) so the recording's real-time portion is only the target bout. */
async function skipToSlot(page: Page, slot: number): Promise<void> {
  for (let index = 0; index < slot; index += 1) {
    await page.evaluate(() => {
      const api = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
      while (api.getActiveSeriesState()!.phase === 'fighting') api.advanceTicks(120)
      api.startNextBout()
    })
  }
}

/** Watches the target bout play out in real time at the given speed, and returns its event trace. */
async function playBout(page: Page, speed: 1 | 2): Promise<{ events: unknown[]; ticks: number }> {
  await page.click(`[data-testid="speed-${speed}"]`)
  await page.waitForFunction(
    () => (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__.getActiveSeriesState()!.phase !== 'fighting',
    undefined,
    { timeout: BOUT_TIMEOUT_MS },
  )
  return page.evaluate(() => {
    const battle = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__.getActiveSeriesState()!.activeBattle
    return { events: [...(battle?.events ?? [])], ticks: battle?.encounter.tick ?? 0 }
  })
}

interface ClipRecord {
  file: string
  kind: 'pairing' | 'pairing-hud-hidden' | 'series-x2'
  label: string
  speed: 1 | 2
  seed: number
  /** Seconds into the clip at which the reviewed bout starts; everything before it is the skipped-bout pre-roll. */
  reviewStartsAtSeconds: number
  ticks: number
  events: number
  trace: string
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const videoDir = resolve(args.outDir, 'video')
  const traceDir = resolve(args.outDir, 'traces')
  await rm(args.outDir, { recursive: true, force: true })
  await mkdir(videoDir, { recursive: true })
  await mkdir(traceDir, { recursive: true })

  const server = await createServer({ server: { host: '127.0.0.1', port: PORT, strictPort: true } })
  await server.listen()
  const browser = await chromium.launch()
  const clips: ClipRecord[] = []

  try {
    for (const pairing of buildPairings()) {
      if (args.only !== undefined && args.only !== pairing.clip) continue
      const name = `clip-${String(pairing.clip).padStart(2, '0')}-${pairing.homeId}-vs-${pairing.opponentId}`
      const label = `${pairing.homeId} (${pairing.homeStyle}) vs ${pairing.opponentId} (${pairing.opponentStyle})`
      await recordPairing(browser, args, videoDir, traceDir, clips, name, label, pairing, false)
      if (HUD_HIDDEN_CLIPS.includes(pairing.clip)) {
        await recordPairing(browser, args, videoDir, traceDir, clips, `${name}-hud-hidden`, `${label}, HP cards and feed hidden`, pairing, true)
      }
    }

    if (args.only === undefined) {
      await recordSeries(browser, args, videoDir, traceDir, clips)
    }

    await writeFile(resolve(args.outDir, 'manifest.json'), JSON.stringify({ seed: args.seed, viewport: VIEWPORT, clips }, null, 2), 'utf8')
    await writeFile(resolve(args.outDir, 'README.md'), renderReadme(args, clips), 'utf8')
    console.log(`\n${clips.length} clips in ${args.outDir}`)
  } finally {
    await browser.close()
    await server.close()
  }
}

async function recordPairing(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  args: Args,
  videoDir: string,
  traceDir: string,
  clips: ClipRecord[],
  name: string,
  label: string,
  pairing: Pairing,
  hideHud: boolean,
): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: videoDir, size: VIEWPORT } })
  const startedAt = Date.now()
  const page = await openSeries(context, args.seed, pairing.lineup, hideHud)
  await skipToSlot(page, pairing.slot)
  const preRollMs = Date.now() - startedAt
  const bout = await playBout(page, 1)
  await finish(context, page, videoDir, traceDir, clips, name, {
    kind: hideHud ? 'pairing-hud-hidden' : 'pairing',
    label,
    speed: 1,
    seed: args.seed,
    reviewStartsAtSeconds: Number((preRollMs / 1000).toFixed(1)),
    ticks: bout.ticks,
    events: bout.events,
  })
}

async function recordSeries(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  args: Args,
  videoDir: string,
  traceDir: string,
  clips: ClipRecord[],
): Promise<void> {
  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: videoDir, size: VIEWPORT } })
  const page = await openSeries(context, args.seed, LINEUPS[0], false)
  const events: unknown[] = []
  let ticks = 0
  for (let slot = 0; slot < 3; slot += 1) {
    const bout = await playBout(page, 2)
    events.push(...bout.events)
    ticks += bout.ticks
    if (slot < 2) await page.evaluate(() => (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__.startNextBout())
  }
  await finish(context, page, videoDir, traceDir, clips, 'series-x2', {
    kind: 'series-x2',
    label: `full three-bout series at x2 (${LINEUPS[0].join(', ')})`,
    speed: 2,
    seed: args.seed,
    reviewStartsAtSeconds: 0,
    ticks,
    events,
  })
}

async function finish(
  context: BrowserContext,
  page: Page,
  videoDir: string,
  traceDir: string,
  clips: ClipRecord[],
  name: string,
  meta: Omit<ClipRecord, 'file' | 'trace' | 'events'> & { events: unknown[] },
): Promise<void> {
  const video = page.video()
  await context.close() // finalizes the video file
  const { rename } = await import('node:fs/promises')
  const file = `${name}.webm`
  if (video) await rename(await video.path(), resolve(videoDir, file))
  const trace = `${name}.json`
  await writeFile(resolve(traceDir, trace), JSON.stringify(meta.events, null, 2), 'utf8')
  const { events, ...rest } = meta
  clips.push({ ...rest, file: `video/${file}`, trace: `traces/${trace}`, events: events.length })
  console.log(`recorded ${file} -- ${meta.label} (${meta.ticks} ticks, ${events.length} events)`)
}

function renderReadme(args: Args, clips: readonly ClipRecord[]): string {
  const rows = clips
    .map((clip) => `| ${clip.file} | ${clip.label} | x${clip.speed} | ${clip.reviewStartsAtSeconds}s | ${clip.ticks} | ${clip.events} | ${clip.trace} |`)
    .join('\n')

  return `# Human review clips (seed ${args.seed})

Generated by \`npm run review:clips\`. Regenerating with the same seed produces
the same bouts -- the simulation is deterministic, so two reviewers watching
"clip 3" are watching the identical fight.

**These files are not committed.** They are review material, not artifacts:
\`docs/reviews/clips/\` is gitignored. Record them, review them, record the
numbers in \`../2026-08-16-readable-deep-combat-human-review.md\`.

| Clip | Pairing | Speed | Review starts at | Ticks | Events | Trace |
|---|---|---|---|---|---|---|
${rows}

"Review starts at" is the pre-roll: the bouts before this one in the series are
run to completion instantly so the clip's real-time portion is only the bout it
is named for. Seek past it.

## What is *not* in these files

**Sound.** Chromium records video silently, and the gate wants each cue in
isolation as well as during a bout. Review audio live:

\`\`\`bash
npm run dev
\`\`\`

- each cue in isolation: open \`http://localhost:5173/?audioDebug=1\` and use the
  cue buttons -- no bout needed;
- cues during a full bout: open \`http://localhost:5173/?seed=${args.seed}\`, turn
  sound on with the **Sound off/on** control, and watch a bout at x1.

**Reduced motion.** Set your OS "reduce motion" preference (or Chromium's
\`Emulate CSS prefers-reduced-motion\` in DevTools -> Rendering) and re-watch one
bout live. The gate asks whether anticipation, contact and result survive with
trails and flashes removed.

## Reproducing a single moment

The e2e suite's own discipline works by hand too:

- \`?seed=<n>\` picks the series seed; the same seed always produces the same
  three bouts.
- \`?snapshot\` starts the runtime **paused**, so nothing advances until you ask
  it to. Combined with the dev-only test API this pins an exact frame:

\`\`\`js
// in the dev console, on a ?seed=${args.seed}&snapshot page -- series 0 is
// already open (the season opens it automatically on boot), so no
// __GLADIATOR_TEST__.startNextSeries() call is needed here
__GLADIATOR_TEST__.assign('brutus', 0)
__GLADIATOR_TEST__.assign('aquila', 1)
__GLADIATOR_TEST__.assign('nerva', 2)
__GLADIATOR_TEST__.confirm()
__GLADIATOR_TEST__.advanceTicks(700)          // exactly 700 ticks, then stop
__GLADIATOR_TEST__.settleCameraSeconds(4)     // let the camera finish damping
__GLADIATOR_TEST__.getActiveSeriesState().activeBattle.events.filter((e) => e.tick === 700)
\`\`\`

## Key-pose storyboard

The storyboard the gate asks for is the committed screenshot baseline set, per
OS. On Windows: \`tests/__screenshots__/win32/\`; on Linux (what CI compares
against): \`tests/__screenshots__/linux/\`. The poses are \`heavy-cleave\`,
\`fast-burst\`, \`technical-parry\`, \`combat-outcomes\` and \`combat-safe-frame\`.
`
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exit(1)
})
