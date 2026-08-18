# Agent guide

Keep the loop fast: make the smallest playable change, run the narrowest useful check, then show the result.

## Boundaries

- `src/simulation/` is deterministic TypeScript and must not import DOM or Three.js code.
- `src/presentation/` renders simulation state. Keep game rules out of it.
- Prefer plain functions and small modules. Add abstractions only after a second real use case appears.
- Use primitives and CSS while testing a hypothesis; polished assets can wait.

## Checks

- Simulation change: `npm test`
- UI/rendering change: `npm run test:e2e`
- Before handoff: `npm run check`
- Update the visual baseline only for an intentional UI change: `npm run test:e2e:update`. An ordinary run never writes a baseline (`updateSnapshots: 'none'` in `playwright.config.ts`); `-u` rewrites exactly the mismatching ones, so look at every regenerated PNG before committing it.
- Baselines are per-OS (`tests/__screenshots__/<platform>/`). Your own run only refreshes your platform's set; CI runs Linux, so refresh that one too in the matching container:

```bash
git archive HEAD | tar -x -C /tmp/shots            # a clean tree, no host node_modules
docker run --rm -v /tmp/shots:/work -w /work mcr.microsoft.com/playwright:v1.62.1-noble \
  bash -lc "npm ci && npm run build && npx playwright test --update-snapshots"
cp /tmp/shots/tests/__screenshots__/linux/*.png tests/__screenshots__/linux/
```

## Other commands

- `npm run benchmark:encounter` / `npm run benchmark:duel-log` — informational timings for the 100-combatant kernel and the duel adapter's event log. Neither asserts a threshold; both exit nonzero only on a structural failure.
- `npm run review:clips` — records the human-review material (nine `×1` pairing bouts, three with the HUD hidden, one `×2` series, plus each clip's event trace) into the gitignored `docs/reviews/clips/`. Recording only: the gate itself needs two humans who did not implement the combat.

## Working agreement

State the player hypothesis in the PR, keep one hypothesis per PR, and attach the Playwright screenshot. Avoid speculative systems, deep content, and broad refactors.
