# Fighting room — measurements, 2026-09-05

Every table behind
`docs/superpowers/specs/2026-09-05-fighting-room-design.md`, and the tables the
code comments in `src/content/combatStyles.ts`, `src/simulation/combatDecision.ts`
and `src/simulation/battle.ts` point at.

Instrument: `scripts/measure-distance.ts`, 20 seeds per pairing, root-to-root
separation on every tick of every bout, all nine shipped pairings. Raw output in
`2026-09-05-distance-before.json` and `2026-09-05-distance-after.json`.
Win rates: `scripts/measure-pairings.ts` at 200 seeds, the same seed range
`balance.test.ts` uses.

## 1. Before and after

Bands are absolute and identical in both tables, deliberately: a band set
rebased on the arena floor would move with the very constant under test.

### Before — the shipped build the playtest ran on

```
pairing                                   median   <1.0  1.0-1.6  1.6-2.1  2.1-2.8   >2.8  clinch  longest   pin%
brutus (heavy) vs drusus (fast)             1.57  14.1%    37.9%    21.9%    12.8%  13.3%      50     6.6s  16.8%
brutus (heavy) vs cassius (technical)       1.50   6.3%    57.4%    24.7%     4.3%   7.4%      20     3.4s   8.5%
brutus (heavy) vs magnus (heavy)            1.37  13.1%    58.3%    18.8%     2.0%   7.8%      30     2.6s  15.8%
aquila (fast) vs drusus (fast)              2.54   3.1%    13.6%    16.9%    25.9%  40.4%       7     2.0s   3.8%
aquila (fast) vs cassius (technical)        2.29   1.4%    17.3%    22.7%    30.1%  28.5%       2     1.1s   1.8%
aquila (fast) vs magnus (heavy)             1.59  14.7%    36.2%    22.6%    14.6%  11.9%      63     6.3s  16.8%
nerva (technical) vs drusus (fast)          2.28   1.3%    19.3%    20.7%    28.6%  30.1%       3     1.8s   1.9%
nerva (technical) vs cassius (technical)    1.72   0.2%    32.8%    42.4%    13.9%  10.7%       0     0.0s   0.4%
nerva (technical) vs magnus (heavy)         1.47   6.7%    58.8%    22.7%     4.4%   7.4%      24     3.3s   8.7%
```

### After — everything in this slice

```
pairing                                   median   <1.0  1.0-1.6  1.6-2.1  2.1-2.8   >2.8  clinch  longest   pin%
brutus (heavy) vs drusus (fast)             1.92   0.0%    32.4%    25.7%    22.4%  19.6%       0     0.0s  17.6%
brutus (heavy) vs cassius (technical)       1.82   0.0%    27.1%    43.0%    20.1%   9.9%       0     0.0s   8.9%
brutus (heavy) vs magnus (heavy)            1.70   0.0%    38.8%    45.1%     6.9%   9.1%       0     0.0s  16.8%
aquila (fast) vs drusus (fast)              2.87   0.0%     7.4%    13.5%    26.1%  53.0%       0     0.0s   2.9%
aquila (fast) vs cassius (technical)        2.70   0.0%     6.5%    17.7%    30.4%  45.3%       0     0.0s   1.9%
aquila (fast) vs magnus (heavy)             1.87   0.0%    34.0%    27.8%    20.7%  17.4%       2     1.1s  19.4%
nerva (technical) vs drusus (fast)          2.66   0.0%     6.4%    19.6%    28.9%  45.1%       0     0.0s   2.3%
nerva (technical) vs cassius (technical)    2.68   0.0%     2.4%    13.7%    40.2%  43.7%       0     0.0s   0.3%
nerva (technical) vs magnus (heavy)         1.83   0.0%    29.4%    37.8%    20.8%  12.0%       0     0.0s   9.3%
```

### The four headline numbers

| | before | after |
|---|---:|---:|
| arena separation floor | 0.90 | 1.20 |
| hoplomachus inside his own measure, mean of six observations | 15.9 % | 26.7 % |
| the same, against a murmillo (two observations) | 4.3 % | 9.6 % |
| ticks pinned within 0.15 of the separation floor | 8.9 % | 9.4 % |

Read the last row honestly: the SHARE of time spent at the floor barely moved
and is very slightly worse. What moved is where the floor is. A pinned pair now
sits at 1.20–1.35 units instead of 0.90–1.05, which is a third more air between
two bodies, and it is the reason the `<1.0` column is empty and the clinch
counter reads zero almost everywhere. Pinning is the murmillo's game working as
designed; this slice moves it out, it does not abolish it.

## 2. The `BACKSTEP_MAX_RANGE` sweep — a negative result

The first candidate answer to the hoplomachus finding, kept because it is the
reading the code invites and it is wrong. Everything else fixed at the
post-translation values; columns are the hoplomachus' share of ticks inside his
own 2.4–3.1 measure.

