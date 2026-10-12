<!-- SPDX-License-Identifier: MIT -->
# RC-0 Storybook memory measurement

Baseline: dev `139f8e37a3c1dabb229972814df517b290eb1416`.
Linux runs 36863435939, 36865320457 and 36867888576 abort with V8 OOM
at the existing 6144 MiB limit after transforming 1628 modules.
Three failures justify stopping blind retries and recording the diagnosis.

## Local phase witness

Node 22.15.1, Windows; frozen lockfile install, same heap limit.
`UNIFIA_STORYBOOK_PROFILE=1 bun run build --output-dir <isolated directory>`
from packages/storybook completed: Vite 4m20s, 1628 modules, 448 chunks.

| Phase | Heap MiB | RSS MiB | Transformed modules |
| --- | ---: | ---: | ---: |
| Start | 527 | 688 | 0 |
| Transform | 4455 | 4708 | 100 |
| Transform | 5476 | 5828 | 200 |
| Transform | 5717 | 6105 | 1000 |
| Build end | 5885 | 6286 | 1628 |
| First rendered chunk | 5917 | 6364 | 1628 |
| Generate bundle | 5917 | 6382 | 1628 |

The transform input totals 23,006,418 bytes, including 244 grammar modules.
Most observed heap growth precedes the first counted grammar module (1100).
Removing grammar coverage is therefore not a measured root-cause correction.
These are sampled process readings, not an allocation profile or peak guarantee.
Windows completion does not qualify Linux, which still needs phase logs.

## Instrument and validation

An opt-in Vite plugin reports counts and memory at each phase. It retains no
module source, heap dump or payload; it returns null from transformation/render
hooks and preserves story coverage, build options and the 6144 MiB budget.
The existing workflow enables it for the next measured Linux run.

Isolated plugin TypeScript check passes. Whole Storybook `tsc --noEmit` exits 2
with identical baseline/candidate diagnostics: unresolved app @ aliases and
implicit types in context/server.tsx, plus missing pressed in theme-tool.ts.
No full Storybook typecheck pass is claimed; both logs are retained.
Build logs are under `rc0-agent/.build-temp/rc0-storybook-*20261001*`.

## Next measured paths

1. Obtain Linux phase readings to locate its allocation cliff, then instrument
   only the implicated transform or rendering plugin.
2. Compare expensive eager imports or source transforms with identical stories
   and output behavior; retain all language/Markdown coverage.
3. Measure runner RSS and available memory before changing capacity or heap.

No memory correction is claimed. Linux OOM and existing type diagnostics remain
open findings; this diagnostic lot does not close QA03 or QA12R.
