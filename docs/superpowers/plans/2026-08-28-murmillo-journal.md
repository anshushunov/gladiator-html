# Journal — the murmillo-pin slice

Append as the work happens, not afterwards. Every entry: date, phase, what was
done, what was measured (with numbers), what was rejected and why, where I was
wrong and how I found out. Last line of every entry: where I stopped and what
the next session does.

---

## 2026-08-28 — session 1, §2 tail: the two stale Linux baselines

**Phase:** section 2 of the brief (the debt to clear before phase A).

### What was done

Read the brief, checked `git status` / `git log`. No journal existed, so this is
the first session. Branch `test/relinux-baselines`, four commits ahead of `main`:
`c0fd0b9` (brief), `861e49e` (allowlist re-scope), `2637ca6` (the bot's
re-capture), `c7eb0a0` (brief rewrite). Working tree clean.

The open question was: **look at the two regenerated PNGs and decide whether the
change is the one we expected.** Extracted four images — the pre- and post-image
of `2637ca6` for `planning.png` and `season-board.png` — and read them.

### First reading, and why it was wrong

Comparing `2637ca6^` against `2637ca6` the numbers are **identical** in both
screens: HP 420 / 404 / 418 / 372 / 396, Power 21.2 / 20.0 / 20.0 / 23.6 / 19.0,
every Defense/Accuracy/Critical the same. What moves is text metrics — the
sans-serif face is wider and heavier in the new capture, so `Defense 34%` wraps
onto a third line in the roster cards, the `Standard/Press/Guarded` buttons grow,
and the whole page shifts up ~2px. The Georgia headings (`Blood & Sand`,
`Season board`) are pixel-identical.

That is literally §8.6 of the brief — *layout, fonts or colours instead of stat
cards* — and I was one step from stopping and calling it in. **That would have
been the wrong call, and the reason is instructive:** `2637ca6^` is not the right
comparison point. It is `18fa19f`, the bad capture, made inside
`mcr.microsoft.com/playwright:v1.62.1-noble`. Comparing a good capture against a
bad one shows you the badness, not the change.

### Second reading, against the right predecessor

The baseline lineage for `tests/__screenshots__/linux/planning.png`:

| commit | captured by | image family |
|---|---|---|
| … `f74a6af`, `2fed08c`, `36c7768` | `update-baselines.yml`, `ubuntu-latest` | runner |
| `18fa19f` | Playwright `v1.62.1-noble` container, by hand | **container (the debt)** |
| `2637ca6` | `update-baselines.yml`, run `33124288353`, `ubuntu-latest` | runner |

Both `ci.yml` and `update-baselines.yml` are `runs-on: ubuntu-latest` with no
`container:` key — the re-capture and the comparison now happen on the same
image, which is the whole point of the workflow.

So the meaningful diff is `18fa19f^` (= `d0e321e`, last runner capture) against
`2637ca6`. Read that way:

- **fonts, layout, wrapping, button widths, vertical rhythm: identical.** Same
  three-line wrap of `Defense 34%`, `Confirm lineup` at the same y.
- **only the stats moved**, and they moved exactly as the brief predicted:

| card | before | after |
|---|---|---|
| Brutus | HP 324 · Power 22.0 | HP 420 · Power 21.2 |
| Aquila | HP 274 · Power 20.0 | HP 404 · Power 20.0 |
| Nerva | HP 314 · Power 20.0 | HP 418 · Power 20.0 |
| Vitus | HP 308 · Power 23.0 | HP 372 · Power 23.6 |
| Sura | HP 292 · Power 17.0 | HP 396 · Power 19.0 |
| Drusus (lineup) | HP 350 | HP 470 |
| Cassius (lineup) | HP 312 | HP 415 |
| Magnus (lineup) | HP 299 | HP 406 |

`season-board.png` is the same recalibration shown a second time: the challenge
cards (Drusus 350→470, Cassius 312→415/337→448/343→457, Magnus 299→406/317→430/
335→455) and the roster row (`Starting HP 324`→`420` and the rest). Fonts and
layout again identical to the runner predecessor.

File sizes corroborate the families: `planning.png` runner 215 761 → **container
192 574** → runner 216 493; `season-board.png` runner 251 262 → **container
256 126** → runner 251 447. The container capture is the outlier in both.

### Verdict on §2

**This is the expected change and nothing else.** The re-capture undoes the
container artefact and leaves the recalibrated `maxHp` that the content slice
genuinely produced. The brief's worry that *"nobody predicted the season board"*
is answered: the season board displays the same recalibrated stats as planning,
so it had to move for the same reason. §8.6 does not fire and I am not stopping
on it.

### Where I was wrong, and how I found out

I nearly reported a font-metric finding to the user, on a true observation read
against the wrong reference. The brief's own §4.1 (*distrust the harness first,
then the gate, then the numbers*) is what saved it — the "harness" here is the
choice of `git show 2637ca6^`, and it was the thing that was lying. Checking the
commit lineage before believing the pixels cost one `git log` on the file.

### Latent finding, recorded not acted on

`src/style.css:4` asks for `Inter, ui-sans-serif, system-ui, …` and the repo
bundles no `@font-face`, so the Linux screenshots render in whatever sans-serif
the host image happens to ship. That is exactly why the container capture
diverged so visibly, and it will bite again the next time a runner image changes
under us. Fixing it (bundle the face, or pin a font package) is a separate slice
per §8.4 — noted here, not touched.

### Where I stopped / next session

Stopped after verifying the baselines. Next: push `test/relinux-baselines`,
open the PR (body must state the two-step comparison above, because the naive
one-step diff looks like a font change), wait for green CI, **do not merge**.
Then phase A — read the five files in the brief's table and cut the slice branch.