| gate | brutus/cassius | nerva/magnus | mirror | ticks pinned at the floor | longest pin vs a murmillo |
|---:|---:|---:|---:|---:|---:|
| 1.5 (shipped) | 4.3 % | 4.7 % | 16.1 % | 9.8 % | 2.8 s |
| 1.8 | 5.8 % | 4.4 % | 20.7 % | 10.6 % | 3.5 s |
| 2.0 | 5.4 % | 5.5 % | 28.9 % | 11.0 % | 3.8 s |
| 2.2 | 6.9 % | 5.7 % | 45.9 % | 12.2 % | 6.1 s |
| 2.4 | 6.3 % | 6.5 % | 51.8 % | 13.2 % | 6.4 s |

The murmillo columns are flat inside noise across the whole sweep while the
pinning gets monotonically worse. The gate pays only in the mirror, where
neither side is chasing. `BACKSTEP_MAX_RANGE` therefore keeps the design's
authored value, translated: 1.5.

## 3. The `pushDistance` sweep — what shipped

Swept jointly, because a spear that pushes on its probe and not on its
commitment is not a coherent weapon.

| thrust / driving | brutus/cassius | nerva/magnus | mean of six | ticks pinned |
|---:|---:|---:|---:|---:|
| 0.30 / 0.50 | 5.4 % | 5.5 % | 22.7 % | 11.0 % |
| 0.50 / 0.80 | 6.6 % | 6.7 % | 28.4 % | 11.8 % |
| **0.70 / 1.10** | **11.8 %** | **11.8 %** | **30.0 %** | **10.5 %** |
| 0.90 / 1.40 | 15.9 % | 13.3 % | 29.2 % | 10.3 % |

0.70/1.10 is the knee: it roughly doubles the murmillo-pairing figure while the
mean has stopped climbing, and it is the first cell where the pinning turns back
down rather than up. 0.90/1.40 buys four more points against one murmillo for a
push larger than any committed attack in the game.

## 4. The arena sweep

Roster win rates at 200 seeds against the design's 15–85 % band. The first row
is a pure +0.30 translation with the arena left alone.

| radius / lateral / start | brutus-drusus | aquila-magnus | nerva-magnus |
|---|---:|---:|---:|
| 6.5 / 2.5 / 4.2 (old) | **94.5 %** | **5.5 %** | 84.5 % |
| 6.8 / 2.8 / 4.35 | 84.5 % | **11.5 %** | 83.5 % |
| 7.1 / 3.1 / 4.5 | 82.5 % | 15.0 % | **86.0 %** |
| **7.5 / 3.3 / 4.7 (shipped)** | **82.0 %** | **19.0 %** | **84.5 %** |

7.1/3.1 clears `aquila/magnus` with no margin at all on the pairing the roster
notes already call "pinned hardest against the 15 % floor", and pushes
`nerva/magnus` through the ceiling instead. At 7.5/3.3 all nine pairings sit
inside the band, none closer than 2.5 points to an edge:

```
brutus/drusus     82.0%   brutus/cassius    39.0%   brutus/magnus     78.5%
aquila/drusus     27.0%   aquila/cassius    54.5%   aquila/magnus     19.0%
nerva/drusus      24.0%   nerva/cassius     64.5%   nerva/magnus      84.5%
```

## 5. Aquila's power

Restores the golden scenario's "a different ordering does strictly better"
witness, which the translation cost.

| aquila.power | brutus/nerva/aquila | aquila/drusus | aquila/cassius | aquila/magnus |
|---:|---|---:|---:|---:|
| 20 | 2-1 | 27.0 % | 54.5 % | 19.0 % |
| 20.4 | 2-1 | 27.5 % | 58.5 % | 19.5 % |
| **20.8 (shipped)** | **3-0** | 28.0 % | 58.5 % | 19.5 % |
| 21.05 | 3-0 | 31.5 % | 58.5 % | 19.5 % |

20.8 is the smallest cell that restores the witness. 21.05 also would, and is
rejected because it takes her past Drusus, leaving only one fighter out-powering
her — and `mvpSeries.test.ts` pins that count at two as the exact statement of
how far the disclosed deviation goes.

## 6. What had to be re-baselined, and why each is a re-baseline

- **Nine determinism digests** (`stateHash.test.ts`). Behaviour changed on
  purpose; digests that had not moved would have been the alarming result.
- **Two disengage-diagnostic seeds.** That file's own comment instructs a re-pin
  against a fresh sweep rather than deletion when content moves. Both new seeds
  are the first of six that satisfy every property the test asserts.
- **`LINEUP_SCORE_SET`**, four profiles to three: no lineup loses every bout any
  more. The criterion is the separate `>= 2` assertion, which still holds with a
  profile to spare.
- **`SHORT_HANDED_SCORES`**, one fought bout's winner flipped.
- **The camera's band edge and its recorded traces.** `BAND_HIGH_SEPARATION`
  tracks the longest authored reach, so it followed the catalogue; the traces
  moved because bout lengths did, which is the first slice in that fixture's
  history where a moved tick count is legitimate.
