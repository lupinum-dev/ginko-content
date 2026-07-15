---
type: ADR
id: "0019"
title: "Keep MiniSearch after the Orama benchmark"
status: active
date: 2026-07-14
---

## Context

Ginko's JSON search path uses MiniSearch. Orama was proposed as a possible
replacement, so the decision needed evidence from Ginko's own generated content
rather than feature lists or synthetic documents.

The reproducible benchmark in `benchmarks/search` compares relevance, generated
index and browser runtime size, initial indexing and restoration, p95 query time,
heap growth, and locale isolation. Its corpus is generated from the documentation
site and localized playground through Ginko's production search-section logic.

On an Apple Silicon development machine with Node 24, the 366-record baseline
produced these directional results:

| Engine | Top 1 | Top 3 | Index gzip | Runtime gzip | Index ms | Restore ms | Engine / Ginko p95 ms | Approx. heap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| MiniSearch | 8/8 | 8/8 | 72.6 KiB | 5.8 KiB | 12.2 | 4.6 | 0.34 / 0.40 | 2.0 MiB |
| Orama | 5/8 | 7/8 | 346.3 KiB | 21.8 KiB | 30.8 | 16.0 | 0.06 / 0.12 | 5.5 MiB |

Both engines passed locale isolation. Timing and heap figures vary by machine;
the committed benchmark is the source for reruns, not the captured decimals.

## Decision

Keep MiniSearch as the JSON-index engine.

Orama's lower p95 query time does not produce a meaningful user-visible win at
Ginko's target corpus size: both are comfortably sub-millisecond here. MiniSearch
has better measured relevance with current defaults and materially smaller index,
runtime, initialization, restoration, and memory costs.

`@orama/orama` remains a root development dependency solely for the comparison.
It is not a package dependency, public engine option, provider adapter, or second
result contract. Ginko continues to expose exactly MiniSearch, Pagefind, and
provider-owned search.

## Alternatives considered

- **Replace MiniSearch with Orama.** Rejected because the measured query-speed
  advantage is not useful enough to offset the relevance and asset/lifecycle
  regressions.
- **Add Orama as a fourth engine.** Rejected because it increases documentation,
  configuration, testing, and provider-contract surface without covering a new
  user need.
- **Tune Orama until it wins this corpus.** Rejected for now. Ginko should improve
  the engine it already ships instead of maintaining a second tuning system.

## Consequences

- Search-quality work targets the backend-neutral result contract and the current
  MiniSearch implementation.
- Pagefind remains the static sharded option for larger filesystem sites.
- Providers remain responsible for hosted or CMS-native search.
- A future replacement proposal must rerun and extend the committed benchmark
  with a real corpus and demonstrate a material product win, not only a faster
  microbenchmark.
