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

## Working agreement

State the player hypothesis in the PR, keep one hypothesis per PR, and attach the Playwright screenshot. Avoid speculative systems, deep content, and broad refactors.
