<!-- SPDX-License-Identifier: MIT -->
# Knowledge — Unifia Sovereign Knowledge Core V1

> Index of the Knowledge subsystem. Read this first; it tells you
> what's where, why, and how to resume work.

## What is this?

The Sovereign Knowledge Core V1 is the offline-first, provider-
independent, egress-bounded memory that powers the ContextRouter
across the **Code**, **Work**, and **Design** modes of Unifia.
The canonical source of truth is **Markdown + YAML frontmatter**
(Class A) in the user's vault; everything else is derived.

See `WHY-NOT-VAULT-RG-GIT.md` for the motivation and
`SOVEREIGN-CORE-V1-DOD.md` for the Definition of Done.

## Map

```
docs/knowledge/
├── README.md                # this file
├── WHY-NOT-VAULT-RG-GIT.md  # motivation
├── PRODUCT-CASES.md         # 10 real failure cases (PC-01..PC-10)
├── SOVEREIGN-CORE-V1-DOD.md # Definition of Done
├── CHANGELOG.md            # v0.1.0-knowledge
├── adr/                    # 9 knowledge ADRs
│   ├── 0001-knowledge-identity.md
│   ├── 0002-knowledge-canonical.md
│   ├── 0003-knowledge-class-b.md
│   ├── 0004-knowledge-class-c.md
│   ├── 0005-knowledge-class-d.md
│   ├── 0006-knowledge-egress.md
│   ├── 0007-knowledge-native-port.md
│   ├── 0008-knowledge-search.md
│   └── 0009-knowledge-lifecycle.md
└── execution/               # session / run artefacts
    ├── BASELINE.md
    ├── STATE.md             # append-only
    ├── DECISIONS.md
    ├── RISKS.md
    ├── COVERAGE.md
    ├── TEST-MATRIX.md
    ├── ARTIFACTS.md
    ├── POST-WORK-DESIGN-CONVERGENCE.md
    ├── FRONTIER-REVIEW-PACKET.md
    ├── FINAL-REPORT.md      # last sprint summary
    ├── COMPACT.md           # one-screen view (resumption)
    ├── checkpoints/         # session checkpoints
    ├── blockers/            # open blockers
    └── evidence/            # collected proofs
```

## Code map

```
packages/
├── contracts/src/knowledge/  # 10 files, 37 + 10 = 47 tests
└── unifia/src/knowledge/      # 21 modules
    ├── domain/        # KnowledgeFailure
    ├── parser/        # frontmatter, wikilinks, parser
    ├── source/        # KnowledgeSource + 4 spaces
    ├── policy/        # decideEgress
    ├── context/       # router, inspector, dataflow
    ├── derived/       # DDL, chunker, indexer
    ├── admin/         # doctor
    ├── memory/        # lifecycle, promotion, inbox
    ├── semantic/      # embedding score, BruteForceIndex, benchmark
    ├── stack/         # ai-native-dev-stack mapping
    ├── facade/        # KnowledgeService
    ├── git/           # GitProvider
    ├── mcp/           # McpKnowledgeServer
    ├── mobile/        # Android storage + probe
    ├── events/        # DomainBus
    ├── cross-mode/    # CrossModePipeline
    ├── hardening/     # crash matrix, sovereignty, fuzz, SBOM
    ├── wal/           # TS WAL adapter
    ├── classb/        # TS ClassB adapter
    ├── control/       # TS ControlStore adapter
    └── spike/         # P0 spike primitives

crates/
└── unifia-knowledge-core/src/  # 8 modules, 18 tests
    ├── error.rs           # KnowledgeError (11 kinds)
    ├── hash.rs            # BLAKE3 / SHA-256
    ├── path.rs            # ResolvedKnowledgePath
    ├── watcher.rs         # debounce + coalesce
    ├── wal.rs             # append-only WAL
    ├── classb.rs          # Class B copy-on-write
    └── control_store.rs   # Class C
```

## Quick start (CLI)

```bash
# From the workspace root
bun run packages/unifia/bin/unifia-knowledge.ts status
bun run packages/unifia/bin/unifia-knowledge.ts sources
bun run packages/unifia/bin/unifia-knowledge.ts search "Adreno K-quants"
bun run packages/unifia/bin/unifia-knowledge.ts doctor
bun run packages/unifia/bin/unifia-knowledge.ts bench
bun run packages/unifia/bin/unifia-knowledge.ts bench-large 100 256
```

## Validation matrix

| Suite | Command | Last result |
|---|---|---|
| Contracts | `bun --cwd packages/contracts test` | 79 pass, 0 fail |
| unifia knowledge | `bun --cwd packages/unifia test test/knowledge` | 168 pass, 0 fail |
| knowledge-core | `cargo test` (cwd crates/unifia-knowledge-core) | 18 pass, 0 fail |
| unifia typecheck | `bun --cwd packages/unifia run typecheck` | exit 0 |
| knowledge-core clippy | `cargo clippy --all-targets --all-features -- -D warnings` | exit 0 |
| biome | `bunx biome check packages/unifia/src/knowledge` | 0 warning |
| isolation | `bun tests/knowledge/eval/check-isolation.ts` | exit 0 |

## Resume after compaction

```bash
cd D:\App\unifia\unifia-memory
git status --short  # must be empty
git branch --show-current  # must be feat/sovereign-knowledge-core
git rev-parse HEAD  # must match the SHA in execution/FINAL-REPORT.md
```

Read `execution/COMPACT.md` (one screen) then
`execution/FINAL-REPORT.md` (full sprint).

## External boundaries (documented, isolated)

- **Android device** : `NOT_EXECUTED_EXTERNAL_BOUNDARY` for
  P10.2 device run and P10.3 resource pressure.
- **ONNX embedding model** : `disabled` by default per
  runbook §8.8.
- **Frontier review** : not triggered; the runbook §24 packet
  is at `execution/FRONTIER-REVIEW-PACKET.md` (skeleton).
