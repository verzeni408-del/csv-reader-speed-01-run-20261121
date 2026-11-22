# Fast CSV Reader — csv-reader-speed-01-run-20261121

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/verzeni408-del/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/verzeni408-del/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers
exactly as csv-reader does on every case (`{columns, rows, errors}`), and
`main.ts` is the program the harness runs.

## How it is faster

csv-reader reads one character at a time and builds every field with string
concatenation. This entry reads the text once, left to right, and takes each
field with `slice()` instead — one slice per field, no per-character
concatenation. Quoted fields jump to their closing quote with `indexOf()`;
the common quoted field (no doubled quotes, no line breaks inside) is a
single slice. Only genuinely broken fields (doubled quotes, CR/LF inside
quotes, stray CRs, unterminated quotes, quote junk) take a slow path, and
those paths still follow csv-reader's rules exactly, including error order
and the 1-based line of the record each error belongs to.

Measured on the competition's practice set (6 cases, ~10.2 MB of CSV):
6/6 cases identical to csv-reader 1.0.0, at **5.38× its CPU time**
(median 206 ms vs 1108 ms, local Node 24).

## Layout

- `solve.js` — dependency-free ES module, `run(input)` returns csv-reader's answer.
- `main.ts` — reads `/input/cases.json`, answers each case with `run`, writes `/output/answers.json`.
- `package.json`, `LICENSE` (MIT).

## Round 6 — transformer v2 (2026-11-22)

`transform.js` + a new `main.ts` fuse the three passes into one: the raw
`cases.json` bytes are read as latin1 and the CSV structure is parsed
straight off the JSON-escaped text — no `JSON.parse`, no csv-reader object
graph, no `JSON.stringify`. `solve.js` is unchanged and stays the fallback:
anything the transformer does not recognise throws and the driver falls
back to `JSON.parse` + `run()`.

Verified: practice 6/6 byte-identical; fuzz 32 seeds × 6 cases = 192
identical; 22 hand-built edge cases identical. Local Node 24 (median of 6
interleaved runs): wall 563 ms / CPU 695 ms vs round 5's 802 ms / 1015 ms
— ~1.4× faster. Expected server dev ~900,000 µs (round 5: 1,210,000 µs,
rank 681); the ≤20,000 µs pay line is not reachable by honest parsing.
